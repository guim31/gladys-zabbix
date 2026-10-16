// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//
//   - one device per Zabbix host (the host groups of the configuration, or
//     every monitored host), identity = the Zabbix host id;
//       available    input/binary, 1 available, 0 unavailable (an interface
//                    or the active agent), nothing published while unknown
//       problems     counter-sensor/integer, active problems (not suppressed)
//       severity     risk/integer, highest severity of the active problems,
//                    the Zabbix scale (0 not classified … 5 disaster), -1 none
//       maintenance  input/binary, 1 in maintenance
//       items        one feature per item key of the configuration found on
//                    the host (numbers only), named after the Zabbix item;
//   - one "Zabbix server" device: the active problems, in total and by
//     severity, over the same hosts.
//
// Published with should_poll: false: the integration reads Zabbix on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const HOST_TYPE = 'host';
export const SERVER_TYPE = 'server';
export const SERVER_ID = 'main';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  AVAILABLE: 'available',
  PROBLEMS: 'problems',
  SEVERITY: 'severity',
  MAINTENANCE: 'maintenance',
});

export const SEVERITIES = [0, 1, 2, 3, 4, 5];
export const NO_PROBLEM = -1;
export const severityKey = (severity) => `problems_severity_${severity}`;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
// Severity names: the ones of the Zabbix frontend in each language.
export const NAMES = {
  en: {
    [FEATURE_KEYS.AVAILABLE]: 'Available',
    [FEATURE_KEYS.PROBLEMS]: 'Active problems',
    [FEATURE_KEYS.SEVERITY]: 'Highest severity',
    [FEATURE_KEYS.MAINTENANCE]: 'In maintenance',
    [severityKey(0)]: 'Not classified problems',
    [severityKey(1)]: 'Information problems',
    [severityKey(2)]: 'Warning problems',
    [severityKey(3)]: 'Average problems',
    [severityKey(4)]: 'High problems',
    [severityKey(5)]: 'Disaster problems',
  },
  fr: {
    [FEATURE_KEYS.AVAILABLE]: 'Disponible',
    [FEATURE_KEYS.PROBLEMS]: 'Problèmes actifs',
    [FEATURE_KEYS.SEVERITY]: 'Sévérité la plus haute',
    [FEATURE_KEYS.MAINTENANCE]: 'En maintenance',
    [severityKey(0)]: 'Problèmes non classés',
    [severityKey(1)]: 'Problèmes information',
    [severityKey(2)]: 'Problèmes avertissement',
    [severityKey(3)]: 'Problèmes moyens',
    [severityKey(4)]: 'Problèmes hauts',
    [severityKey(5)]: 'Problèmes désastre',
  },
  de: {
    [FEATURE_KEYS.AVAILABLE]: 'Erreichbar',
    [FEATURE_KEYS.PROBLEMS]: 'Aktive Probleme',
    [FEATURE_KEYS.SEVERITY]: 'Höchster Schweregrad',
    [FEATURE_KEYS.MAINTENANCE]: 'In Wartung',
    [severityKey(0)]: 'Probleme nicht klassifiziert',
    [severityKey(1)]: 'Probleme Information',
    [severityKey(2)]: 'Probleme Warnung',
    [severityKey(3)]: 'Probleme Durchschnittlich',
    [severityKey(4)]: 'Probleme Hoch',
    [severityKey(5)]: 'Probleme Katastrophe',
  },
  es: {
    [FEATURE_KEYS.AVAILABLE]: 'Disponible',
    [FEATURE_KEYS.PROBLEMS]: 'Problemas activos',
    [FEATURE_KEYS.SEVERITY]: 'Gravedad más alta',
    [FEATURE_KEYS.MAINTENANCE]: 'En mantenimiento',
    [severityKey(0)]: 'Problemas no clasificados',
    [severityKey(1)]: 'Problemas de información',
    [severityKey(2)]: 'Problemas de advertencia',
    [severityKey(3)]: 'Problemas promedio',
    [severityKey(4)]: 'Problemas altos',
    [severityKey(5)]: 'Problemas de desastre',
  },
};

export const SERVER_NAME = {
  en: 'Zabbix server',
  fr: 'Serveur Zabbix',
  de: 'Zabbix-Server',
  es: 'Servidor Zabbix',
};

// Display bounds (the core never applies them on write).
export const MAX_PROBLEMS = 10_000;
const ITEM_BOUND = 1e12;

export const MODEL_HOST = 'Zabbix host';
export const MODEL_SERVER = 'Zabbix server';
export const PARAMS = Object.freeze({ HOST: 'ZABBIX_HOST', ITEM_KEY: 'ZABBIX_ITEM_KEY' });

export const hostIds = (gladys, hostId) => gladys.externalIds(HOST_TYPE, hostId);
export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);

