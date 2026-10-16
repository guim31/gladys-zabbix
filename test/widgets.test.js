import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MAX_ROWS } from '../src/widgets.js';
import { createWorld, hostDevice } from './helpers/world.js';

async function world(t, options) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet('problems', { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'within the core budget');
  return ack.data.content;
}

const status = (body) => body.components.find((component) => component.type === 'status');

test('the widget: tiles, the most severe problem first, a Refresh button', async (t) => {
  const w = await world(t);
  const body = await content(w);
  const values = body.components.filter((component) => component.type === 'value');
  assert.deepEqual(
    values.map((value) => [value.label, value.value, value.color]),
    [
      ['Problems', 6, 'danger'],
      ['Not acknowledged', 6, 'warning'],
      ['Hosts unavailable', 0, 'neutral'],
    ],
  );
  const rows = status(body).items;
  assert.deepEqual(rows[0], {
    label: 'Disk failing on NAS',
    value: 'NAS',
    icon: 'alert-octagon',
    color: 'danger',
  });
  assert.ok(rows.every((row) => row.label.length <= 40 && row.value.length <= 40));
  assert.equal(body.components.at(-1).action.key, 'refresh');
});

test('the widget: chosen hosts, all clear, many problems, acknowledged mark', async (t) => {
  const w = await world(t);
  await w.fake.sceneAction('acknowledge_host_problems', { device: hostDevice(w.gladys, '10684') });
  const nas = await content(w, { hosts: [hostDevice(w.gladys, '10684')] });
  assert.deepEqual(
    status(nas).items.map((row) => row.value),
    ['NAS ✓', 'NAS ✓'],
  );
  for (let index = 0; index < 15; index += 1) {
    w.zabbix.raise({ name: `Problem ${index}` });
  }
  await w.hub.pollAll();
  const many = status(await content(w)).items;
  assert.equal(many.length, MAX_ROWS);
  assert.equal(many.at(-1).value, '+12');
  w.zabbix.problems = [];
  await w.hub.pollAll();
  const clear = status(await content(w, {}, 'fr')).items;
  assert.deepEqual(clear, [
    { label: 'Aucun problème', value: '2 hôtes', icon: 'check-circle', color: 'success' },
  ]);
});

test('the widget says what is wrong: not configured, Zabbix silent', async (t) => {
  const empty = await world(t, { config: {} });
  assert.match((await content(empty)).components[0].text, /Enter the address/);

  const w = await world(t);
  w.zabbix.failure = 'down';
  await w.hub.pollAll();
  const body = await content(w);
  assert.ok(body.components.some((component) => /does not answer/.test(component.text ?? '')));
  const refresh = await w.fake.widgetAction('problems', 'refresh', {});
  assert.equal(refresh.success, true);
});
