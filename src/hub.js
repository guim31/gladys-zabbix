// -----------------------------------------------------------------------------
// The Zabbix hub: reads the server on a timer of the container (the interval
// chosen in the configuration), publishes the states of the added devices
// when they change, fires the scene events on new and resolved problems, and
// holds the views the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every host, added to Gladys or not.
//
// The problems already seen are kept in /data (src/store.js): a problem that
// started or ended while the integration or Gladys restarted is still
// announced, once. The very first read only records them.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildHostDevice,
  buildServerDevice,
  hostIds,
  hostValues,
  parseHostId,
  serverIds,
  serverValues,
} from './devices.js';
import { ERROR_KINDS, ZabbixClient } from './zabbix/client.js';
import { hostOf } from './config.js';
import { FailureLog } from './logs.js';
import { CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick, severityName } from './texts.js';

const logger = createLogger({ name: 'zabbix-hub' });

export const WIDGET_KEY = 'problems';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  STARTED: 'problem_started',
  RESOLVED: 'problem_resolved',
  UNREACHABLE: 'server_unreachable',
});

export const HUB_TIMINGS = {
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the server counts as unreachable (scene event).
  downAfterFailures: 2,
  // A scene action or the widget reads Zabbix again when the last read is older.
  freshMs: 15_000,
  // The version is read again this often (Zabbix upgraded in place).
  detectEveryMs: 3600_000,
  // An unchanged value is sent again this often: Gladys marks a value older
  // than 48 h as outdated.
  heartbeatMs: 6 * 3600_000,
};

// Scene events per read, at most: Gladys accepts 300 per minute, and a
// network outage can raise dozens of problems at once. The rest is logged.
export const MAX_EVENTS_PER_READ = 30;

const MAX_STATES_PER_REQUEST = 100;

const signature = (config) =>
  JSON.stringify([config.apiUrl, config.apiToken, config.allowSelfSigned]);
// What decides which problems are seen: another scope does not resolve the
// problems of the previous one.
const scopeOf = (config) => JSON.stringify([config.apiUrl, config.hostGroups]);

