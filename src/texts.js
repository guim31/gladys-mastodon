// -----------------------------------------------------------------------------
// Texts the integration writes outside the widget (src/widgets.js): the
// connection status, the "Test the connection" report, the errors and the
// names of the device features. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './mastodon/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** Applies `render` to each language of a table. */
export const each = (table, render) =>
  Object.fromEntries(Object.entries(table).map(([lang, value]) => [lang, render(value, lang)]));

// One short explanation per error kind (src/mastodon/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.NOT_CONFIGURED]: {
    en: 'enter the address of the server and the access token in the configuration',
    fr: "saisissez l'adresse du serveur et le jeton d'accès dans la configuration",
    de: 'gib die Adresse des Servers und das Zugriffstoken in der Konfiguration ein',
    es: 'introduzca la dirección del servidor y el token de acceso en la configuración',
  },
  [ERROR_KINDS.INVALID_URL]: {
    en: 'server address not understood, e.g. https://mastodon.social',
    fr: 'adresse du serveur incomprise, ex. https://mastodon.social',
    de: 'Serveradresse nicht verstanden, z. B. https://mastodon.social',
    es: 'dirección del servidor no válida, p. ej. https://mastodon.social',
  },
  [ERROR_KINDS.NO_TOKEN]: {
    en: 'enter the access token of the application',
    fr: "saisissez le jeton d'accès de l'application",
    de: 'gib das Zugriffstoken der Anwendung ein',
    es: 'introduzca el token de acceso de la aplicación',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the server does not answer',
    fr: 'le serveur ne répond pas',
    de: 'der Server antwortet nicht',
    es: 'el servidor no responde',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'the server answers too slowly',
    fr: 'le serveur répond trop lentement',
    de: 'der Server antwortet zu langsam',
    es: 'el servidor responde demasiado lento',
  },
  [ERROR_KINDS.NOT_MASTODON]: {
    en: 'no Mastodon API at this address: check it',
    fr: "pas d'API Mastodon à cette adresse : vérifiez-la",
    de: 'keine Mastodon-API unter dieser Adresse: prüfe sie',
    es: 'no hay API de Mastodon en esta dirección: revísela',
  },
  [ERROR_KINDS.TOKEN]: {
    en: 'access token refused (wrong or revoked): enter a new one',
    fr: "jeton d'accès refusé (erroné ou révoqué) : saisissez-en un nouveau",
    de: 'Zugriffstoken abgelehnt (falsch oder widerrufen): Gib ein neues ein',
    es: 'token de acceso rechazado (erróneo o revocado): introduzca uno nuevo',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'refused: does the token have the read and write:statuses scopes?',
    fr: 'refusé : le jeton a-t-il les portées read et write:statuses ?',
    de: 'abgelehnt: Hat das Token die Berechtigungen read und write:statuses?',
    es: 'rechazado: ¿tiene el token los permisos read y write:statuses?',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'not found on the server',
    fr: 'introuvable sur le serveur',
    de: 'auf dem Server nicht gefunden',
    es: 'no encontrado en el servidor',
  },
  [ERROR_KINDS.REJECTED]: {
    en: 'refused by the server (post too long or empty?)',
    fr: 'refusé par le serveur (message trop long ou vide ?)',
    de: 'vom Server abgelehnt (Beitrag zu lang oder leer?)',
    es: 'rechazado por el servidor (¿mensaje demasiado largo o vacío?)',
  },
  [ERROR_KINDS.RATE_LIMITED]: {
    en: 'too many requests: the server asks to slow down',
    fr: 'trop de requêtes : le serveur demande de ralentir',
    de: 'zu viele Anfragen: Der Server bittet um eine Pause',
    es: 'demasiadas solicitudes: el servidor pide ir más despacio',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'the server answered with an error',
    fr: 'le serveur a répondu par une erreur',
    de: 'der Server hat mit einem Fehler geantwortet',
    es: 'el servidor ha respondido con un error',
  },
  [ERROR_KINDS.IMAGE]: {
    en: 'image not read: an http(s) address of a JPEG, PNG, GIF or WebP up to 8 MB',
    fr: 'image illisible : une adresse http(s) d’un JPEG, PNG, GIF ou WebP de 8 Mo maximum',
    de: 'Bild nicht gelesen: eine http(s)-Adresse eines JPEG, PNG, GIF oder WebP bis 8 MB',
    es: 'imagen no leída: una dirección http(s) de un JPEG, PNG, GIF o WebP de hasta 8 MB',
  },
  [ERROR_KINDS.UNKNOWN_RECIPIENT]: {
    en: 'recipient refused: not an allowed account, nor one the account follows',
    fr: 'destinataire refusé : ni compte autorisé, ni compte suivi',
    de: 'Empfänger abgelehnt: weder erlaubtes noch gefolgtes Konto',
    es: 'destinatario rechazado: ni cuenta autorizada, ni cuenta seguida',
  },
  [ERROR_KINDS.TOO_MANY_POSTS]: {
    en: 'too many posts from scenes in the last hour: skipped',
    fr: 'trop de messages publiés par les scènes dans l’heure : ignoré',
    de: 'zu viele Beiträge von Szenen in der letzten Stunde: übersprungen',
    es: 'demasiados mensajes publicados por escenas en la última hora: omitido',
  },
};

