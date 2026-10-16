import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CONFIG, createWorld, hostDevice } from './helpers/world.js';

const NAS = '10684';

async function world(t, options) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

test('acknowledge_host_problems acknowledges the pending problems of the host, with a message', async (t) => {
  const w = await world(t);
  const device = hostDevice(w.gladys, NAS);
  const ack = await w.fake.sceneAction('acknowledge_host_problems', { device, message: ' Seen ' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { acknowledged: 2 });
  assert.deepEqual(w.zabbix.acknowledged, { eventids: ['26', '25'], action: 6, message: 'Seen' });
  // Read again at once: nothing left to acknowledge.
  const again = await w.fake.sceneAction('acknowledge_host_problems', { device });
  assert.deepEqual(again.data.outputs, { acknowledged: 0 });
});

test('acknowledge_host_problems: the default message in the configured language', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  await w.fake.sceneAction('acknowledge_host_problems', { device: hostDevice(w.gladys, NAS) });
  assert.equal(w.zabbix.acknowledged.message, 'Acquitté depuis Gladys');
});

test('acknowledge_host_problems: turned off, refused, unknown host', async (t) => {
  const off = await world(t, { config: { ...BASE_CONFIG, allow_acknowledge: false } });
  const disabled = await off.fake.sceneAction('acknowledge_host_problems', {
    device: hostDevice(off.gladys, NAS),
  });
  assert.equal(disabled.success, false);
  assert.match(disabled.error, /turned off/);
  assert.equal(off.zabbix.acknowledged, undefined);

  const w = await world(t);
  w.zabbix.ackRefused = true;
  const refused = await w.fake.sceneAction('acknowledge_host_problems', {
    device: hostDevice(w.gladys, NAS),
  });
  assert.equal(refused.success, false);
  assert.match(refused.error, /right to acknowledge/);
  const unknown = await w.fake.sceneAction('acknowledge_host_problems', { device: 'nope' });
  assert.match(unknown.error, /not a Zabbix host/);
});

test('get_problems: every host, or one, in words', async (t) => {
  const w = await world(t);
  const all = await w.fake.sceneAction('get_problems', {});
  assert.equal(all.data.outputs.count, 6);
  assert.equal(all.data.outputs.unacknowledged, 6);
  assert.equal(all.data.outputs.highest_severity, 'High');
  assert.equal(all.data.outputs.highest_severity_level, 4);
  assert.match(all.data.outputs.names, /^NAS: Disk failing on NAS, /);

  const nas = await w.fake.sceneAction('get_problems', { device: hostDevice(w.gladys, NAS) });
  assert.deepEqual(nas.data.outputs, {
    count: 2,
    unacknowledged: 2,
    highest_severity: 'High',
    highest_severity_level: 4,
    names: 'NAS: Disk failing on NAS, NAS: Pool almost full',
  });
  w.zabbix.problems = [];
  w.clock.advance(20_000);
  const none = await w.fake.sceneAction('get_problems', {});
  assert.equal(none.data.outputs.highest_severity, 'No problem');
  assert.equal(none.data.outputs.highest_severity_level, -1);
});

test('the scene actions fail clearly while Zabbix does not answer', async (t) => {
  const w = await world(t);
  w.zabbix.failure = 'down';
  w.clock.advance(20_000);
  const ack = await w.fake.sceneAction('get_problems', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /does not answer/);
});
