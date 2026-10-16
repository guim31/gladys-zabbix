// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Zabbix server. The address typed by the user can be the frontend URL
// copied from the browser (`https://zabbix.example.com/zabbix.php?action=…`):
// the API is always `api_jsonrpc.php` next to the frontend pages.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['15', '30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  zabbix_url: '',
  api_token: '',
  host_groups: '',
  item_keys: '',
  poll_interval: '30',
  allow_acknowledge: true,
  allow_self_signed: false,
  language: 'fr',
};

// Item keys read on every host, at most: one feature each on the host device.
export const MAX_ITEM_KEYS = 5;
const MAX_ITEM_KEY_LENGTH = 255;

const API_FILE = 'api_jsonrpc.php';

/**
 * Parse the address typed by the user into the URL of the JSON-RPC API: a
 * bare host (`192.0.2.5`), a frontend URL (`http://192.0.2.5/zabbix/`,
 * `https://zabbix.example.com/zabbix.php?action=dashboard.view`) or the API
 * URL itself. HTTP by default.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]/api_jsonrpc.php`, null when unusable
 */
export function parseApiUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  // A frontend page (zabbix.php, index.php, …) or the API file: keep its directory.
  const path = url.pathname.replace(/\/[^/]*\.php$/i, '').replace(/\/+$/, '');
  return `${url.origin}${path}/${API_FILE}`;
}

/** The address shown to the user: host and path, without scheme nor API file. */
export const hostOf = (apiUrl) =>
  apiUrl.replace(/^https?:\/\//, '').replace(new RegExp(`/${API_FILE}$`), '');

/** A comma (or new line) separated list, trimmed, without blanks nor duplicates. */
export function parseList(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(/[\n,;]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Item keys, separated by commas, `;` or new lines. A comma between brackets
 * belongs to the key (`vfs.fs.size[/,pused]`).
 */
export function parseItemKeys(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const keys = [];
  let current = '';
  let depth = 0;
  for (const char of raw) {
    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth = Math.max(0, depth - 1);
    }
    if ((char === '\n' || char === ';' || char === ',') && (depth === 0 || char !== ',')) {
      keys.push(current);
      current = '';
      depth = 0;
    } else {
      current += char;
    }
  }
  keys.push(current);
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))]
    .filter((key) => key.length <= MAX_ITEM_KEY_LENGTH)
    .slice(0, MAX_ITEM_KEYS);
}

const isTrue = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typed = text('zabbix_url');
  const apiUrl = parseApiUrl(typed);
  return {
    apiUrl,
    invalidUrl: Boolean(typed) && !apiUrl,
    // A pasted token often carries a trailing space or new line.
    apiToken: text('api_token'),
    hostGroups: parseList(source.host_groups),
    itemKeys: parseItemKeys(source.item_keys),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    allowAcknowledge:
      source.allow_acknowledge === undefined || source.allow_acknowledge === null
        ? DEFAULT_CONFIG.allow_acknowledge
        : isTrue(source.allow_acknowledge),
    allowSelfSigned: isTrue(source.allow_self_signed),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