export class ZabbixHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/zabbix/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    /** Last successful read: hosts by id, problems, items, version. */
    this.data = null;
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = 0;
    this.detectedAt = 0;
    this.polling = null;
    this.generation = 0;
    /** Last value published per feature external id, and when. */
    this.published = new Map();
    this.publishedAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { scope: null, primed: false, problems: {} };
    this.pollTimer = null;
    this.retryTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.failureLog = new FailureLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      scope: typeof saved.scope === 'string' ? saved.scope : null,
      primed: saved.primed === true,
      problems: saved.problems && typeof saved.problems === 'object' ? saved.problems : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    const itemsChanged = JSON.stringify(this.config?.itemKeys) !== JSON.stringify(config.itemKeys);
    this.config = config;
    if (this.signature !== signature(config)) {
      this.generation += 1; // a read in progress for the old server is ignored
      this.signature = signature(config);
      this.client = config.apiUrl
        ? new ZabbixClient({
            url: config.apiUrl,
            token: config.apiToken,
            insecure: config.allowSelfSigned,
            request: this.request,
          })
        : null;
      this.data = null;
      this.error = null;
      this.failures = 0;
      this.down = false;
      this.readAt = 0;
      clearTimeout(this.retryTimer);
    }
    const scope = scopeOf(config);
    if (this.saved.scope !== scope) {
      this.saved = { scope, primed: false, problems: {} };
      this.store.save(this.saved);
    }
    if (languageChanged || itemsChanged) {
      this.discovered = null;
    }
    await this.pollAll({ publish: true });
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.failureLog.recover('poll', 'Reading Zabbix works again');
      } catch (err) {
        this.failureLog.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading Zabbix ------------------------------------------------------------

  async pollAll({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Gladys asks for a refresh (onPoll): read now. */
  async pollDevice() {
    await this.pollAll();
  }

  /** Read again when the last read is older than `freshMs` (scene actions, widget). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollAll();
    }
  }

  /**
   * Read Zabbix and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    this.polling ??= this.read().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  async read() {
    const { generation, client } = this;
    if (this.now() - this.detectedAt >= this.timings.detectEveryMs) {
      client.reset();
      this.detectedAt = this.now();
    }
    try {
      const snapshot = await client.snapshot({
        hostGroups: this.config.hostGroups,
        itemKeys: this.config.itemKeys,
      });
      return generation === this.generation ? await this.applySuccess(snapshot) : false;
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      client.reset(); // read the version again: Zabbix may have been upgraded
      return generation === this.generation ? await this.applyFailure(err) : false;
    }
  }

  serverName() {
    return hostOf(this.config.apiUrl);
  }

  async applySuccess({ version, hosts, problems, items, missingGroups }) {
    const previous = this.data;
    let widgetChanged = this.error !== null || previous === null;
    if (this.error) {
      logger.info(`Zabbix ${this.serverName()} answers again`);
    }
    if (version !== previous?.version) {
      logger.info(`Zabbix ${version} at ${this.serverName()}: ${hosts.length} host(s)`);
    }
    const missing = missingGroups.join(', ');
    if (missing && missing !== previous?.missingGroups.join(', ')) {
      logger.warn(`Unknown host group(s): ${missing}`);
    }
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = this.now();
    this.data = {
      version,
      hosts: new Map(hosts.map((host) => [host.id, host])),
      problems,
      items,
      missingGroups,
    };
    if (
      previous &&
      (JSON.stringify(previous.problems) !== JSON.stringify(problems) ||
        JSON.stringify([...previous.hosts.values()]) !== JSON.stringify(hosts))
    ) {
      widgetChanged = true;
    }
    await this.transitions();
    await this.publishStates();
    return widgetChanged;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Zabbix ${this.serverName()}: ${err.message}`);
    }
    // Only silence counts as unreachable: a refused token is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      this.failures = 0;
      return wasError !== err.kind;
    }
    this.failures += 1;
    if (this.failures === 1) {
      this.scheduleRetry();
    }
    if (!this.down && this.failures >= this.timings.downAfterFailures) {
      this.down = true;
      await this.fireEvent(TRIGGERS.UNREACHABLE, {
        server: this.serverName(),
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
    }
    return wasError !== err.kind;
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.pollAll()
        .then(() => this.failureLog.recover('retry'))
        .catch((err) => this.failureLog.fail('retry', `Retry failed: ${err.message}`, 'error'));
    }, this.timings.retryMs);
    this.retryTimer.unref?.();
  }

  /** Compare the problems with the ones already seen; fire the scene events. */
  async transitions() {
    const known = this.saved.problems;
    const current = new Map(this.data.problems.map((problem) => [problem.eventId, problem]));
    const announce = this.saved.primed;
    const events = [];
    for (const problem of [...current.values()].reverse()) {
      if (known[problem.eventId]) {
        continue;
      }
      const host = this.data.hosts.get(problem.hostId);
      known[problem.eventId] = {
        hostId: problem.hostId,
        host: host?.name ?? problem.hostId,
        name: problem.name,
        severity: problem.severity,
        clock: problem.clock,
      };
      if (announce) {
        events.push([TRIGGERS.STARTED, problem.eventId, known[problem.eventId]]);
      }
    }
    for (const [eventId, entry] of Object.entries(known)) {
      if (!current.has(eventId)) {
        delete known[eventId];
        if (announce) {
          events.push([TRIGGERS.RESOLVED, eventId, entry]);
        }
      }
    }
    this.saved.primed = true;
    this.store.save(this.saved);

    for (const [index, [key, eventId, entry]] of events.entries()) {
      const what = key === TRIGGERS.STARTED ? 'Problem' : 'Resolved';
      if (index >= MAX_EVENTS_PER_READ) {
        logger.warn(`${events.length - index} more problem change(s) not sent to the scenes`);
        break;
      }
      logger.debug(`${what} on ${entry.host}: ${entry.name}`);
      const data = this.problemEvent(eventId, entry);
      if (key === TRIGGERS.RESOLVED) {
        data.duration_minutes = entry.clock
          ? Math.max(0, Math.round((this.now() / 1000 - entry.clock) / 60))
          : 0;
      }
      await this.fireEvent(key, data);
    }
  }

  problemEvent(eventId, entry) {
    return {
      device: hostIds(this.gladys, entry.hostId).device,
      severity: entry.severity,
      severity_name: severityName(entry.severity, this.config.language),
      host: entry.host,
      problem: entry.name,
      event_id: eventId,
    };
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Devices -----------------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  itemsOf(hostId) {
    return (this.data?.items ?? []).filter((item) => item.hostId === hostId);
  }

  problemsOf(hostId) {
    return (this.data?.problems ?? []).filter((problem) => problem.hostId === hostId);
  }

  discoveredDevices() {
    if (!this.data) {
      return [];
    }
    const language = this.config.language;
    const hosts = [...this.data.hosts.values()].sort((a, b) => a.name.localeCompare(b.name));
    return [
      buildServerDevice(this.gladys, language),
      ...hosts.map((host) => buildHostDevice(this.gladys, host, this.itemsOf(host.id), language)),
    ];
  }

  /** Publish the Discovery list when it changed (a host added, renamed…). */
  async publishDevices({ force = false } = {}) {
    if (!this.data && !force) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.failureLog.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.failureLog.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Zabbix, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!this.data) {
      return;
    }
    const externalId = device.external_id;
    if (externalId === serverIds(this.gladys).device) {
      await this.sendStates(serverValues(this.gladys, this.data.problems), { force: true });
    } else {
      const host = this.data.hosts.get(parseHostId(this.gladys, externalId));
      if (!host) {
        return;
      }
      await this.sendStates(
        hostValues(this.gladys, host, this.problemsOf(host.id), this.itemsOf(host.id)),
        { force: true },
      );
    }
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states of the added devices that changed (or are due for a heartbeat). */
  async publishStates() {
    const values = [];
    if (this.isCreated(serverIds(this.gladys).device)) {
      values.push(...serverValues(this.gladys, this.data.problems));
    }
    for (const host of this.data.hosts.values()) {
      if (this.isCreated(hostIds(this.gladys, host.id).device)) {
        values.push(
          ...hostValues(this.gladys, host, this.problemsOf(host.id), this.itemsOf(host.id)),
        );
      }
    }
    await this.sendStates(values);
  }

  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const states = values
      .filter(({ externalId, value }) => {
        if (value === null) {
          return false; // unknown: the last value stands
        }
        return (
          force ||
          this.published.get(externalId) !== value ||
          now - (this.publishedAt.get(externalId) ?? 0) >= this.timings.heartbeatMs
        );
      })
      .map(({ externalId, value }) => ({ device_feature_external_id: externalId, state: value }));
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(batch);
        for (const state of batch) {
          this.published.set(state.device_feature_external_id, state.state);
          this.publishedAt.set(state.device_feature_external_id, now);
        }
        this.failureLog.recover('states', 'States accepted again');
      } catch (err) {
        this.failureLog.fail('states', `States refused: ${err.message}`);
      }
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable" while Zabbix is. */
  async publishTransports() {
    if (!this.data || this.readAt === 0) {
      return;
    }
    const transport = this.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const ids = [
      serverIds(this.gladys).device,
      ...[...this.data.hosts.keys()].map((id) => hostIds(this.gladys, id).device),
    ];
    const entries = ids
      .filter((id) => this.isCreated(id) && this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    for (let at = 0; at < entries.length; at += MAX_STATES_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.failureLog.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.failureLog.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const { apiUrl, invalidUrl } = this.config;
    if (!apiUrl) {
      return {
        connected: false,
        message: invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    if (!this.error) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      message[language] = pick(ERROR_TEXT[this.error.kind], language);
    }
    return { connected: false, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.failureLog.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.failureLog.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) --------------------------------------------

  /** The host of a device external id, null when unknown. */
  findHost(externalId) {
    const id = parseHostId(this.gladys, externalId);
    return id ? (this.data?.hosts.get(id) ?? null) : null;
  }

  hostName(hostId) {
    return this.data?.hosts.get(hostId)?.name ?? hostId;
  }

  /** A problem in a list: "Host: problem". */
  problemLabel(problem, language) {
    return labelled(this.hostName(problem.hostId), problem.name, language);
  }

  /** Problems sorted for display: most severe first, then the newest. */
  sortedProblems(problems = this.data?.problems ?? []) {
    return [...problems].sort((a, b) => b.severity - a.severity || b.clock - a.clock);
  }

  /** "Test the connection": read now, one line. */
  async testConnection() {
    await this.pollAll({ publish: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const status = this.connectionStatus();
      if (!status.connected) {
        message[language] = labelled(
          this.config.apiUrl ? this.serverName() : 'Zabbix',
          pick(status.message, language),
          language,
        );
        continue;
      }
      const parts = [
        text.ok,
        `Zabbix ${this.data.version}`,
        text.hosts(this.data.hosts.size),
        text.problems(this.data.problems.length),
      ];
      if (this.data.missingGroups.length) {
        parts.push(text.missing(this.data.missingGroups.join(', ')));
      }
      message[language] = labelled(this.serverName(), parts.join(', '), language);
    }
    return message;
  }
}
