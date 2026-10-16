// -----------------------------------------------------------------------------
// Zabbix JSON-RPC client (`api_jsonrpc.php`), with an API token.
//
// Versions: API tokens exist since Zabbix 5.4. Since 6.4 the token goes in an
// `Authorization: Bearer` header; before, in the `auth` member of the request
// body (deprecated in 6.4, removed in 7.2). The version is read first with
// `apiinfo.version`, which must be called WITHOUT any token (Zabbix 6.0+
// answers "-32602 … must be called without authorization header").
//
// One read (snapshot) = a handful of requests: the host groups of the filter
// (when set), host.get, problem.get, trigger.get for the hosts of the
// problems, and item.get when item keys are configured.
//
// Errors are thrown as ZabbixError with a `kind` (ERROR_KINDS): the hub and
// the texts know what to tell the user from it.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer, timeout, 502/503/504 of a reverse proxy
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // token refused, expired or missing
  TOKEN_MISSING: 'token_missing', // no token in the configuration
  NOT_ZABBIX: 'not_zabbix', // something answers, but not the Zabbix API
  REDIRECT: 'redirect', // HTTP redirected to HTTPS: the address must say https://
  VERSION: 'version', // Zabbix older than 5.4: no API token
  GROUPS: 'groups', // none of the configured host groups exists
  API: 'api', // the API refused a request (permissions, parameters)
  HTTP: 'http', // anything else
});

