// The hub against the fake Zabbix: discovery, states of the added devices
// only, scene events on new and resolved problems (kept across a restart),
// the server unreachable, heartbeat, the reading timer, and quiet logs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, itemFeatureKey, severityKey } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import {
  BASE_CONFIG,
  FakeZabbix,
  createClock,
  createDevices,
  createWorld,
  hostDevice,
  hostFeature,
  serverFeature,
} from './helpers/world.js';

const NAS = '10684';
const WEB = '10683';

/** The lines written at `LOG_LEVEL=info` from now on (the SDK logger reads it per line). */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function world(t, options = {}) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

test('discovery: the server device and one device per monitored host, sorted by name', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Zabbix server', 'NAS', 'Web server'],
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // Nothing is published for a device not added: Gladys would drop it.
  assert.equal(w.fake.states.length, 0);
});

test('a host group filter keeps its hosts; an unknown group is a connection error', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, host_groups: 'Linux servers' } });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Zabbix server', 'Web server'],
  );
  // The server counts the problems of the filtered hosts only.
  await createDevices(w);
  assert.equal(w.fake.lastState(serverFeature(w.gladys, FEATURE_KEYS.PROBLEMS)), 4);
  await w.fake.configUpdated({ ...BASE_CONFIG, host_groups: 'Nope' });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /no host group/);
});

test('added devices get every state, then only the changes', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, item_keys: 'system.cpu.util' } });
  await createDevices(w);
  const state = (hostId, key) => w.fake.lastState(hostFeature(w.gladys, hostId, key));
  assert.equal(state(WEB, FEATURE_KEYS.AVAILABLE), 1);
  assert.equal(state(WEB, FEATURE_KEYS.PROBLEMS), 4);
  assert.equal(state(WEB, FEATURE_KEYS.SEVERITY), 2);
  assert.equal(state(NAS, FEATURE_KEYS.SEVERITY), 4);
  assert.equal(state(NAS, FEATURE_KEYS.MAINTENANCE), 0);
  assert.equal(state(NAS, FEATURE_KEYS.AVAILABLE), undefined, 'unknown: nothing published');
  assert.equal(typeof state(WEB, itemFeatureKey('system.cpu.util')), 'number');
  assert.equal(w.fake.lastState(serverFeature(w.gladys, severityKey(2))), 5);
  assert.equal(w.fake.lastState(serverFeature(w.gladys, severityKey(4))), 1);

  const before = w.fake.states.length;
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');

  w.zabbix.host(WEB).interfaces[0].available = '2';
  w.zabbix.host(WEB).maintenance_status = '1';
  w.zabbix.resolve('26');
  await w.hub.pollAll();
  assert.equal(state(WEB, FEATURE_KEYS.AVAILABLE), 0);
  assert.equal(state(WEB, FEATURE_KEYS.MAINTENANCE), 1);
  assert.equal(state(NAS, FEATURE_KEYS.SEVERITY), 2);
  assert.equal(state(NAS, FEATURE_KEYS.PROBLEMS), 1);
  w.zabbix.resolve('25');
  await w.hub.pollAll();
  assert.equal(state(NAS, FEATURE_KEYS.SEVERITY), -1, 'no problem left');
});

test('a device added later receives everything at once, and the widget is refreshed', async (t) => {
  const w = await world(t);
  await w.hub.pollAll();
  const nas = w.fake.discoveredDevices.find((device) => device.name === 'NAS');
  await w.fake.deviceCreated(nas);
  assert.equal(w.fake.lastState(hostFeature(w.gladys, NAS, FEATURE_KEYS.PROBLEMS)), 2);
  assert.ok(w.fake.widgetRefreshes.includes('problems'));
  // "Update" (onDeviceUpdated) sends everything again too.
  const count = w.fake.states.length;
  await w.fake.deviceUpdated(nas);
  assert.ok(w.fake.states.length > count);
});

