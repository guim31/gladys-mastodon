// -----------------------------------------------------------------------------
// A small client of the Mastodon REST API, the endpoints the integration needs:
// the account behind the token, the server (domain, streaming address, length
// of a post), notifications and their read marker, posting a status with an
// image, looking an account up and the relationship with it. Built on fetch,
// injected by the tests. GoToSocial, Akkoma and Pleroma implement the same API.
//
// Every failure is a MastodonError with a `kind` (below), so the callers and
// the texts never parse a server message. The token never appears in an error
// message nor in a log line.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

export const ERROR_KINDS = {
  NOT_CONFIGURED: 'not_configured',
  INVALID_URL: 'invalid_url',
  NO_TOKEN: 'no_token',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  NOT_MASTODON: 'not_mastodon',
  TOKEN: 'token',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  REJECTED: 'rejected',
  RATE_LIMITED: 'rate_limited',
  SERVER: 'server',
  IMAGE: 'image',
  UNKNOWN_RECIPIENT: 'unknown_recipient',
  TOO_MANY_POSTS: 'too_many_posts',
};

// Failures that say nothing about the configuration: the network or the server
// will come back, the connection loop retries.
export const TRANSIENT_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TIMEOUT,
  ERROR_KINDS.RATE_LIMITED,
  ERROR_KINDS.SERVER,
]);

