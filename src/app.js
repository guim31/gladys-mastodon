// -----------------------------------------------------------------------------
// The integration: one Mastodon account (or GoToSocial, Akkoma, Pleroma)
// wired to Gladys.
//
// - A connection loop: the REST API (who am I, the server), then the
//   streaming API, which pushes every new notification. Every 5 minutes, and
//   after a cut, the notifications are read back by REST from the last one
//   handled: nothing is missed, nothing is handled twice. Without streaming
//   (refused by a proxy), the notifications are read every minute.
// - Notifications fire the scene triggers: mention, private mention, new
//   follower, boost or favourite. Mentions fire only for the allowed
//   accounts (an empty list: nobody); followers, boosts and favourites for all. Never on a notification of the
//   account itself, never on one older than 10 minutes.
// - The device: four counters, read every 5 minutes and after a notification.
// - Scene actions: post a status (unlisted by default, content warning,
//   optional image), send a private mention — only to an allowed account or
//   one the account follows. At most 30 posts an hour from scenes.
// - The connection status of the Configuration screen, the widget and the
//   `test_connection` action.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, parseAccount, parseServer } from './config.js';
import {
  ERROR_KINDS,
  MastodonClient,
  MastodonError,
  NOTIFICATIONS_PAGE,
  TRANSIENT_KINDS,
  compareIds,
} from './mastodon/client.js';
import { openStream } from './mastodon/stream.js';
import { TRIGGERS, fullAcct, sceneEventOf } from './notifications.js';
import { buildDevice, counterStates, deviceIds } from './device.js';
import { fetchImage } from './image.js';
import { createFailureLog } from './log.js';
import { Store } from './store.js';
import { REPORT_TEXT, each, errorText, errorTexts } from './texts.js';
import { CONNECTION, READ_ACTION, TEST_ACTION, WIDGET_KEY, buildWidgetContent } from './widgets.js';

export { TRIGGERS };

const logger = createLogger({ name: 'mastodon' });

export const ACTION_KEY = 'test_connection';
export const SCENE_ACTIONS = { POST: 'post_status', DIRECT: 'send_direct_message' };
export const POST_VISIBILITIES = ['public', 'unlisted', 'private'];
export const DEFAULT_VISIBILITY = 'unlisted';

// Counters and catch-up, while the streaming API is up.
export const REFRESH_MS = 5 * 60 * 1000;
// Notifications older than this when read (missed while Gladys or the
// container was down) fire nothing: "@home open the garage" from two hours ago
// must not run now.
export const MAX_NOTIFICATION_AGE_MS = 10 * 60 * 1000;
export const RETRY_DELAYS_MS = [2000, 5000, 10_000, 30_000, 60_000];
// A refused token or a wrong address: retry slowly, in case the server was the cause.
export const CREDENTIALS_RETRY_MS = 5 * 60 * 1000;
// An unchanged counter is published again after this long ("no recent value" after 48 h).
export const HEARTBEAT_MS = 12 * 60 * 60 * 1000;
// Posts from scenes: a scene answering a mention, itself answered by another
// bot, must not flood the account (Mastodon allows 300 posts in 3 hours).
export const MAX_POSTS_PER_HOUR = 30;
export const RECENT_KEPT = 5;
const SEEN_KEPT = 200;
// Catch-up after a cut: 5 pages of 40 notifications at most.
export const CATCH_UP_PAGES = 5;
const STATUS_ID = /^[A-Za-z0-9_-]{1,64}$/;

// "@" followed by a zero-width joiner: Mastodon addresses a direct status to
// every account mentioned in its text, so a text echoed from a trigger
// ("Reply: {{text}}") must not add a stranger.
export const withoutMentions = (value) => value.replace(/@(?=[\w.-])/g, '@\u2060');

const text = (value) => (typeof value === 'string' ? value : '');

const recentKind = (notification) =>
  ({
    mention: 'mention',
    follow: 'follow',
    follow_request: 'request',
    reblog: 'boost',
    favourite: 'favourite',
  })[notification.type];

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} [options] replaced by the tests
 * @param {typeof fetch} [options.fetch]
 * @param {typeof WebSocket} [options.WebSocket]
 * @param {{ load(): Promise<object>, save(data: object): Promise<void>, flush(): Promise<void> }} [options.store]
 * @param {() => number} [options.now] milliseconds
 * @param {(ms: number, signal: AbortSignal) => Promise<void>} [options.sleep]
 */
