// -----------------------------------------------------------------------------
// The Gladys device of the Mastodon account: four counters
// (counter-sensor/integer, see test/gladys-rules.test.js) — followers,
// accounts followed, posts, unread notifications.
//
// Its external id is built from the server domain and the account id the
// server gives (stable, unlike the username): a renamed account stays the same
// device. Published with should_poll: false: the integration reads the
// counters on its own timer (src/app.js).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { FEATURE_NAMES, pick } from './texts.js';

export const DEVICE_TYPE = 'account';

// Suffixes of the feature external ids: permanent once published. Order = display order.
export const FEATURE_KEYS = Object.freeze({
  FOLLOWERS: 'followers',
  FOLLOWING: 'following',
  STATUSES: 'statuses',
  UNREAD: 'unread',
});

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 1_000_000_000;

/** "Example.Social:8080" + "1234" → "example.social-8080-1234". */
export const platformId = (domain, accountId) =>
  `${domain.toLowerCase().replace(/[^a-z0-9.-]/g, '-')}-${String(accountId)}`;

export const deviceIds = (gladys, domain, accountId) =>
  gladys.externalIds(DEVICE_TYPE, platformId(domain, accountId));

/**
 * The discovery payload of the account.
 * @param {object} gladys SDK client
 * @param {{ id: string, acct: string }} account acct with its domain
 * @param {string} domain
 * @param {string} language feature names language
 */
export function buildDevice(gladys, account, domain, language = 'fr') {
  const ids = deviceIds(gladys, domain, account.id);
  return {
    name: `Mastodon @${account.acct}`,
    external_id: ids.device,
    should_poll: false,
    features: Object.values(FEATURE_KEYS).map((key) => ({
      name: pick(FEATURE_NAMES[key], language),
      external_id: ids.feature(key),
      category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: COUNTER_MAX,
    })),
  };
}

/**
 * The states of the counters.
 * @param {{ followers_count?: number, following_count?: number, statuses_count?: number }} credentials
 * @param {number|null} unread
 */
export function counterStates(ids, credentials, unread) {
  const values = {
    [FEATURE_KEYS.FOLLOWERS]: credentials?.followers_count,
    [FEATURE_KEYS.FOLLOWING]: credentials?.following_count,
    [FEATURE_KEYS.STATUSES]: credentials?.statuses_count,
    [FEATURE_KEYS.UNREAD]: unread,
  };
  return Object.entries(values)
    .filter(([, value]) => Number.isInteger(value) && value >= 0)
    .map(([key, value]) => ({ external_id: ids.feature(key), value }));
}