export class MastodonError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, without secret
   * @param {object} [details]
   * @param {number} [details.status] HTTP status
   * @param {number} [details.retryAfterMs] wait asked by a 429
   */
  constructor(kind, message, { status, retryAfterMs, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MastodonError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export const REQUEST_TIMEOUT_MS = 15_000;
// The default length of a post on Mastodon, when the server does not say.
export const DEFAULT_MAX_CHARACTERS = 500;
// Mastodon returns 40 notifications at most per page (80 for some servers).
export const NOTIFICATIONS_PAGE = 40;
// Waiting for a media to be processed (POST /api/v2/media answers 202).
const MEDIA_POLLS = 10;
const MEDIA_POLL_MS = 1000;

function kindOf(status) {
  switch (status) {
    case 401:
      return ERROR_KINDS.TOKEN;
    case 403:
      return ERROR_KINDS.FORBIDDEN;
    case 404:
      return ERROR_KINDS.NOT_FOUND;
    case 429:
      return ERROR_KINDS.RATE_LIMITED;
    default:
      // Any other 4xx (a post too long, a malformed request): refused as is.
      return status >= 500 ? ERROR_KINDS.SERVER : ERROR_KINDS.REJECTED;
  }
}

const delay = (ms, signal) =>
  new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** The wait a 429 asks for: Retry-After (seconds), else X-RateLimit-Reset (a date). */
export function retryAfter(headers, now = Date.now()) {
  const seconds = Number(headers?.get?.('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const reset = Date.parse(headers?.get?.('x-ratelimit-reset') ?? '');
  return Number.isFinite(reset) && reset > now ? reset - now : undefined;
}

/**
 * Compares two notification ids: numbers on Mastodon (snowflakes, longer than
 * a double), ULIDs on GoToSocial (sortable as text).
 * @returns {number} < 0, 0 or > 0
 */
export function compareIds(a, b) {
  if (/^\d+$/.test(a) && /^\d+$/.test(b) && a.length !== b.length) {
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export class MastodonClient {
  /**
   * @param {object} options
   * @param {URL} options.server base address of the server
   * @param {string} options.token application access token
   * @param {typeof fetch} [options.fetch]
   * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleep]
   */
  constructor({ server, token, fetch: fetchImpl = globalThis.fetch, sleep = delay }) {
    this.base = server;
    this.token = token;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.unreadCountMissing = false; // GoToSocial has no /notifications/unread_count
  }

  url(path, query) {
    const url = new URL(path, this.base);
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) {
          url.searchParams.append(key, String(item));
        }
      }
    }
    return url;
  }

  /**
   * One request. Resolves with the JSON body of a 2xx answer.
   * @param {string} method
   * @param {string} path from the root, e.g. /api/v1/statuses
   */
  async request(
    method,
    path,
    { body, query, form, headers: extra, timeoutMs = REQUEST_TIMEOUT_MS, signal } = {},
  ) {
    if (!this.token) {
      throw new MastodonError(ERROR_KINDS.NO_TOKEN, 'No access token');
    }
    const headers = { authorization: `Bearer ${this.token}`, ...extra };
    let payload = form;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let response;
    try {
      response = await this.fetch(this.url(path, query), {
        method,
        headers,
        body: payload,
        redirect: 'error', // a redirect would carry the token elsewhere
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (signal?.aborted) {
        throw err; // stopped by the caller: not a failure of the server
      }
      if (err?.name === 'TimeoutError') {
        throw new MastodonError(ERROR_KINDS.TIMEOUT, `No answer within ${timeoutMs} ms`);
      }
      throw new MastodonError(
        ERROR_KINDS.UNREACHABLE,
        `Server unreachable: ${err?.cause?.code ?? err?.message}`,
      );
    }
    let data;
    const text = await response.text().catch(() => '');
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = null;
    }
    if (response.ok) {
      if (data === null) {
        throw new MastodonError(
          ERROR_KINDS.NOT_MASTODON,
          `Not a Mastodon answer (HTTP ${response.status})`,
        );
      }
      return data;
    }
    if (data === null && [404, 405].includes(response.status)) {
      // A web server that is not Mastodon: the address is wrong.
      throw new MastodonError(
        ERROR_KINDS.NOT_MASTODON,
        `No Mastodon API at this address (HTTP ${response.status})`,
        { status: response.status },
      );
    }
    // The server message never carries the token.
    const reason = typeof data?.error === 'string' ? data.error.slice(0, 200) : '';
    throw new MastodonError(
      kindOf(response.status),
      `${method} ${path}: HTTP ${response.status} ${reason}`.trim(),
      { status: response.status, retryAfterMs: retryAfter(response.headers) },
    );
  }

  /** The account behind the token, with its counters. */
  verifyCredentials(options) {
    return this.request('GET', '/api/v1/accounts/verify_credentials', options);
  }

  /**
   * What the integration needs to know about the server: its account domain,
   * the length of a post and the address of the streaming API.
   * @returns {Promise<{ domain: string, maxCharacters: number, streaming: string|null, version: string }>}
   */
  async instance(options) {
    let data;
    let v2 = true;
    try {
      data = await this.request('GET', '/api/v2/instance', options);
    } catch (err) {
      if (![ERROR_KINDS.NOT_FOUND, ERROR_KINDS.NOT_MASTODON].includes(err.kind)) {
        throw err;
      }
      v2 = false;
      data = await this.request('GET', '/api/v1/instance', options);
    }
    const max = Number(data?.configuration?.statuses?.max_characters);
    const streaming = v2 ? data?.configuration?.urls?.streaming : data?.urls?.streaming_api;
    return {
      domain: String(
        (v2 ? (data.account_domain ?? data.domain) : (data.account_domain ?? data.uri)) ??
          this.base.hostname,
      )
        .replace(/^https?:\/\//, '')
        .toLowerCase(),
      maxCharacters: Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_CHARACTERS,
      streaming: typeof streaming === 'string' ? streaming : null,
      version: typeof data?.version === 'string' ? data.version.slice(0, 80) : '',
    };
  }

  /**
   * The address of the WebSocket. The server may announce another host (a
   * separate streaming server): it is used then, with the scheme of the
   * configured address — GoToSocial announces wss:// even over http://.
   */
  streamingUrl(announced) {
    const url = new URL('/api/v1/streaming', this.base);
    try {
      const other = announced ? new URL(announced) : null;
      if (other && other.host !== this.base.host) {
        url.host = other.host;
      }
    } catch {
      // not an address: keep the server
    }
    url.protocol = this.base.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('stream', 'user:notification');
    return url.href;
  }

  /** The newest notifications first, after `sinceId` when given. */
  async notifications({ sinceId, limit = NOTIFICATIONS_PAGE, signal } = {}) {
    const data = await this.request('GET', '/api/v1/notifications', {
      query: { since_id: sinceId, limit },
      signal,
    });
    return Array.isArray(data) ? data : [];
  }

  /**
   * The unread notifications (after the read marker of the Mastodon apps).
   * Mastodon ≥ 4.3 counts them; elsewhere they are counted from the marker,
   * one page at most: the value is then capped at NOTIFICATIONS_PAGE.
   */
  async unreadCount({ signal } = {}) {
    if (!this.unreadCountMissing) {
      try {
        const data = await this.request('GET', '/api/v1/notifications/unread_count', { signal });
        const count = Number(data?.count);
        if (Number.isInteger(count) && count >= 0) {
          return count;
        }
      } catch (err) {
        if (![ERROR_KINDS.NOT_FOUND, ERROR_KINDS.NOT_MASTODON].includes(err.kind)) {
          throw err;
        }
      }
      this.unreadCountMissing = true;
    }
    const lastRead = await this.lastReadId({ signal });
    const list = await this.notifications({ sinceId: lastRead ?? undefined, signal });
    return list.length;
  }

  /** The read marker of the notifications, null when none was ever set. */
  async lastReadId({ signal } = {}) {
    const data = await this.request('GET', '/api/v1/markers', {
      query: { 'timeline[]': 'notifications' },
      signal,
    });
    const id = data?.notifications?.last_read_id;
    return typeof id === 'string' && id !== '' ? id : null;
  }

  /** Moves the read marker: every notification up to `id` is read. */
  markRead(id, options) {
    return this.request('POST', '/api/v1/markers', {
      body: { notifications: { last_read_id: id } },
      ...options,
    });
  }

  /**
   * Uploads an image, waits until the server processed it, resolves its id.
   * @param {{ buffer: Buffer, contentType: string, extension: string }} image
   * @param {string} [description] the alternative text
   */
  async uploadMedia(image, description, { signal } = {}) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([image.buffer], { type: image.contentType }),
      `gladys.${image.extension}`,
    );
    if (description) {
      form.append('description', description);
    }
    const media = await this.request('POST', '/api/v2/media', { form, signal, timeoutMs: 60_000 });
    if (typeof media?.id !== 'string' || media.id === '') {
      throw new MastodonError(ERROR_KINDS.SERVER, 'The server did not return a media id');
    }
    // A large image is processed in the background (202, url null): a status
    // attaching it before the end is refused.
    let current = media;
    for (let i = 0; i < MEDIA_POLLS && !current?.url; i += 1) {
      await this.sleep(MEDIA_POLL_MS, signal);
      current = await this.request('GET', `/api/v1/media/${encodeURIComponent(media.id)}`, {
        signal,
      });
    }
    return media.id;
  }

  /**
   * Publishes a status. An idempotency key makes a retried request a no-op.
   * @param {object} status { status, visibility, spoiler_text, media_ids, in_reply_to_id }
   */
  postStatus(status, options) {
    return this.request('POST', '/api/v1/statuses', {
      body: status,
      headers: { 'idempotency-key': randomUUID() },
      ...options,
    });
  }

  /** The account with this address (user@domain), or null when unknown. */
  async lookup(acct, { signal } = {}) {
    try {
      return await this.request('GET', '/api/v1/accounts/lookup', { query: { acct }, signal });
    } catch (err) {
      if (err.kind === ERROR_KINDS.NOT_FOUND) {
        return null;
      }
      throw err;
    }
  }

  /** The relationship of the account with another one: { following, followed_by... }. */
  async relationship(id, { signal } = {}) {
    const data = await this.request('GET', '/api/v1/accounts/relationships', {
      query: { 'id[]': id },
      signal,
    });
    return (Array.isArray(data) ? data : []).find((entry) => entry?.id === id) ?? null;
  }
}