/** Feature key of an item: a hash, since a key holds brackets, commas, slashes. */
export const itemFeatureKey = (key) =>
  `item_${createHash('sha1').update(key).digest('hex').slice(0, 12)}`;

/** The Zabbix host id of a device external id, null when it is not a host of ours. */
export function parseHostId(gladys, externalId) {
  const prefix = hostIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^\d+$/.test(id) ? id : null;
}

const readOnly = { read_only: true, has_feedback: false, keep_history: true };

function counter(name, externalId) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    ...readOnly,
    min: 0,
    max: MAX_PROBLEMS,
  };
}

function binary(name, externalId) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.INPUT,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    ...readOnly,
    min: 0,
    max: 1,
  };
}

function itemFeature(item, externalId, takenNames) {
  let name = (item.name || item.key).slice(0, 40);
  if (takenNames.has(name)) {
    name = item.key.slice(0, 40); // two items of the same name on one host
  }
  takenNames.add(name);
  if (item.units === '%') {
    return {
      name,
      external_id: externalId,
      category: DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
      type: DEVICE_FEATURE_TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      ...readOnly,
      min: 0,
      max: 100,
    };
  }
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
    type: DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN,
    ...readOnly,
    min: -ITEM_BOUND,
    max: ITEM_BOUND,
  };
}

/**
 * The discovery payload of a host.
 * @param {object} gladys SDK client
 * @param {object} host see ZabbixClient.snapshot()
 * @param {object[]} items the configured items found on this host
 * @param {string} language feature names language
 */
export function buildHostDevice(gladys, host, items = [], language = 'en') {
  const ids = hostIds(gladys, host.id);
  const names = NAMES[language] ?? NAMES.en;
  const features = [
    binary(names[FEATURE_KEYS.AVAILABLE], ids.feature(FEATURE_KEYS.AVAILABLE)),
    counter(names[FEATURE_KEYS.PROBLEMS], ids.feature(FEATURE_KEYS.PROBLEMS)),
    {
      name: names[FEATURE_KEYS.SEVERITY],
      external_id: ids.feature(FEATURE_KEYS.SEVERITY),
      category: DEVICE_FEATURE_CATEGORIES.RISK,
      type: DEVICE_FEATURE_TYPES.RISK.INTEGER,
      ...readOnly,
      min: NO_PROBLEM,
      max: 5,
    },
    binary(names[FEATURE_KEYS.MAINTENANCE], ids.feature(FEATURE_KEYS.MAINTENANCE)),
  ];
  const takenNames = new Set(features.map((feature) => feature.name));
  for (const item of [...items].sort((a, b) => a.key.localeCompare(b.key))) {
    features.push(itemFeature(item, ids.feature(itemFeatureKey(item.key)), takenNames));
  }
  return {
    name: host.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL_HOST,
    should_poll: false,
    params: [{ name: PARAMS.HOST, value: host.host.slice(0, 255) }],
    features,
  };
}

/** The discovery payload of the "Zabbix server" device. */
export function buildServerDevice(gladys, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: SERVER_NAME[language] ?? SERVER_NAME.en,
    external_id: ids.device,
    model: MODEL_SERVER,
    should_poll: false,
    features: [
      counter(names[FEATURE_KEYS.PROBLEMS], ids.feature(FEATURE_KEYS.PROBLEMS)),
      ...SEVERITIES.map((severity) =>
        counter(names[severityKey(severity)], ids.feature(severityKey(severity))),
      ),
    ],
  };
}

/** Highest severity of a list of problems, NO_PROBLEM when empty. */
export const highestSeverity = (problems) =>
  problems.reduce((highest, problem) => Math.max(highest, problem.severity), NO_PROBLEM);

/**
 * Feature values of a host (null: nothing to publish).
 * @returns {Array<{ externalId: string, value: number|null }>}
 */
export function hostValues(gladys, host, problems, items = []) {
  const ids = hostIds(gladys, host.id);
  return [
    { externalId: ids.feature(FEATURE_KEYS.AVAILABLE), value: host.available },
    { externalId: ids.feature(FEATURE_KEYS.PROBLEMS), value: problems.length },
    { externalId: ids.feature(FEATURE_KEYS.SEVERITY), value: highestSeverity(problems) },
    { externalId: ids.feature(FEATURE_KEYS.MAINTENANCE), value: host.maintenance ? 1 : 0 },
    ...items.map((item) => ({
      externalId: ids.feature(itemFeatureKey(item.key)),
      value: item.value === null ? null : Math.round(item.value * 100) / 100,
    })),
  ];
}

/** Feature values of the server device. */
export function serverValues(gladys, problems) {
  const ids = serverIds(gladys);
  return [
    { externalId: ids.feature(FEATURE_KEYS.PROBLEMS), value: problems.length },
    ...SEVERITIES.map((severity) => ({
      externalId: ids.feature(severityKey(severity)),
      value: problems.filter((problem) => problem.severity === severity).length,
    })),
  ];
}
