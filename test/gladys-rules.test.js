// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of Zabbix 7.0.31 (hosts, items), on Zabbix 6.0, 6.4 and 7.0, in
// every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeZabbix } from './helpers/fakeZabbix.js';
import { BASE_CONFIG, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

// The real hosts and items of Zabbix 7.0.31, plus a non-percent item and a
// second item of the same name, on Zabbix 7.0 and 6.0.
async function discover(language, version) {
  const zabbix = new FakeZabbix({ version });
  zabbix.items.push(
    { ...zabbix.items[0], itemid: '1', key_: 'system.uptime', name: 'Uptime', units: 'uptime' },
    { ...zabbix.items[0], itemid: '2', key_: 'system.cpu.util[,user]', name: 'CPU utilization' },
  );
  const world = await createWorld({
    zabbix,
    dataDir: mkdtempSync(join(tmpdir(), 'gladys-zabbix-rules-')),
    config: {
      ...BASE_CONFIG,
      item_keys: 'system.cpu.util, system.cpu.util[,user], system.uptime, pool.pused',
      language,
    },
  });
  await world.app.stop();
  return world.fake.discoveredDevices;
}

const scenarios = [
  { label: 'Zabbix 7.0, English names', language: 'en', version: '7.0.31' },
  { label: 'Zabbix 6.0, French names', language: 'fr', version: '6.0.40' },
  { label: 'Zabbix 7.0, German names', language: 'de', version: '7.0.31' },
  { label: 'Zabbix 6.4, Spanish names', language: 'es', version: '6.4.21' },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const devices = await discover(scenario.language, scenario.version);
    assert.equal(devices.length, 3, 'the server and the two hosts');
    assert.ok(
      devices.some((device) => device.features.length >= 7),
      'items included',
    );
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