/** The explanation of an error, in one language. */
export function errorText(err, language) {
  const text = ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.SERVER];
  return pick(text, language);
}

/** The explanation of an error, in the four languages. */
export const errorTexts = (err) =>
  each(ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.SERVER], (text) => text);

// The report of the "Test the connection" action (and of the widget button).
export const REPORT_TEXT = {
  en: {
    connected: (account) => `Connected as @${account}.`,
    counters: (followers, unread) => `${followers} followers, ${unread} unread notifications.`,
    allowed: (count) => `Allowed accounts: ${count}.`,
    anyone: 'No allowed account: the mentions start no scene.',
    read: 'Notifications marked as read.',
    failed: (error) => `Connection failed: ${error}.`,
  },
  fr: {
    connected: (account) => `Connecté en tant que @${account}.`,
    counters: (followers, unread) => `${followers} abonnés, ${unread} notifications non lues.`,
    allowed: (count) => `Comptes autorisés : ${count}.`,
    anyone: 'Aucun compte autorisé : les mentions ne démarrent aucune scène.',
    read: 'Notifications marquées comme lues.',
    failed: (error) => `Échec de la connexion : ${error}.`,
  },
  de: {
    connected: (account) => `Verbunden als @${account}.`,
    counters: (followers, unread) =>
      `${followers} Follower, ${unread} ungelesene Benachrichtigungen.`,
    allowed: (count) => `Erlaubte Konten: ${count}.`,
    anyone: 'Kein erlaubtes Konto: Erwähnungen starten keine Szene.',
    read: 'Benachrichtigungen als gelesen markiert.',
    failed: (error) => `Verbindung fehlgeschlagen: ${error}.`,
  },
  es: {
    connected: (account) => `Conectado como @${account}.`,
    counters: (followers, unread) => `${followers} seguidores, ${unread} notificaciones sin leer.`,
    allowed: (count) => `Cuentas autorizadas: ${count}.`,
    anyone: 'Ninguna cuenta autorizada: las menciones no inician ninguna escena.',
    read: 'Notificaciones marcadas como leídas.',
    failed: (error) => `Fallo de conexión: ${error}.`,
  },
};

// Names of the device features, in the language of the configuration (the
// names are fixed when the device is added to Gladys).
export const FEATURE_NAMES = {
  followers: { en: 'Followers', fr: 'Abonnés', de: 'Follower', es: 'Seguidores' },
  following: { en: 'Following', fr: 'Abonnements', de: 'Folge ich', es: 'Siguiendo' },
  statuses: { en: 'Posts', fr: 'Messages publiés', de: 'Beiträge', es: 'Publicaciones' },
  unread: {
    en: 'Unread notifications',
    fr: 'Notifications non lues',
    de: 'Ungelesene Benachrichtigungen',
    es: 'Notificaciones sin leer',
  },
};
