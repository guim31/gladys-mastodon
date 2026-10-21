// -----------------------------------------------------------------------------
// Integration configuration (the `config_schema` of the manifest), normalized
// so the rest of the code never deals with `undefined`, stray spaces or a
// half-typed address.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js).
export const DEFAULT_CONFIG = {
  server_url: '',
  access_token: '',
  allowed_accounts: '',
  language: 'fr',
};

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// user@domain, as Mastodon writes it (letters, digits, "_", and "." or "-" for
// other servers' accounts).
const ACCOUNT = /^[a-z0-9_.-]+(?:@[a-z0-9.-]+\.[a-z0-9-]+|@[a-z0-9-]+)?$/i;

/** Splits a list typed in a text field: commas, semicolons, spaces or new lines. */
export function parseList(value) {
  const items = trimmed(value)
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return [...new Set(items)];
}

/**
 * An account as a person types it: "@alice@example.social", "alice@example.social",
 * "alice" (an account of the configured server), or the address of a profile
 * (https://example.social/@alice). Lower case, without the leading @.
 * @param {string} value
 * @param {string} [localDomain] the domain of the configured server, for "alice"
 * @returns {string|null}
 */
export function parseAccount(value, localDomain) {
  let text = trimmed(value);
  const profile = text.match(/^https?:\/\/([^/\s]+)\/@([^/@\s]+)\/?$/i);
  if (profile) {
    text = `${profile[2]}@${profile[1]}`;
  }
  text = text.replace(/^@/, '').toLowerCase();
  if (!ACCOUNT.test(text)) {
    return null;
  }
  if (!text.includes('@') && localDomain) {
    return `${text}@${localDomain.toLowerCase()}`;
  }
  return text;
}

/**
 * The server address as a URL, or null when it is empty or not understood.
 * A bare host name gets https://. A sub-path is dropped: the Mastodon API
 * always lives at the root of its domain.
 * @param {string} value
 * @returns {URL|null}
 */
export function parseServer(value) {
  const text = trimmed(value).replace(/\/+$/, '');
  if (text === '') {
    return null;
  }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return null;
    }
    url.search = '';
    url.hash = '';
    url.pathname = '/';
    return url;
  } catch {
    return null;
  }
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = raw ?? {};
  return {
    server_url: trimmed(config.server_url),
    access_token: trimmed(config.access_token),
    // Kept as typed: "alice" is completed with the domain of the server once known.
    allowed_accounts: parseList(config.allowed_accounts),
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}
