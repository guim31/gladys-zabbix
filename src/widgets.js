// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `problems`.
//
// The use case: a glance at the wall tablet tells whether the homelab is
// fine, and if not, what is wrong where. So the widget shows the number of
// active problems, how many are not acknowledged yet, the hosts unavailable,
// and one row per problem — the most severe first — with the problem, its
// host, and its severity as icon and colour.
//
// Every host by default, or the hosts chosen in the widget settings (devices
// added to Gladys). The figures are sent as values, not bound to device
// features: the widget works before any device is added.
//
// Budget (8 components, 2 texts): three tiles, one status list of ten rows at
// most, one text while Zabbix does not answer, and a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, labelled, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of your Zabbix and an API token in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Zabbix et un jeton d'API dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Zabbix und ein API-Token in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Zabbix y un token de API en la configuración de la integración.',
  },
  problems: { en: 'Problems', fr: 'Problèmes', de: 'Probleme', es: 'Problemas' },
  unacknowledged: {
    en: 'Not acknowledged',
    fr: 'Non acquittés',
    de: 'Unbestätigt',
    es: 'Sin reconocer',
  },
  unavailable: {
    en: 'Hosts unavailable',
    fr: 'Hôtes injoignables',
    de: 'Hosts unerreichbar',
    es: 'Hosts no disponibles',
  },
  allClear: { en: 'No problem', fr: 'Aucun problème', de: 'Kein Problem', es: 'Ningún problema' },
  hosts: { en: 'hosts', fr: 'hôtes', de: 'Hosts', es: 'hosts' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Zabbix read again.',
    fr: 'Zabbix relu.',
    de: 'Zabbix neu gelesen.',
    es: 'Zabbix leído de nuevo.',
  },
};

// Zabbix colours its severities from blue-grey to red; the widget has six colours.
const SEVERITY_STYLE = [
  { icon: 'help-circle', color: WIDGET_COLORS.NEUTRAL },
  { icon: 'info', color: WIDGET_COLORS.INFO },
  { icon: 'alert-triangle', color: WIDGET_COLORS.WARNING },
  { icon: 'alert-triangle', color: WIDGET_COLORS.WARNING },
  { icon: 'alert-octagon', color: WIDGET_COLORS.DANGER },
  { icon: 'alert-octagon', color: WIDGET_COLORS.DANGER },
];

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const refreshButton = (language) => ({
  type: 'button',
  label: pick(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

/** The hosts the widget shows: the chosen host devices, or null for every host. */
export function chosenHosts(hub, settings) {
  const chosen = [settings?.hosts ?? []].flat().filter((id) => typeof id === 'string' && id);
  // Chosen hosts that left the scope show nothing, not every host.
  return chosen.length > 0 ? new Set(chosen.map((id) => hub.findHost(id)?.id)) : null;
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.configure, language) }],
    };
  }
  const components = [];
  const error = hub.error
    ? {
        type: 'text',
        variant: 'body',
        text: labelled(hub.serverName(), pick(ERROR_TEXT[hub.error.kind], language), language),
      }
    : null;
  if (!hub.data) {
    return { ttl_seconds: 30, components: [error, refreshButton(language)].filter(Boolean) };
  }

  const scope = chosenHosts(hub, settings);
  const hosts = [...hub.data.hosts.values()].filter((host) => !scope || scope.has(host.id));
  const problems = hub.sortedProblems(
    hub.data.problems.filter((problem) => !scope || scope.has(problem.hostId)),
  );
  const unacknowledged = problems.filter((problem) => !problem.acknowledged).length;
  const unavailable = hosts.filter((host) => host.available === 0).length;
  const worst = problems[0]?.severity ?? -1;

  components.push(
    {
      type: 'value',
      value: problems.length,
      label: pick(TEXT.problems, language),
      icon: 'alert-triangle',
      color:
        worst >= 4
          ? WIDGET_COLORS.DANGER
          : worst >= 0
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.SUCCESS,
    },
    {
      type: 'value',
      value: unacknowledged,
      label: pick(TEXT.unacknowledged, language),
      icon: 'bell',
      color: unacknowledged > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: unavailable,
      label: pick(TEXT.unavailable, language),
      icon: 'server',
      color: unavailable > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
  );
  if (error) {
    components.push(error);
  }

  let items;
  if (problems.length === 0) {
    items = [
      {
        label: pick(TEXT.allClear, language),
        value: `${hosts.length} ${pick(TEXT.hosts, language)}`,
        icon: 'check-circle',
        color: WIDGET_COLORS.SUCCESS,
      },
    ];
  } else {
    const shown = problems.length > MAX_ROWS ? problems.slice(0, MAX_ROWS - 1) : problems;
    items = shown.map((problem) => ({
      label: fit(problem.name, 40),
      // The icon and colour carry the severity; ✓: acknowledged.
      value: fit(`${hub.hostName(problem.hostId)}${problem.acknowledged ? ' ✓' : ''}`, 40),
      ...SEVERITY_STYLE[problem.severity],
    }));
    if (problems.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${problems.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  components.push({ type: 'status', items });
  components.push(refreshButton(language));

  // A problem moves fast: refresh sooner.
  return { ttl_seconds: problems.length > 0 || error ? 30 : 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollAll({ fresh: true });
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