export function registerHandlers(gladys, options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    store = new Store(),
    now = () => Date.now(),
    sleep = (ms, signal) =>
      new Promise((resolve) => {
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
      }),
  } = options;

  let data = {}; // persisted: { lastId, recent }
  const loaded = store.load().then((stored) => {
    data = stored && typeof stored === 'object' ? stored : {};
  });

  let config = normalizeConfig({});
  let configKey = null;
  let client = null;
  let account = null; // { id, acct } — acct with its domain
  let domain = '';
  let maxCharacters = 500;
  let streamUrl = null;
  let allowed = new Set();
  let configError = new MastodonError(ERROR_KINDS.NOT_CONFIGURED, 'Not configured yet');
  let connection = CONNECTION.NOT_CONFIGURED;
  let lastError = null;
  let counters = null; // { followers, following, statuses, unread }
  let stream = null;
  let streamFailures = 0;
  let nudge = null; // wakes the connected loop up (stream closed)
  let controller = null; // aborts the running loop
  let running = null;
  let applying = Promise.resolve();
  let processing = Promise.resolve(); // notifications are handled one at a time, in order
  let seen = new Set();
  let lastStatus = null;
  let lastDevice = null;
  let countersRun = null;
  let countersAgain = false;
  let postTimes = [];
  const connectionLog = createFailureLog(logger, { recovered: 'Mastodon reachable again' });
  const streamLog = createFailureLog(logger, { recovered: 'Mastodon streaming API works again' });
  const statusLog = createFailureLog(logger, { recovered: 'Connection status published again' });
  const stateLog = createFailureLog(logger, { recovered: 'Counters published again' });

  const save = () => store.save(data);
  const ids = () => (account ? deviceIds(gladys, domain, account.id) : null);

  // --- Gladys side effects, never fatal --------------------------------------

  async function publishStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === lastStatus || !gladys.connected) {
      return;
    }
    try {
      await gladys.setConnectionStatus(connected, message);
      lastStatus = key;
      statusLog.ok();
    } catch (err) {
      statusLog.fail(`Cannot publish the connection status: ${err.message}`);
    }
  }

  function refreshWidget() {
    if (gladys.connected) {
      gladys.requestWidgetRefresh(WIDGET_KEY); // fire and forget, dropped while disconnected
    }
  }

  async function fire(key, payload) {
    try {
      await gladys.publishSceneEvent(key, payload);
      logger.debug(`Trigger ${key} fired`);
    } catch (err) {
      logger.warn(`Cannot fire the trigger ${key}: ${err.message}`);
    }
  }

  async function publishDevice() {
    const device = buildDevice(gladys, account, domain, config.language);
    const key = JSON.stringify(device);
    if (key === lastDevice) {
      return;
    }
    try {
      await gladys.publishDiscoveredDevices([device]);
      lastDevice = key;
    } catch (err) {
      logger.warn(`Cannot publish the Mastodon device: ${err.message}`);
    }
  }

  // States of a feature not added to Gladys yet are dropped by the core: only
  // the device the user added is fed, and it is fed again when added.
  async function publishCounters() {
    const deviceId = ids()?.device;
    if (!counters || !deviceId || !(gladys.devices ?? []).some((d) => d.external_id === deviceId)) {
      return;
    }
    const states = counterStates(
      ids(),
      {
        followers_count: counters.followers,
        following_count: counters.following,
        statuses_count: counters.statuses,
      },
      counters.unread,
    );
    try {
      await gladys.publishChangedStates(
        states.map((state) => ({
          device_feature_external_id: state.external_id,
          state: state.value,
        })),
        { heartbeat: HEARTBEAT_MS },
      );
      stateLog.ok();
    } catch (err) {
      stateLog.fail(`Cannot publish the counters: ${err.message}`);
    }
  }

  // --- Mastodon ------------------------------------------------------------------

  async function refreshCounters(signal, credentials) {
    const current = credentials ?? (await client.verifyCredentials({ signal }));
    const unread = await client.unreadCount({ signal });
    const next = {
      followers: current.followers_count,
      following: current.following_count,
      statuses: current.statuses_count,
      unread,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(counters);
    counters = next;
    await publishCounters();
    if (changed) {
      refreshWidget();
    }
  }

  // After a notification: once, and once more if others came in the meantime.
  function scheduleCounters() {
    if (countersRun) {
      countersAgain = true;
      return countersRun;
    }
    const signal = controller?.signal;
    countersRun = (async () => {
      do {
        countersAgain = false;
        if (!client || signal?.aborted) {
          return;
        }
        try {
          await refreshCounters(signal);
        } catch (err) {
          logger.debug(`Counters not refreshed: ${err.message}`);
        }
      } while (countersAgain);
    })().finally(() => {
      countersRun = null;
    });
    return countersRun;
  }

  function remember(id) {
    seen.add(id);
    if (seen.size > SEEN_KEPT) {
      seen.delete(seen.values().next().value);
    }
  }

  async function handle(notification) {
    const id = typeof notification?.id === 'string' ? notification.id : null;
    if (!id || seen.has(id) || !account) {
      return;
    }
    remember(id);
    if (!data.lastId || compareIds(id, data.lastId) > 0) {
      data.lastId = id;
      save();
    }
    const event = sceneEventOf(notification, { selfId: account.id, domain });
    if (!event) {
      return;
    }
    scheduleCounters();
    if (event.key !== TRIGGERS.DIRECT) {
      // Never a private mention on the dashboard.
      data.recent = [
        {
          kind: recentKind(notification),
          author: event.author,
          text: event.key === TRIGGERS.FOLLOWER ? '' : (event.data.text ?? '').slice(0, 200),
          at: new Date(Date.parse(notification.created_at) || now()).toISOString(),
        },
        ...(data.recent ?? []),
      ].slice(0, RECENT_KEPT);
      save();
      refreshWidget();
    }
    const age = now() - Date.parse(notification.created_at);
    if (!(age <= MAX_NOTIFICATION_AGE_MS)) {
      logger.debug(`Notification ${id} is too old for the triggers`);
      return;
    }
    if (
      [TRIGGERS.MENTION, TRIGGERS.DIRECT].includes(event.key) &&
      !allowed.has(event.author) // an empty list: nobody (a "garage" scene obeys no stranger)
    ) {
      logger.debug(`Mention from @${event.author} ignored: not an allowed account`);
      return;
    }
    await fire(event.key, event.data);
  }

  const enqueue = (notification) => {
    processing = processing
      .then(() => handle(notification))
      .catch((err) => {
        logger.warn(`Notification not handled: ${err.message}`);
      });
    return processing;
  };

  // The notifications after the last one handled, oldest first. The very
  // first time, only the place is taken: the history fires nothing.
  async function catchUp(signal, from) {
    if (!data.lastId) {
      const latest = await client.notifications({ signal });
      latest.forEach((notification) => remember(notification.id));
      data.lastId = latest[0]?.id ?? '0';
      if (!data.recent) {
        data.recent = latest
          .filter((n) => n.type !== 'mention' || n.status?.visibility !== 'direct')
          .map((n) => ({ n, kind: recentKind(n) }))
          .filter(({ kind, n }) => kind && n.account?.id !== account.id)
          .slice(0, RECENT_KEPT)
          .map(({ n, kind }) => {
            const event = sceneEventOf(n, { selfId: account.id, domain });
            return {
              kind,
              author: fullAcct(n.account, domain),
              text:
                kind === 'follow' || kind === 'request'
                  ? ''
                  : (event?.data.text ?? '').slice(0, 200),
              at: new Date(Date.parse(n.created_at) || now()).toISOString(),
            };
          });
      }
      save();
      return;
    }
    // From the id taken before the stream opened: what the stream brought
    // meanwhile moves lastId, never the start of the catch-up.
    let after = from ?? (data.lastId === '0' ? undefined : data.lastId);
    for (let page = 0; page < CATCH_UP_PAGES; page += 1) {
      // min_id: the page right after `after` (oldest first), not the newest one.
      const list = await client.notifications({ minId: after, signal });
      const ordered = [...list].sort((a, b) => compareIds(a.id, b.id));
      ordered.forEach(enqueue);
      await processing;
      if (list.length < NOTIFICATIONS_PAGE || ordered.length === 0) {
        break;
      }
      after = ordered.at(-1).id;
    }
  }

  function closeStream() {
    const current = stream;
    stream = null;
    current?.close();
  }

  async function startStream(signal) {
    stream = await openStream({
      signal,
      url: streamUrl,
      token: config.access_token,
      WebSocket: WebSocketImpl,
      onNotification: (notification) => {
        enqueue(notification);
      },
      onClose: (code) => {
        logger.debug(`Streaming API closed (${code})`);
        stream = null;
        nudge?.abort();
      },
    });
  }

  // The state of /data belongs to one account of one server: another one
  // (a configuration changed while the container was stopped) starts afresh.
  function adoptAccount(key) {
    if (data.account === key) {
      return;
    }
    if (data.account !== undefined || data.lastId) {
      data = { recent: [] };
      seen = new Set();
    }
    data.account = key;
    save();
  }

  async function connectOnce(signal) {
    const credentials = await client.verifyCredentials({ signal });
    const server = await client.instance({ signal });
    domain = server.domain;
    maxCharacters = server.maxCharacters;
    streamUrl = client.streamingUrl(server.streaming);
    const previous = account?.acct;
    account = { id: String(credentials.id), acct: fullAcct(credentials, domain) };
    allowed = new Set(
      config.allowed_accounts.map((entry) => parseAccount(entry, domain)).filter(Boolean),
    );
    adoptAccount(`${client.base.host}|${account.id}`);
    await publishDevice();
    const from = data.lastId;
    await ensureStream(signal);
    await catchUp(signal, from);
    await refreshCounters(signal, credentials);
    connection = CONNECTION.CONNECTED;
    lastError = null;
    if (!connectionLog.failing || previous !== account.acct) {
      logger.info(`Connected to Mastodon as @${account.acct}`);
    }
    connectionLog.ok();
    await publishStatus(true);
    refreshWidget();
  }

  // Opened before each catch-up: a notification posted in between comes
  // through one or the other (the ids already handled are skipped).
  async function ensureStream(signal) {
    if (stream || signal.aborted) {
      return;
    }
    try {
      await startStream(signal);
      streamFailures = 0;
      streamLog.ok();
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      streamFailures += 1;
      streamLog.fail(
        `Mastodon streaming API unavailable, reading the notifications every minute: ${err.message}`,
      );
    }
  }

  async function runConnected(signal) {
    while (!signal.aborted) {
      const wait = stream
        ? REFRESH_MS
        : RETRY_DELAYS_MS[Math.min(streamFailures - 1, RETRY_DELAYS_MS.length - 1)];
      nudge = new AbortController();
      await sleep(wait, AbortSignal.any([signal, nudge.signal]));
      if (signal.aborted) {
        return;
      }
      const from = data.lastId;
      await ensureStream(signal);
      await catchUp(signal, from);
      await refreshCounters(signal);
    }
  }

  async function loop(signal) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        await connectOnce(signal);
        attempt = 0;
        await runConnected(signal);
      } catch (err) {
        if (signal.aborted) {
          break;
        }
        closeStream();
        lastError = err;
        connection = CONNECTION.DISCONNECTED;
        connectionLog.fail(`Mastodon unreachable: ${err.message}`);
        await publishStatus(false, errorTexts(err));
        refreshWidget();
        const wait = TRANSIENT_KINDS.has(err.kind)
          ? RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
          : CREDENTIALS_RETRY_MS;
        attempt += 1;
        await sleep(wait, signal);
      }
    }
    closeStream();
  }

  // --- Configuration -------------------------------------------------------------

  async function stopLoop() {
    controller?.abort();
    await running;
    await countersRun;
    controller = null;
    running = null;
  }

  function applyConfig(raw) {
    // Serialized: two saves in a row must never leave two loops running.
    applying = applying.then(() => doApplyConfig(raw));
    return applying;
  }

  async function doApplyConfig(raw) {
    await loaded;
    const next = normalizeConfig(raw);
    const key = JSON.stringify(next);
    if (key === configKey && running) {
      // Gladys reconnected with the same configuration: keep the connection.
      lastStatus = null;
      lastDevice = null;
      if (connection === CONNECTION.CONNECTED) {
        await publishStatus(true);
        await publishDevice();
      } else if (lastError) {
        await publishStatus(false, errorTexts(lastError));
      }
      return;
    }
    await stopLoop();
    const previousAccount = `${config.server_url}|${config.access_token}`;
    config = next;
    configKey = key;
    client = null;
    lastError = null;
    counters = null;
    if (`${config.server_url}|${config.access_token}` !== previousAccount) {
      account = null;
      lastDevice = null;
      if (previousAccount !== '|') {
        // Another server or account: start again from its newest notification.
        data = { recent: [] };
        seen = new Set();
        save();
      }
    }
    const server = parseServer(config.server_url);
    if (config.server_url === '') {
      configError = new MastodonError(ERROR_KINDS.NOT_CONFIGURED, 'No server address');
    } else if (!server) {
      configError = new MastodonError(ERROR_KINDS.INVALID_URL, 'Server address not understood');
    } else if (config.access_token === '') {
      configError = new MastodonError(ERROR_KINDS.NO_TOKEN, 'No access token');
    } else {
      configError = null;
    }
    if (configError) {
      connection = CONNECTION.NOT_CONFIGURED;
      await publishStatus(false, errorTexts(configError));
      refreshWidget();
      return;
    }
    client = new MastodonClient({ server, token: config.access_token, fetch: fetchImpl, sleep });
    connection = CONNECTION.CONNECTING;
    controller = new AbortController();
    running = loop(controller.signal);
  }

  // --- Posting ---------------------------------------------------------------------

  const clipStatus = (value) => {
    const characters = Array.from(value);
    return characters.length > maxCharacters
      ? `${characters.slice(0, maxCharacters - 1).join('')}…`
      : value;
  };

  function requireConnection() {
    if (!client || !account || connection !== CONNECTION.CONNECTED) {
      throw lastError ?? configError ?? new MastodonError(ERROR_KINDS.UNREACHABLE, 'Not connected');
    }
  }

  async function post({ status, visibility, spoiler, imageUrl, imageDescription, inReplyTo }) {
    requireConnection();
    const hourAgo = now() - 60 * 60 * 1000;
    postTimes = postTimes.filter((time) => time > hourAgo);
    if (postTimes.length >= MAX_POSTS_PER_HOUR) {
      throw new MastodonError(ERROR_KINDS.TOO_MANY_POSTS, 'Too many posts from scenes');
    }
    const mediaIds = [];
    if (imageUrl) {
      const image = await fetchImage(imageUrl, { fetch: fetchImpl });
      mediaIds.push(await client.uploadMedia(image, imageDescription.slice(0, 1500)));
    }
    const body = { status: clipStatus(status), visibility };
    if (spoiler) {
      body.spoiler_text = spoiler.slice(0, 500);
    }
    if (mediaIds.length > 0) {
      body.media_ids = mediaIds;
    }
    if (inReplyTo) {
      body.in_reply_to_id = inReplyTo;
    }
    const created = await client.postStatus(body);
    postTimes.push(now()); // only what was posted counts
    scheduleCounters();
    return created;
  }

  // An allowed account, or one the account follows: never a stranger.
  async function isKnown(acct) {
    if (allowed.has(acct)) {
      return true;
    }
    const found = await client.lookup(acct);
    if (!found?.id) {
      return false;
    }
    const relation = await client.relationship(String(found.id));
    return relation?.following === true;
  }

  const failed = (err) => ({
    sent: false,
    status_id: '',
    url: '',
    error: errorText(err, config.language),
  });

  gladys.onSceneAction(SCENE_ACTIONS.POST, async (fields) => {
    const message = text(fields?.message).trim();
    const visibility = POST_VISIBILITIES.includes(fields?.visibility)
      ? fields.visibility
      : DEFAULT_VISIBILITY;
    if (message === '') {
      return failed(new MastodonError(ERROR_KINDS.REJECTED, 'Empty message'));
    }
    try {
      const created = await post({
        status: message,
        visibility,
        spoiler: text(fields?.content_warning).trim(),
        imageUrl: text(fields?.image_url).trim(),
        imageDescription: text(fields?.image_description).trim(),
      });
      logger.info(`Status posted by a scene (${visibility})`);
      return {
        sent: true,
        status_id: String(created.id ?? ''),
        url: String(created.url ?? ''),
        error: '',
      };
    } catch (err) {
      logger.warn(`Status not posted: ${err.message}`);
      return failed(err);
    }
  });

  gladys.onSceneAction(SCENE_ACTIONS.DIRECT, async (fields) => {
    const message = text(fields?.message).trim();
    const replyTo = text(fields?.in_reply_to).trim();
    try {
      requireConnection();
      const recipient = parseAccount(text(fields?.recipient), domain);
      if (message === '') {
        throw new MastodonError(ERROR_KINDS.REJECTED, 'Empty message');
      }
      if (!recipient || !(await isKnown(recipient))) {
        throw new MastodonError(
          ERROR_KINDS.UNKNOWN_RECIPIENT,
          'Recipient not allowed nor followed',
        );
      }
      const created = await post({
        status: `@${recipient} ${withoutMentions(message)}`,
        visibility: 'direct',
        spoiler: '',
        imageUrl: '',
        imageDescription: '',
        inReplyTo: STATUS_ID.test(replyTo) ? replyTo : undefined,
      });
      logger.info('Private mention sent by a scene');
      return {
        sent: true,
        status_id: String(created.id ?? ''),
        url: String(created.url ?? ''),
        error: '',
      };
    } catch (err) {
      logger.warn(`Private mention not sent: ${err.message}`);
      return failed(err);
    }
  });

  // --- Test, widget ------------------------------------------------------------------

  async function testConnection() {
    if (configError) {
      return each(REPORT_TEXT, (t, lang) => t.failed(errorText(configError, lang)));
    }
    try {
      const credentials = await client.verifyCredentials();
      const server = await client.instance();
      const unread = await client.unreadCount();
      const acct = fullAcct(credentials, server.domain);
      const count = config.allowed_accounts.length;
      return each(REPORT_TEXT, (t) =>
        [
          t.connected(acct),
          t.counters(credentials.followers_count ?? 0, unread),
          count > 0 ? t.allowed(count) : t.anyone,
        ].join(' '),
      );
    } catch (err) {
      return each(REPORT_TEXT, (t, lang) => t.failed(errorText(err, lang)));
    }
  }

  async function markRead() {
    try {
      requireConnection();
      const [latest] = await client.notifications({ limit: 1 });
      if (latest?.id) {
        await client.markRead(latest.id);
      }
      logger.info('Notifications marked as read from the widget');
      await refreshCounters(controller?.signal);
      return each(REPORT_TEXT, (t) => t.read);
    } catch (err) {
      return each(REPORT_TEXT, (t, lang) => t.failed(errorText(err, lang)));
    }
  }

  const toast = (report) =>
    each(report, (value) => (value.length > 200 ? `${value.slice(0, 199)}…` : value));

  gladys.onAction(ACTION_KEY, async () => toast(await testConnection()));

  gladys.onWidgetGet(WIDGET_KEY, async ({ language }) =>
    buildWidgetContent(
      { connection, account: account?.acct ?? null, counters, recent: data.recent ?? [] },
      language,
    ),
  );

  gladys.onWidgetAction(WIDGET_KEY, async (actionKey) => {
    if (actionKey === TEST_ACTION) {
      return toast(await testConnection());
    }
    if (actionKey === READ_ACTION) {
      return toast(await markRead());
    }
    throw new Error(`Unknown widget action "${actionKey}"`);
  });

  // --- Device ---------------------------------------------------------------------------

  gladys.onDeviceCreated(async (device) => {
    if (device?.external_id && device.external_id === ids()?.device) {
      gladys.forgetPublishedStates(device.external_id);
      await publishCounters();
      refreshWidget();
    }
  });

  // Published with should_poll: false; this only serves a Gladys that polls anyway.
  gladys.onPoll(async () => {
    if (client && connection === CONNECTION.CONNECTED) {
      await scheduleCounters();
    }
  });

  gladys.onConfigUpdated((raw) => applyConfig(raw));

  gladys.on('connected', () => {
    lastStatus = null; // a new connection: publish the status again
    return applyConfig(gladys.config).catch((err) =>
      logger.error('Cannot apply the configuration', err),
    );
  });

  return {
    get config() {
      return config;
    },
    get connection() {
      return connection;
    },
    get data() {
      return data;
    },
    get streaming() {
      return stream !== null;
    },
    async stop() {
      await applying;
      await stopLoop();
      await processing;
      save();
      await store.flush();
    },
  };
}
