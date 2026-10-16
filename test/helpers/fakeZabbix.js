// -----------------------------------------------------------------------------
// An in-memory Zabbix API, seeded with the real answers of Zabbix 7.0.31
// (test/fixtures/zabbix): the hosts, triggers, problems and items, the
// filters the integration uses, the token checks (header from 6.4, `auth` in
// the body before) and the real error answers. Tests change its state
// (problems, availability, version, failures) between two reads.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const API_URL = 'http://192.0.2.10/zabbix/api_jsonrpc.php';
export const TOKEN = 'a'.repeat(64);

export const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/zabbix/zabbix-7.0.31.json', import.meta.url), 'utf8'),
);
const result = (name) => structuredClone(fixture[name].response.result);
const answer = (name) => structuredClone(fixture[name].response);

// The fixture hosts are in the group "Homelab" (22); the agent host is in
// "Linux servers" (2) too.
const GROUPS = [
  { groupid: '22', name: 'Homelab' },
  { groupid: '2', name: 'Linux servers' },
];
const HOST_GROUPS = { 10683: ['22', '2'], 10684: ['22'] };

const atLeast = (version, [major, minor]) => {
  const [a, b] = version.split('.').map(Number);
  return a > major || (a === major && b >= minor);
};

export class FakeZabbix {
  constructor({ version = '7.0.31' } = {}) {
    this.version = version;
    this.token = TOKEN;
    this.groups = structuredClone(GROUPS);
    this.hosts = result('hosts').map((host) => ({
      ...host,
      groups: HOST_GROUPS[host.hostid].map((groupid) => ({ groupid })),
    }));
    this.triggers = result('triggers');
    this.problems = result('problems').map((problem) => ({ ...problem, suppressed: '0' }));
    this.items = result('items');
    /** 'down' (connection refused), 'html', 'proxy' (502), 'redirect', or null */
    this.failure = null;
    this.ackRefused = false;
    this.calls = [];
    this.nextEventId = 100;
  }

  /** Raise a problem on a host (a trigger of that host, or a new one). */
  raise({ hostid = '10684', name = 'Test problem', severity = 3, clock = 1792160000 } = {}) {
    const eventid = String(this.nextEventId++);
    const triggerid = `9${eventid}`;
    this.triggers.push({ triggerid, hosts: [{ hostid, host: hostid, name: hostid }] });
    this.problems.unshift({
      eventid,
      objectid: triggerid,
      name,
      severity: String(severity),
      acknowledged: '0',
      clock: String(clock),
      suppressed: '0',
    });
    return eventid;
  }

  resolve(eventid) {
    this.problems = this.problems.filter((problem) => problem.eventid !== eventid);
  }

  host(hostid) {
    return this.hosts.find((host) => host.hostid === hostid);
  }

  /** The network seam of the client (src/zabbix/http.js). */
  async request(url, { body, headers }) {
    if (this.failure === 'down') {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    if (this.failure === 'proxy') {
      return { status: 502, headers: {}, body: '<html>Bad Gateway</html>' };
    }
    if (this.failure === 'redirect') {
      return { status: 301, headers: { location: url.replace('http:', 'https:') }, body: '' };
    }
    if (this.failure === 'html') {
      return { status: 200, headers: {}, body: '<!DOCTYPE html><html></html>' };
    }
    const request = JSON.parse(body);
    this.calls.push(request);
    const reply = (payload) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', ...payload, id: request.id }),
    });
    const bearer = headers.authorization?.replace(/^Bearer /, '');
    const token = atLeast(this.version, [6, 4]) ? bearer : request.auth;
    if (request.method === 'apiinfo.version') {
      if (bearer || request.auth) {
        return reply({
          error: answer(bearer ? 'version_with_token' : 'version_auth_in_body').error,
        });
      }
      return reply({ result: this.version });
    }
    if (token !== this.token) {
      return reply({ error: answer('bad_token').error });
    }
    const handler = this[`rpc_${request.method.replace('.', '_')}`];
    if (!handler) {
      return reply({ error: { code: -32601, message: 'Method not found.', data: '' } });
    }
    try {
      return reply({ result: handler.call(this, request.params) });
    } catch (err) {
      return reply({ error: { code: -32602, message: 'Invalid params.', data: err.message } });
    }
  }

  rpc_hostgroup_get({ filter }) {
    const names = filter?.name ?? [];
    return this.groups.filter((group) => names.includes(group.name));
  }

  rpc_host_get({ output, groupids }) {
    if (!atLeast(this.version, [7, 0]) && output.includes('active_available')) {
      // 6.x validates the output fields.
      throw new Error(`Invalid parameter "/output/${output.indexOf('active_available') + 1}".`);
    }
    return this.hosts
      .filter((host) => host.status === '0')
      .filter((host) => !groupids || host.groups.some((group) => groupids.includes(group.groupid)))
      .map((host) => {
        const picked = Object.fromEntries(output.map((key) => [key, host[key]]));
        picked.interfaces = host.interfaces;
        return picked;
      });
  }

  hostIdsOfGroups(groupids) {
    return new Set(
      this.hosts
        .filter(
          (host) => !groupids || host.groups.some((group) => groupids.includes(group.groupid)),
        )
        .map((host) => host.hostid),
    );
  }

  rpc_problem_get({ groupids, suppressed }) {
    const hostIds = this.hostIdsOfGroups(groupids);
    return this.problems
      .filter((problem) => suppressed !== false || problem.suppressed === '0')
      .filter((problem) => {
        const trigger = this.triggers.find((t) => t.triggerid === problem.objectid);
        return trigger?.hosts.some((host) => hostIds.has(host.hostid));
      })
      .sort((a, b) => Number(b.eventid) - Number(a.eventid));
  }

  rpc_trigger_get({ triggerids }) {
    return this.triggers
      .filter((trigger) => triggerids.includes(trigger.triggerid))
      .map((trigger) => ({
        triggerid: trigger.triggerid,
        hosts: trigger.hosts.map((host) => ({ hostid: host.hostid })),
      }));
  }

  rpc_item_get({ hostids, filter }) {
    return this.items.filter(
      (item) => hostids.includes(item.hostid) && filter.key_.includes(item.key_),
    );
  }

  rpc_event_acknowledge({ eventids, action, message }) {
    if (this.ackRefused) {
      throw new Error('No permissions to referred object or it does not exist!');
    }
    this.acknowledged = { eventids, action, message };
    for (const problem of this.problems) {
      if (eventids.includes(problem.eventid)) {
        problem.acknowledged = '1';
      }
    }
    return { eventids: eventids.map(Number) };
  }
}
