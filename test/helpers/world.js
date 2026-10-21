// -----------------------------------------------------------------------------
// The integration wired to the fake Gladys of the SDK and to a fake Mastodon
// server: a `fetch` replacement for the REST API and a WebSocket replacement
// for the streaming API, shaped like the answers of a real GoToSocial 0.22
// (test/fixtures/mastodon/, recorded, domain replaced by social.example).
// No network, a virtual clock, manual sleeps.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/mastodon/${name}.json`, import.meta.url), 'utf8'));

export const SERVER = 'https://social.example';
export const DOMAIN = 'social.example';
export const TOKEN = 'app-token-0123456789abcdefghij';
const me = fixture('verify-credentials');
export const SELF_ID = me.id;
export const START = Date.parse('2026-10-21T10:00:00Z');

export const BASE_CONFIG = {
  server_url: SERVER,
  access_token: TOKEN,
  allowed_accounts: '',
  language: 'en',
};

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const account = (id, acct) => ({
  ...fixture('notifications')[3].account,
  id,
  username: acct.split('@')[0],
  acct,
  display_name: acct.split('@')[0].replace(/^./, (c) => c.toUpperCase()),
  url: `https://${acct.split('@')[1] ?? DOMAIN}/@${acct.split('@')[0]}`,
});

export const ALICE = account('01ALICE00000000000000000AA', 'alice');
export const BOB = account('01BOB0000000000000000000BB', 'bob');
export const MALLORY = account('01MALLORY000000000000000MM', 'mallory@elsewhere.example');

/** A fake Mastodon server: just enough of the REST API and of the streaming API, recorded. */
export function createFakeServer() {
  const server = {
    down: null, // an error code (ECONNREFUSED...) makes every request fail
    tokens: new Set([TOKEN]),
    unreadCount: false, // GoToSocial: no /notifications/unread_count; Mastodon 4.3: true
    streaming: true, // false: the WebSocket is refused (a proxy without upgrade)
    me: { ...me, followers_count: 3, following_count: 2, statuses_count: 10 },
    accounts: [ALICE, BOB, MALLORY],
    following: new Set([ALICE.id]),
    notifications: [], // oldest first
    statuses: [], // posted by the integration
    media: [],
    marker: null,
    requests: [], // { method, path, query, body }
    sockets: [],
    images: new Map(), // address → Response factory, for the image of a post
    rejectStatuses: false,
    clock: () => START,
    counter: 0,
  };

  const nextId = () => {
    server.counter += 1;
    return `01Q${String(server.counter).padStart(23, '0')}`;
  };

  server.fetch = async (url, init = {}) => {
    const address = new URL(url);
    const method = init.method ?? 'GET';
    if (init.signal?.aborted) {
      throw init.signal.reason;
    }
    if (server.down) {
      throw new TypeError('fetch failed', { cause: { code: server.down } });
    }
    if (address.origin !== SERVER) {
      const image = server.images.get(address.href);
      server.requests.push({ method, path: address.href, headers: init.headers });
      return image ? image() : new Response('Not found', { status: 404 });
    }
    const path = address.pathname;
    const query = address.searchParams;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    server.requests.push({
      method,
      path,
      query: Object.fromEntries(query),
      body,
      headers: init.headers,
    });
    if (!path.startsWith('/api/')) {
      return new Response('<html>Not found</html>', { status: 404 });
    }
    const token = (init.headers?.authorization ?? '').replace(/^Bearer /, '');
    if (!server.tokens.has(token)) {
      return json(401, fixture('error-401'));
    }

    if (path === '/api/v1/accounts/verify_credentials') {
      return json(200, server.me);
    }
    if (path === '/api/v2/instance') {
      return json(200, fixture('instance-v2'));
    }
    if (path === '/api/v1/notifications/unread_count') {
      if (!server.unreadCount) {
        return json(404, { error: 'Not Found: notification not found' });
      }
      const after = server.notifications.filter((n) => !server.marker || n.id > server.marker);
      return json(200, { count: after.length });
    }
    if (path === '/api/v1/notifications') {
      const since = query.get('since_id');
      const limit = Number(query.get('limit') ?? 40);
      const list = server.notifications
        .filter((n) => !since || n.id > since)
        .reverse()
        .slice(0, limit);
      return json(200, list);
    }
    if (path === '/api/v1/markers') {
      if (method === 'POST') {
        server.marker = body.notifications.last_read_id;
        return json(200, { notifications: { last_read_id: server.marker, version: 1 } });
      }
      return json(200, server.marker ? { notifications: { last_read_id: server.marker } } : {});
    }
    if (method === 'POST' && path === '/api/v2/media') {
      const file = init.body.get('file');
      const media = {
        ...fixture('media'),
        id: nextId(),
        description: init.body.get('description') ?? null,
      };
      server.media.push({
        id: media.id,
        size: file.size,
        type: file.type,
        description: media.description,
      });
      return json(200, media);
    }
    if (method === 'POST' && path === '/api/v1/statuses') {
      if (server.rejectStatuses || !body.status) {
        return json(422, { error: 'Unprocessable Entity: status too long' });
      }
      const status = {
        ...fixture('status-created'),
        id: nextId(),
        content: `<p>${body.status}</p>`,
        visibility: body.visibility,
        spoiler_text: body.spoiler_text ?? '',
        url: `${SERVER}/@gladys/statuses/${server.counter}`,
      };
      server.statuses.push({
        ...body,
        id: status.id,
        idempotency: init.headers['idempotency-key'],
      });
      server.me.statuses_count += 1;
      return json(200, status);
    }
    if (path === '/api/v1/accounts/lookup') {
      const acct = query.get('acct').replace(`@${DOMAIN}`, '');
      const found = server.accounts.find((a) => a.acct === acct);
      return found ? json(200, found) : json(404, { error: `Not Found: @${acct} not found` });
    }
    if (path === '/api/v1/accounts/relationships') {
      return json(
        200,
        query.getAll('id[]').map((id) => ({
          ...fixture('relationships')[0],
          id,
          following: server.following.has(id),
        })),
      );
    }
    return json(404, { error: 'Not Found' });
  };

  /** A new notification, pushed to the open sockets as the streaming API does. */
  server.notify = (type, from, { text = 'hello', visibility = 'public', at } = {}) => {
    const base = fixture('notifications');
    const sample = base.find((n) => n.type === (type === 'follow' ? 'follow_request' : type));
    const notification = {
      ...sample,
      id: nextId(),
      type,
      created_at: new Date(at ?? server.clock()).toISOString(),
      account: from,
    };
    if (type === 'mention') {
      notification.status = {
        ...sample.status,
        id: nextId(),
        visibility,
        account: from,
        url: `${SERVER}/@${from.username}/statuses/${server.counter}`,
        content: `<p><span class="h-card"><a href="${SERVER}/@gladys" class="u-url mention">@<span>gladys</span></a></span> ${text}</p>`,
      };
    }
    server.notifications.push(notification);
    server.sockets
      .filter((socket) => socket.open)
      .forEach((socket) =>
        socket.push({
          stream: ['user:notification'],
          event: 'notification',
          payload: JSON.stringify(notification),
        }),
      );
    return notification;
  };

  /** Closes every open socket, as a server restart would (code 1006). */
  server.dropSockets = () => {
    server.sockets.filter((socket) => socket.open).forEach((socket) => socket.drop(1006));
  };

  server.WebSocket = class FakeWebSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.open = false;
      this.listeners = {};
      server.sockets.push(this);
      setImmediate(() => {
        if (server.down || !server.streaming || !server.tokens.has(protocols?.[0])) {
          this.emit('error', {});
          this.drop(1006); // a refused token: closed before it opens, no reason
          return;
        }
        this.open = true;
        this.emit('open', {});
      });
    }

    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }

    emit(type, event) {
      (this.listeners[type] ?? []).forEach((listener) => listener(event));
    }

    push(data) {
      this.emit('message', { data: JSON.stringify(data) });
    }

    drop(code) {
      if (this.closed) {
        return;
      }
      this.closed = true;
      this.open = false;
      this.emit('close', { code });
    }

    close() {
      this.drop(1000);
    }
  };

  return server;
}

