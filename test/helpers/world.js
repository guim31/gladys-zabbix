// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Zabbix, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Zabbix with
// `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { hostIds, serverIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_URL, FakeZabbix, TOKEN } from './fakeZabbix.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const BASE_CONFIG = {
  zabbix_url: 'http://192.0.2.10/zabbix/',
  api_token: TOKEN,
  language: 'en',
};

/** A manual clock, shared by the hub and the tests (the fixture problems are from 1792158130). */
export function createClock(start = 1792160000_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  zabbix = new FakeZabbix(),
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-zabbix-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: (url, options) => {
      if (url !== API_URL) {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      }
      return zabbix.request(url, options);
    },
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, zabbix, app, hub: app.hub, clock, dataDir };
}

export const hostDevice = (gladys, hostId) => hostIds(gladys, hostId).device;
export const hostFeature = (gladys, hostId, key) => hostIds(gladys, hostId).feature(key);
export const serverFeature = (gladys, key) => serverIds(gladys).feature(key);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { API_URL, FakeZabbix, TOKEN };
