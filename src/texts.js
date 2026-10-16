// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, severities in
// scene variables and outputs, scene action messages. Four languages, the
// four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './zabbix/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your Zabbix and an API token in the configuration.',
    fr: "Saisissez l'adresse de votre Zabbix et un jeton d'API dans la configuration.",
    de: 'Gib die Adresse deines Zabbix und ein API-Token in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Zabbix y un token de API en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2/zabbix',
    fr: 'Adresse incomprise, ex. http://192.168.1.2/zabbix',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2/zabbix',
    es: 'Dirección no válida, p. ej. http://192.168.1.2/zabbix',
  },
};

// One short explanation per error kind (src/zabbix/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Zabbix does not answer',
    fr: 'Zabbix ne répond pas',
    de: 'Zabbix antwortet nicht',
    es: 'Zabbix no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API token refused or expired',
    fr: "jeton d'API refusé ou expiré",
    de: 'API-Token abgelehnt oder abgelaufen',
    es: 'token de API rechazado o caducado',
  },
  [ERROR_KINDS.TOKEN_MISSING]: {
    en: 'an API token is needed: Users → API tokens in Zabbix',
    fr: "un jeton d'API est nécessaire : Utilisateurs → Jetons API dans Zabbix",
    de: 'ein API-Token ist nötig: Benutzer → API-Token in Zabbix',
    es: 'se necesita un token de API: Usuarios → Tokens de API en Zabbix',
  },
  [ERROR_KINDS.NOT_ZABBIX]: {
    en: 'no Zabbix API at this address',
    fr: "pas d'API Zabbix à cette adresse",
    de: 'keine Zabbix-API unter dieser Adresse',
    es: 'no hay ninguna API de Zabbix en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.VERSION]: {
    en: 'Zabbix 5.4 or later is needed (API tokens)',
    fr: "Zabbix 5.4 ou plus récent est nécessaire (jetons d'API)",
    de: 'Zabbix 5.4 oder neuer ist nötig (API-Token)',
    es: 'se necesita Zabbix 5.4 o posterior (tokens de API)',
  },
  [ERROR_KINDS.GROUPS]: {
    en: 'no host group with these names',
    fr: "aucun groupe d'hôtes de ce nom",
    de: 'keine Hostgruppe mit diesen Namen',
    es: 'ningún grupo de hosts con estos nombres',
  },
  [ERROR_KINDS.API]: {
    en: 'request refused by Zabbix, see the logs',
    fr: 'requête refusée par Zabbix, voir les logs',
    de: 'Anfrage von Zabbix abgelehnt, sieh in den Protokollen nach',
    es: 'petición rechazada por Zabbix, consulte los registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// Severity names of the Zabbix frontend, in each language.
export const SEVERITY_TEXT = [
  { en: 'Not classified', fr: 'Non classé', de: 'Nicht klassifiziert', es: 'No clasificado' },
  { en: 'Information', fr: 'Information', de: 'Information', es: 'Información' },
  { en: 'Warning', fr: 'Avertissement', de: 'Warnung', es: 'Advertencia' },
  { en: 'Average', fr: 'Moyen', de: 'Durchschnittlich', es: 'Promedio' },
  { en: 'High', fr: 'Haut', de: 'Hoch', es: 'Alta' },
  { en: 'Disaster', fr: 'Désastre', de: 'Katastrophe', es: 'Desastre' },
];

export const NO_PROBLEM_TEXT = {
  en: 'No problem',
  fr: 'Aucun problème',
  de: 'Kein Problem',
  es: 'Ningún problema',
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    hosts: (count) => `${count} host(s)`,
    problems: (count) => `${count} problem(s)`,
    missing: (names) => `unknown group(s): ${names}`,
  },
  fr: {
    ok: 'OK',
    hosts: (count) => `${count} hôte(s)`,
    problems: (count) => `${count} problème(s)`,
    missing: (names) => `groupe(s) inconnu(s) : ${names}`,
  },
  de: {
    ok: 'OK',
    hosts: (count) => `${count} Host(s)`,
    problems: (count) => `${count} Problem(e)`,
    missing: (names) => `unbekannte Gruppe(n): ${names}`,
  },
  es: {
    ok: 'OK',
    hosts: (count) => `${count} host(s)`,
    problems: (count) => `${count} problema(s)`,
    missing: (names) => `grupo(s) desconocido(s): ${names}`,
  },
};

// Scene action messages (shown in Gladys).
export const ACTION_TEXT = {
  noServer: {
    en: 'No Zabbix is configured.',
    fr: "Aucun Zabbix n'est configuré.",
    de: 'Kein Zabbix ist konfiguriert.',
    es: 'No hay ningún Zabbix configurado.',
  },
  unknownHost: {
    en: 'This device is not a Zabbix host.',
    fr: "Cet appareil n'est pas un hôte Zabbix.",
    de: 'Dieses Gerät ist kein Zabbix-Host.',
    es: 'Este dispositivo no es un host de Zabbix.',
  },
  acknowledgeDisabled: {
    en: 'Acknowledging is turned off in the configuration of the integration.',
    fr: "L'acquittement est désactivé dans la configuration de l'intégration.",
    de: 'Das Bestätigen ist in der Konfiguration der Integration ausgeschaltet.',
    es: 'El reconocimiento está desactivado en la configuración de la integración.',
  },
  acknowledgeRefused: {
    en: 'Zabbix refused to acknowledge: check that the token user may acknowledge problems.',
    fr: "Zabbix a refusé l'acquittement : vérifiez que l'utilisateur du jeton peut acquitter.",
    de: 'Zabbix hat das Bestätigen abgelehnt: Prüfe, ob der Token-Benutzer Probleme bestätigen darf.',
    es: 'Zabbix rechazó el reconocimiento: compruebe que el usuario del token puede reconocer problemas.',
  },
  defaultMessage: {
    en: 'Acknowledged from Gladys',
    fr: 'Acquitté depuis Gladys',
    de: 'In Gladys bestätigt',
    es: 'Reconocido desde Gladys',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
export const severityName = (severity, language) =>
  severity >= 0 ? pick(SEVERITY_TEXT[severity], language) : pick(NO_PROBLEM_TEXT, language);