export class ZabbixError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message for the logs (never a token)
   * @param {object} [extra] e.g. { code, data, status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ZabbixError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// What the API answers to a refused, expired or missing token (6.0 to 7.x).
const AUTH_ERROR = /not authori[sz]ed|session terminated|re-login|api token expired/i;

// Zabbix item value types that hold a number (0 float, 3 unsigned).
const NUMERIC_VALUE_TYPES = new Set(['0', '3']);

// Interface and active agent availability: 1 available, 2 unavailable, 0 unknown.
const AVAILABLE = '1';
const UNAVAILABLE = '2';

/** "7.0.31" → [7, 0]; null when not a version. */
export function parseVersion(text) {
  const match = typeof text === 'string' ? text.match(/^(\d+)\.(\d+)/) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

const atLeast = ([major, minor], [wantMajor, wantMinor]) =>
  major > wantMajor || (major === wantMajor && minor >= wantMinor);

/**
 * The availability of a host: 0 when one of its interfaces (or its active
 * agent, Zabbix 7.0+) is unavailable, 1 when one is available and none is
 * unavailable, null when nothing is known (no interface: trapper only, or
 * not checked yet).
 */
export function hostAvailability(host) {
  const values = (host.interfaces ?? []).map((entry) => String(entry.available));
  if (host.active_available !== undefined) {
    values.push(String(host.active_available));
  }
  if (values.includes(UNAVAILABLE)) {
    return 0;
  }
  return values.includes(AVAILABLE) ? 1 : null;
}

export class ZabbixClient {
  /**
   * @param {object} options
   * @param {string} options.url URL of api_jsonrpc.php
   * @param {string} [options.token] API token, '' for none
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, token = '', insecure = false, request = httpRequest, timeoutMs = 15_000 }) {
    this.url = url;
    this.token = token;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.version = null;
    this.parsedVersion = null;
    this.nextId = 1;
  }

  /** Forget the version: read again before the next request (Zabbix upgraded). */
  reset() {
    this.version = null;
    this.parsedVersion = null;
  }

  /**
   * One JSON-RPC call.
   * @param {string} method
   * @param {object} params
   * @param {{ auth?: boolean }} [options] auth false for apiinfo.version
   * @throws {ZabbixError}
   */
  async call(method, params, { auth = true } = {}) {
    const body = { jsonrpc: '2.0', method, params, id: this.nextId++ };
    const headers = { 'content-type': 'application/json-rpc', accept: 'application/json' };
    if (auth) {
      if (!this.token) {
        throw new ZabbixError(ERROR_KINDS.TOKEN_MISSING, 'No API token in the configuration');
      }
      if (atLeast(this.parsedVersion ?? [0, 0], [6, 4])) {
        headers.authorization = `Bearer ${this.token}`;
      } else {
        body.auth = this.token;
      }
    }
    let response;
    try {
      response = await this.request(this.url, {
        body: JSON.stringify(body),
        headers,
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new ZabbixError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      throw new ZabbixError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }

    const { status } = response;
    if (status >= 300 && status < 400) {
      throw new ZabbixError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if ([502, 503, 504].includes(status)) {
      // A reverse proxy in front of a stopped frontend.
      throw new ZabbixError(ERROR_KINDS.UNREACHABLE, `HTTP ${status}`, { status });
    }
    if (status === 401 || status === 403) {
      throw new ZabbixError(ERROR_KINDS.AUTH, `Refused (HTTP ${status})`, { status });
    }
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.jsonrpc !== '2.0') {
      throw new ZabbixError(
        status === 200 || status === 404 ? ERROR_KINDS.NOT_ZABBIX : ERROR_KINDS.HTTP,
        `Not a Zabbix API answer (HTTP ${status})`,
        { status },
      );
    }
    if (parsed.error) {
      const { code, message = '', data = '' } = parsed.error;
      const detail = `${message} ${data}`.trim();
      const kind = AUTH_ERROR.test(detail) ? ERROR_KINDS.AUTH : ERROR_KINDS.API;
      throw new ZabbixError(kind, `${method}: ${detail} (${code})`, { code, data });
    }
    return parsed.result;
  }

  /** Read the version once (again after reset()). */
  async detect() {
    if (this.version) {
      return this.version;
    }
    const version = await this.call('apiinfo.version', {}, { auth: false });
    const parsed = parseVersion(version);
    if (!parsed) {
      throw new ZabbixError(ERROR_KINDS.NOT_ZABBIX, `Unexpected version "${version}"`);
    }
    if (!atLeast(parsed, [5, 4])) {
      throw new ZabbixError(ERROR_KINDS.VERSION, `Zabbix ${version} has no API token (5.4+)`, {
        version,
      });
    }
    this.version = version;
    this.parsedVersion = parsed;
    return version;
  }

  /**
   * Everything one cycle needs.
   * @param {{ hostGroups?: string[], itemKeys?: string[] }} [scope]
   * @returns {Promise<{ version: string, hosts: object[], problems: object[], items: object[], missingGroups: string[] }>}
   * @throws {ZabbixError}
   */
  async snapshot({ hostGroups = [], itemKeys = [] } = {}) {
    const version = await this.detect();
    const filter = {};
    let missingGroups = [];
    if (hostGroups.length > 0) {
      const groups = await this.call('hostgroup.get', {
        output: ['groupid', 'name'],
        filter: { name: hostGroups },
      });
      // Names are matched exactly (case included, on PostgreSQL at least).
      const found = new Set(groups.map((group) => group.name));
      missingGroups = hostGroups.filter((name) => !found.has(name));
      if (groups.length === 0) {
        throw new ZabbixError(ERROR_KINDS.GROUPS, `No host group named ${hostGroups.join(', ')}`);
      }
      filter.groupids = groups.map((group) => group.groupid);
    }

    const hostOutput = ['hostid', 'host', 'name', 'maintenance_status'];
    if (atLeast(this.parsedVersion, [7, 0])) {
      hostOutput.push('active_available'); // active agents, 7.0+
    }
    const rawHosts = await this.call('host.get', {
      output: hostOutput,
      selectInterfaces: ['type', 'main', 'available'],
      filter: { status: '0' }, // monitored hosts only
      ...filter,
    });
    const hosts = rawHosts.map((host) => ({
      id: String(host.hostid),
      host: host.host,
      name: host.name || host.host,
      maintenance: String(host.maintenance_status) === '1',
      available: hostAvailability(host),
    }));
    const hostIds = new Set(hosts.map((host) => host.id));

    // Suppressed problems (a maintenance that hides them) are left out, as the
    // Zabbix dashboards do by default.
    const rawProblems = await this.call('problem.get', {
      output: ['eventid', 'objectid', 'name', 'severity', 'acknowledged', 'clock'],
      source: 0,
      object: 0,
      suppressed: false,
      sortfield: ['eventid'],
      sortorder: 'DESC',
      ...filter,
    });
    let problems = [];
    if (rawProblems.length > 0) {
      // The host of a problem comes from its trigger. `monitored` leaves out
      // the triggers that are disabled, or on a disabled item or host.
      const triggers = await this.call('trigger.get', {
        triggerids: [...new Set(rawProblems.map((problem) => problem.objectid))],
        output: ['triggerid'],
        selectHosts: ['hostid'],
        monitored: true,
      });
      const hostOf = new Map(
        triggers.map((trigger) => [String(trigger.triggerid), trigger.hosts ?? []]),
      );
      problems = rawProblems.flatMap((problem) => {
        const host = (hostOf.get(String(problem.objectid)) ?? []).find((entry) =>
          hostIds.has(String(entry.hostid)),
        );
        if (!host) {
          return [];
        }
        return [
          {
            eventId: String(problem.eventid),
            hostId: String(host.hostid),
            name: problem.name,
            severity: Math.min(5, Math.max(0, Number(problem.severity) || 0)),
            acknowledged: String(problem.acknowledged) === '1',
            clock: Number(problem.clock) || 0,
          },
        ];
      });
    }

    let items = [];
    if (itemKeys.length > 0 && hosts.length > 0) {
      const rawItems = await this.call('item.get', {
        output: [
          'itemid',
          'hostid',
          'key_',
          'name',
          'lastvalue',
          'lastclock',
          'units',
          'value_type',
        ],
        hostids: [...hostIds],
        filter: { key_: itemKeys },
        monitored: true,
      });
      items = rawItems
        .filter((item) => NUMERIC_VALUE_TYPES.has(String(item.value_type)))
        .map((item) => ({
          hostId: String(item.hostid),
          key: item.key_,
          name: item.name,
          units: item.units ?? '',
          // lastclock 0: never received a value.
          value:
            Number(item.lastclock) > 0 &&
            item.lastvalue !== '' &&
            Number.isFinite(Number(item.lastvalue))
              ? Number(item.lastvalue)
              : null,
        }));
    }
    return { version, hosts, problems, items, missingGroups };
  }

  /**
   * Acknowledge problems, with a message (shown in their history in Zabbix).
   * @param {string[]} eventIds
   * @param {string} message
   */
  async acknowledge(eventIds, message) {
    await this.detect();
    // 2: acknowledge, 4: add a message (same values from 5.4 to 7.x).
    return this.call('event.acknowledge', {
      eventids: eventIds,
      action: message ? 6 : 2,
      ...(message ? { message } : {}),
    });
  }
}