test('scene events: the first read records, then new and resolved problems', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  assert.deepEqual(w.fake.sceneEvents, [], 'the problems already there are not announced');

  const eventId = w.zabbix.raise({ hostid: NAS, name: 'UPS on battery', severity: 5 });
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.STARTED,
      data: {
        device: hostDevice(w.gladys, NAS),
        severity: 5,
        severity_name: 'Disaster',
        host: 'NAS',
        problem: 'UPS on battery',
        event_id: eventId,
      },
    },
  ]);

  clock.advance(10 * 60_000);
  w.zabbix.resolve(eventId);
  await w.hub.pollAll();
  const resolved = w.fake.sceneEvents.at(-1);
  assert.equal(resolved.key, TRIGGERS.RESOLVED);
  assert.equal(resolved.data.event_id, eventId);
  assert.equal(resolved.data.duration_minutes, 10);
  assert.equal(w.fake.sceneEvents.length, 2);
});

test('a restart neither repeats nor misses a problem', async (t) => {
  const zabbix = new FakeZabbix();
  const first = await world(t, { zabbix });
  const kept = zabbix.raise({ name: 'Kept' });
  await first.hub.pollAll();
  await first.app.stop();
  assert.equal(first.fake.sceneEvents.length, 1);

  // While the integration was stopped: one problem ends, another one starts.
  zabbix.resolve(kept);
  const fresh = zabbix.raise({ name: 'Fresh' });
  const second = await world(t, { zabbix, dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => [event.key, event.data.event_id]),
    [
      [TRIGGERS.STARTED, fresh],
      [TRIGGERS.RESOLVED, kept],
    ],
  );
});

test('another host group filter records its problems without announcing them', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, host_groups: 'Linux servers' } });
  await w.fake.configUpdated({ ...BASE_CONFIG, host_groups: '' });
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('Zabbix silent twice: one scene event, unreachable badges, then back', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.zabbix.failure = 'down';
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [], 'one failure is a blip');
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.UNREACHABLE,
      data: { server: '192.0.2.10/zabbix', error: 'Zabbix does not answer' },
    },
  ]);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.ok(w.fake.transports.length >= 3);
  assert.ok(w.fake.transports.slice(-3).every((entry) => entry.transport === 'unreachable'));
  w.zabbix.failure = null;
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.ok(w.fake.transports.slice(-3).every((entry) => entry.transport === 'local'));
});

test('an unchanged value is sent again after 6 hours', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  await createDevices(w);
  const count = w.fake.states.length;
  clock.advance(6 * 3600_000);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, count * 2);
});

test('the container reads Zabbix on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  const reads = () => w.zabbix.calls.filter((call) => call.method === 'problem.get').length;
  const first = reads();
  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setImmediate(resolve));
  await w.hub.polling;
  assert.equal(reads(), first + 1);
});

test('a normal cycle writes nothing at the info level; a failure one line each way', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const lines = captureLogs(t);
  const eventId = w.zabbix.raise({ name: 'Quiet' });
  await w.hub.pollAll();
  w.zabbix.resolve(eventId);
  await w.hub.pollAll();
  await w.hub.rediscover();
  assert.equal(w.fake.sceneEvents.length, 2);
  assert.deepEqual(lines, []);

  w.zabbix.failure = 'down';
  for (let read = 0; read < 4; read += 1) {
    await w.hub.pollAll();
  }
  w.zabbix.failure = null;
  await w.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.ok(
    lines.every((line) => !line.includes('a'.repeat(64))),
    'no token in the logs',
  );
});

test('a burst of new problems is capped per read', async (t) => {
  const w = await world(t);
  for (let index = 0; index < 40; index += 1) {
    w.zabbix.raise({ name: `Problem ${index}` });
  }
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 30);
});

test('no configuration: a clear connection status, no request', async (t) => {
  const w = await world(t, { config: {} });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Enter the address/);
  assert.equal(w.zabbix.calls.length, 0);
});
