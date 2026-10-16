import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_ITEM_KEYS,
  hostOf,
  normalizeConfig,
  parseApiUrl,
  parseItemKeys,
  parseList,
} from '../src/config.js';

test('the address of the frontend, copied from the browser, gives the API URL', () => {
  const cases = {
    '192.0.2.5': 'http://192.0.2.5/api_jsonrpc.php',
    'http://192.0.2.5/zabbix/': 'http://192.0.2.5/zabbix/api_jsonrpc.php',
    'http://192.0.2.5:8080': 'http://192.0.2.5:8080/api_jsonrpc.php',
    'https://zabbix.example.com/zabbix.php?action=dashboard.view':
      'https://zabbix.example.com/api_jsonrpc.php',
    'https://zabbix.example.com/zabbix/index.php':
      'https://zabbix.example.com/zabbix/api_jsonrpc.php',
    'https://zabbix.example.com/api_jsonrpc.php': 'https://zabbix.example.com/api_jsonrpc.php',
    ' http://192.0.2.5/zabbix ': 'http://192.0.2.5/zabbix/api_jsonrpc.php',
  };
  for (const [typed, expected] of Object.entries(cases)) {
    assert.equal(parseApiUrl(typed), expected, typed);
  }
  for (const bad of ['', '   ', 'ftp://192.0.2.5', 'http://user:pass@192.0.2.5', 'http://', 42]) {
    assert.equal(parseApiUrl(bad), null, String(bad));
  }
  assert.equal(
    hostOf('https://zabbix.example.com/zabbix/api_jsonrpc.php'),
    'zabbix.example.com/zabbix',
  );
});

test('host groups and item keys are lists; a comma between brackets belongs to the key', () => {
  assert.deepEqual(parseList(' Homelab, Linux servers ,,Homelab\nNAS '), [
    'Homelab',
    'Linux servers',
    'NAS',
  ]);
  assert.deepEqual(parseItemKeys('system.cpu.util, vfs.fs.size[/,pused]; vm.memory.utilization'), [
    'system.cpu.util',
    'vfs.fs.size[/,pused]',
    'vm.memory.utilization',
  ]);
  assert.equal(parseItemKeys('a,b,c,d,e,f,g').length, MAX_ITEM_KEYS);
});

test('normalizeConfig: defaults, an invalid address, booleans as strings', () => {
  const empty = normalizeConfig({});
  assert.equal(empty.apiUrl, null);
  assert.equal(empty.invalidUrl, false);
  assert.equal(empty.pollIntervalMs, 30_000);
  assert.equal(empty.allowAcknowledge, true);
  assert.equal(empty.allowSelfSigned, false);
  assert.equal(empty.language, DEFAULT_CONFIG.language);

  const config = normalizeConfig({
    zabbix_url: 'ftp://nope',
    api_token: ' abc \n',
    poll_interval: 120,
    allow_acknowledge: 'false',
    allow_self_signed: 'true',
    language: 'xx',
  });
  assert.equal(config.invalidUrl, true);
  assert.equal(config.apiToken, 'abc');
  assert.equal(config.pollIntervalMs, 120_000);
  assert.equal(config.allowAcknowledge, false);
  assert.equal(config.allowSelfSigned, true);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 30_000);
});
