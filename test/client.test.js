// The JSON-RPC client against the fake Zabbix (real 7.0.31 answers), and the
// version differences: token in the `auth` member before 6.4, no
// `active_available` before 7.0, no token before 5.4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, ZabbixClient, hostAvailability, parseVersion } from '../src/zabbix/client.js';
import { API_URL, FakeZabbix, TOKEN, fixture } from './helpers/fakeZabbix.js';

const clientFor = (zabbix, options = {}) =>
  new ZabbixClient({
    url: API_URL,
    token: TOKEN,
    request: (url, request) => zabbix.request(url, request),
    ...options,
  });

async function rejectsWith(promise, kind) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind, err.message);
    return true;
  });
}

test('Zabbix 7.0: version without token, then the token in the Authorization header', async () => {
  const zabbix = new FakeZabbix();
  const snapshot = await clientFor(zabbix).snapshot({ hostGroups: ['Homelab'] });
  assert.equal(snapshot.version, '7.0.31');
  assert.deepEqual(
    snapshot.hosts.map((host) => [host.id, host.name, host.available, host.maintenance]),
    [
      ['10683', 'Web server', 1, false],
      ['10684', 'NAS', null, false],
    ],
  );
  assert.equal(snapshot.problems.length, 6);
  assert.deepEqual(
    snapshot.problems.find((problem) => problem.eventId === '26'),
    {
      eventId: '26',
      hostId: '10684',
      name: 'Disk failing on NAS',
      severity: 4,
      acknowledged: false,
      suppressed: false,
      clock: 1792158162,
    },
  );
  assert.deepEqual(snapshot.items, []);
  assert.equal(zabbix.calls[0].method, 'apiinfo.version');
  assert.equal(zabbix.calls[0].auth, undefined);
  assert.ok(zabbix.calls.slice(1).every((call) => call.auth === undefined));
  const host = zabbix.calls.find((call) => call.method === 'host.get');
  assert.ok(host.params.output.includes('active_available'));
  assert.deepEqual(host.params.groupids, ['22']);
});

test('Zabbix 6.0: the token in the request body, no active_available', async () => {
  const zabbix = new FakeZabbix({ version: '6.0.40' });
  const snapshot = await clientFor(zabbix).snapshot();
  assert.equal(snapshot.version, '6.0.40');
  assert.equal(snapshot.hosts.length, 2);
  assert.ok(zabbix.calls.slice(1).every((call) => call.auth === TOKEN));
});

test('items: numbers only, with their last value', async () => {
  const zabbix = new FakeZabbix();
  zabbix.items.push({
    ...zabbix.items[0],
    key_: 'system.uname',
    value_type: '4',
    lastvalue: 'Linux',
  });
  const { items } = await clientFor(zabbix).snapshot({
    itemKeys: ['system.cpu.util', 'system.uname', 'pool.pused'],
  });
  assert.deepEqual(
    items.map((item) => [item.hostId, item.key, item.units, item.value]),
    [
      ['10683', 'system.cpu.util', '%', Number(zabbix.items[0].lastvalue)],
      ['10684', 'pool.pused', '%', 96],
    ],
  );
});

test('errors by kind: token, version, groups, proxy, redirect, not Zabbix, network, TLS', async () => {
  const zabbix = new FakeZabbix();
  await rejectsWith(clientFor(zabbix, { token: 'f'.repeat(64) }).snapshot(), ERROR_KINDS.AUTH);
  await rejectsWith(clientFor(zabbix, { token: '' }).snapshot(), ERROR_KINDS.TOKEN_MISSING);
  await rejectsWith(clientFor(zabbix).snapshot({ hostGroups: ['Missing'] }), ERROR_KINDS.GROUPS);
  const partial = await clientFor(zabbix).snapshot({ hostGroups: ['Homelab', 'Missing'] });
  assert.deepEqual(partial.missingGroups, ['Missing']);
  await rejectsWith(
    clientFor(new FakeZabbix({ version: '5.2.7' })).snapshot(),
    ERROR_KINDS.VERSION,
  );
  for (const [failure, kind] of [
    ['proxy', ERROR_KINDS.UNREACHABLE],
    ['redirect', ERROR_KINDS.REDIRECT],
    ['html', ERROR_KINDS.NOT_ZABBIX],
    ['down', ERROR_KINDS.UNREACHABLE],
  ]) {
    zabbix.failure = failure;
    await rejectsWith(clientFor(zabbix).snapshot(), kind);
  }
  const tls = new ZabbixClient({
    url: API_URL,
    token: TOKEN,
    request: async () => {
      throw Object.assign(new Error('self-signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    },
  });
  await rejectsWith(tls.snapshot(), ERROR_KINDS.TLS);
});

test('the real answer to a refused token is an authentication error', () => {
  assert.match(fixture.bad_token.response.error.data, /Not authorized/);
  assert.equal(fixture.acknowledge_again.response.result.eventids[0], 41);
});

test('acknowledge: action 6 (acknowledge + message), the API refusal kept', async () => {
  const zabbix = new FakeZabbix();
  const client = clientFor(zabbix);
  await client.acknowledge(['26'], 'Seen');
  assert.deepEqual(zabbix.acknowledged, { eventids: ['26'], action: 6, message: 'Seen' });
  zabbix.ackRefused = true;
  await rejectsWith(client.acknowledge(['26'], 'Seen'), ERROR_KINDS.API);
});

test('host availability: any interface unavailable wins, unknown publishes nothing', () => {
  assert.equal(hostAvailability({ interfaces: [{ available: '1' }] }), 1);
  assert.equal(hostAvailability({ interfaces: [{ available: '1' }, { available: '2' }] }), 0);
  assert.equal(hostAvailability({ interfaces: [], active_available: '2' }), 0);
  assert.equal(hostAvailability({ interfaces: [{ available: '0' }], active_available: '0' }), null);
  assert.equal(hostAvailability({ interfaces: [] }), null);
  assert.deepEqual(parseVersion('7.0.31'), [7, 0]);
  assert.equal(parseVersion('<html>'), null);
});