export function createMemoryStore(initial = {}) {
  return {
    data: structuredClone(initial),
    writes: 0,
    async load() {
      return structuredClone(this.data);
    },
    async save(data) {
      this.data = structuredClone(data);
      this.writes += 1;
    },
    async flush() {},
  };
}

/** Lets pending promises, fetches and socket events settle. */
export async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export async function createWorld({
  config = BASE_CONFIG,
  stored = {},
  server = createFakeServer(),
  devices,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const store = createMemoryStore(stored);
  const clock = { time: START };
  server.clock = () => clock.time;
  const sleeps = [];
  const app = registerHandlers(gladys, {
    fetch: server.fetch,
    WebSocket: server.WebSocket,
    store,
    now: () => clock.time,
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        const entry = { ms, resolve };
        sleeps.push(entry);
        signal?.addEventListener('abort', () => {
          sleeps.splice(sleeps.indexOf(entry) >>> 0, 1);
          resolve();
        });
      }),
  });
  /** Ends the oldest pending sleep, moving the clock forward by its length. */
  const wake = async () => {
    await settle();
    const entry = sleeps.shift();
    if (!entry) {
      throw new Error('nothing is sleeping');
    }
    clock.time += entry.ms;
    entry.resolve();
    await settle();
    return entry.ms;
  };
  await gladys.connect();
  await settle();
  return { gladys, fake: gladys.fake, server, store, clock, sleeps, wake, app };
}

/** Adds the discovered device to Gladys, as the user does from the Discovery tab. */
export async function addDevice(world) {
  const [device] = world.fake.discoveredDevices;
  await world.fake.deviceCreated(device);
  await settle();
  return device;
}
