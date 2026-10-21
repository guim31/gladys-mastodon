// -----------------------------------------------------------------------------
// The integration end to end: the fake Gladys of the SDK on one side, a fake
// Mastodon (REST and streaming API) answering like a real GoToSocial on the
// other.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KEY,
  CREDENTIALS_RETRY_MS,
  MAX_NOTIFICATION_AGE_MS,
  MAX_POSTS_PER_HOUR,
  REFRESH_MS,
  SCENE_ACTIONS,
  TRIGGERS,
} from '../src/app.js';
import { READ_ACTION, TEST_ACTION, WIDGET_KEY } from '../src/widgets.js';
import {
  ALICE,
  BASE_CONFIG,
  BOB,
  MALLORY,
  SELF_ID,
  START,
  TOKEN,
  addDevice,
  createFakeServer,
  createWorld,
  settle,
} from './helpers/world.js';

async function connected(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'connected');
  return world;
}

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const self = { ...ALICE, id: SELF_ID, username: 'gladys', acct: 'gladys' };

test('not configured: says what is missing, never calls the server', async (t) => {
  const server = createFakeServer();
  const world = await createWorld({ config: {}, server });
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'not_configured');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /address of the server/);

  await world.fake.configUpdated({ server_url: 'ftp://social.example' });
  assert.match(world.fake.connectionStatus.message.fr, /adresse du serveur incomprise/);
  await world.fake.configUpdated({ server_url: 'social.example' }); // https:// is implied
  assert.match(world.fake.connectionStatus.message.de, /Zugriffstoken der Anwendung/);
  assert.deepEqual(server.requests, []);
});

test('connection: the account found, its device published, the stream opened', async (t) => {
  const world = await connected(t);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  const [device] = world.fake.discoveredDevices;
  assert.equal(device.name, 'Mastodon @gladys@social.example');
  assert.equal(device.external_id, `ext:test-integration:account:social.example-${SELF_ID}`);
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.features.map((feature) => feature.name),
    ['Followers', 'Following', 'Posts', 'Unread notifications'],
  );
  const [socket] = world.server.sockets;
  // The token travels in the protocol header, never in the address.
  assert.equal(socket.url, 'wss://social.example/api/v1/streaming?stream=user%3Anotification');
  assert.deepEqual(socket.protocols, [TOKEN]);
  assert.ok(world.app.streaming);
});

test('the first start takes its place: the history fires nothing', async (t) => {
  const server = createFakeServer();
  server.notify('mention', ALICE, { text: 'old one' });
  server.notify('follow', BOB);
  const world = await connected(t, { server });
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.equal(world.app.data.lastId, server.notifications.at(-1).id);
  // The widget shows them, though.
  assert.deepEqual(
    world.app.data.recent.map((entry) => entry.kind),
    ['follow', 'mention'],
  );
});

test('a public mention fires mention_received, with its text and author', async (t) => {
  const world = await connected(t);
  const notification = world.server.notify('mention', ALICE, {
    text: 'open the garage &amp; the gate',
    visibility: 'unlisted',
  });
  await settle();
  assert.deepEqual(events(world, TRIGGERS.MENTION), [
    {
      key: TRIGGERS.MENTION,
      data: {
        author: 'alice@social.example',
        author_name: 'Alice',
        text: 'open the garage & the gate',
        visibility: 'unlisted',
        status_id: notification.status.id,
        url: notification.status.url,
      },
    },
  ]);
  assert.deepEqual(events(world, TRIGGERS.DIRECT), []);
});

test('a private mention fires direct_message_received only, and stays off the widget', async (t) => {
  const world = await connected(t);
  world.server.notify('mention', MALLORY, { text: 'secret', visibility: 'direct' });
  await settle();
  assert.deepEqual(events(world, TRIGGERS.MENTION), []);
  const [event] = events(world, TRIGGERS.DIRECT);
  assert.equal(event.data.author, 'mallory@elsewhere.example');
  assert.equal(event.data.text, 'secret');
  assert.equal(event.data.visibility, undefined);
  assert.deepEqual(world.app.data.recent, []);
});

test('followers, follow requests, boosts and favourites fire their triggers', async (t) => {
  const world = await connected(t);
  world.server.notify('follow', BOB);
  world.server.notify('follow_request', MALLORY);
  world.server.notify('reblog', BOB);
  world.server.notify('favourite', ALICE);
  await settle();
  assert.deepEqual(
    events(world, TRIGGERS.FOLLOWER).map((event) => [event.data.author, event.data.requested]),
    [
      ['bob@social.example', false],
      ['mallory@elsewhere.example', true],
    ],
  );
  assert.deepEqual(
    events(world, TRIGGERS.INTERACTION).map((event) => [event.data.kind, event.data.text]),
    [
      ['boost', 'Hello from Gladys'],
      ['favourite', 'Hello from Gladys'],
    ],
  );
});

test('the account itself never fires a trigger: no loop through a scene', async (t) => {
  const world = await connected(t);
  world.server.notify('mention', self, { text: 'posted by a scene' });
  world.server.notify('favourite', self);
  await settle();
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('allowed accounts: mentions from others fire nothing, followers still do', async (t) => {
  const world = await connected(t, {
    config: { ...BASE_CONFIG, allowed_accounts: '@Alice, https://elsewhere.example/@nobody' },
  });
  world.server.notify('mention', MALLORY, { text: 'open the garage' });
  world.server.notify('mention', MALLORY, { text: 'open the garage', visibility: 'direct' });
  world.server.notify('mention', ALICE, { text: 'lights off' });
  world.server.notify('follow', MALLORY);
  await settle();
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => [event.key, event.data.author]),
    [
      [TRIGGERS.MENTION, 'alice@social.example'],
      [TRIGGERS.FOLLOWER, 'mallory@elsewhere.example'],
    ],
  );
});

test('after a cut, the missed notifications are read back once, in order', async (t) => {
  const world = await connected(t);
  world.server.streaming = false; // the stream does not come back at once
  world.server.sockets[0].open = false; // dead, not closed yet: misses what follows
  world.server.notify('mention', ALICE, { text: 'first' });
  world.server.notify('mention', ALICE, { text: 'second' });
  world.server.sockets[0].drop(1006); // it closes: the loop reads by REST at once
  await settle();
  assert.deepEqual(
    events(world, TRIGGERS.MENTION).map((event) => event.data.text),
    ['first', 'second'],
  );
  assert.equal(world.app.streaming, false);
  // Without streaming, the notifications are read at the next retry delay.
  world.server.notify('mention', ALICE, { text: 'third' });
  world.server.streaming = true;
  await world.wake();
  assert.deepEqual(
    events(world, TRIGGERS.MENTION).map((event) => event.data.text),
    ['first', 'second', 'third'],
  );
  assert.ok(world.app.streaming);
  // The stream and the REST catch-up never deliver one twice.
  await world.wake();
  assert.equal(events(world, TRIGGERS.MENTION).length, 3);
});

test('a restart reads what came while stopped, but old notifications fire nothing', async (t) => {
  const server = createFakeServer();
  server.notify('mention', ALICE, { text: 'already handled' });
  const stored = {
    account: `social.example|${SELF_ID}`,
    lastId: server.notifications[0].id,
    recent: [],
  };
  server.notify('mention', ALICE, {
    text: 'too old',
    at: START - MAX_NOTIFICATION_AGE_MS - 1000,
  });
  server.notify('mention', ALICE, { text: 'recent', at: START - 60_000 });
  const world = await connected(t, { server, stored });
  assert.deepEqual(
    events(world, TRIGGERS.MENTION).map((event) => event.data.text),
    ['recent'],
  );
});

test('the counters: published once the device is added, read again on the timer', async (t) => {
  const world = await connected(t);
  assert.deepEqual(world.fake.states, [], 'nothing before the device is added');
  world.server.notify('mention', ALICE);
  world.server.notify('follow', BOB);
  await settle();
  const device = await addDevice(world);
  const id = (key) => `${device.external_id}:${key}`;
  assert.equal(world.fake.lastState(id('followers')), 3);
  assert.equal(world.fake.lastState(id('following')), 2);
  assert.equal(world.fake.lastState(id('statuses')), 10);
  assert.equal(world.fake.lastState(id('unread')), 2); // counted from the marker (GoToSocial)
  // The container reads the counters itself (Gladys does not poll this device).
  world.server.me.followers_count = 4;
  const before = world.server.requests.length;
  assert.equal(await world.wake(), REFRESH_MS);
  assert.equal(world.fake.lastState(id('followers')), 4);
  assert.ok(
    world.server.requests
      .slice(before)
      .some((request) => request.path === '/api/v1/accounts/verify_credentials'),
  );
});

test('Mastodon 4.3: the unread count comes from /notifications/unread_count', async (t) => {
  const server = createFakeServer();
  server.unreadCount = true;
  const world = await connected(t, { server });
  const device = await addDevice(world);
  world.server.notify('mention', ALICE);
  await settle();
  assert.equal(world.fake.lastState(`${device.external_id}:unread`), 1);
  assert.ok(!server.requests.some((request) => request.path === '/api/v1/markers'));
});

test('post_status: unlisted by default, content warning, image read from an address', async (t) => {
  const world = await connected(t);
  world.server.images.set(
    'http://camera.example/snapshot.jpg',
    () =>
      new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { 'content-type': 'image/jpeg' },
      }),
  );
  const ack = await world.fake.sceneAction(SCENE_ACTIONS.POST, {
    message: 'Someone rang at 10:00',
    content_warning: 'Doorbell',
    image_url: 'http://user:pa%3Ass@camera.example/snapshot.jpg',
    image_description: 'The front door',
  });
  assert.equal(ack.success, true);
  const [status] = world.server.statuses;
  assert.equal(status.status, 'Someone rang at 10:00');
  assert.equal(status.visibility, 'unlisted');
  assert.equal(status.spoiler_text, 'Doorbell');
  assert.deepEqual(world.server.media, [
    { id: status.media_ids[0], size: 4, type: 'image/jpeg', description: 'The front door' },
  ]);
  const imageRequest = world.server.requests.find((r) => r.path.startsWith('http://camera'));
  assert.equal(
    imageRequest.path,
    'http://camera.example/snapshot.jpg',
    'no credentials in the address',
  );
  assert.equal(
    imageRequest.headers.authorization,
    `Basic ${Buffer.from('user:pa:ss').toString('base64')}`,
  );
  assert.ok(status.idempotency);
  assert.deepEqual(ack.data.outputs, {
    sent: true,
    status_id: status.id,
    url: `https://social.example/@gladys/statuses/${world.server.counter}`,
    error: '',
  });
});

test('post_status: the chosen visibility, the text cut at the server length', async (t) => {
  const world = await connected(t);
  await world.fake.sceneAction(SCENE_ACTIONS.POST, {
    message: 'x'.repeat(6000),
    visibility: 'public',
  });
  const [status] = world.server.statuses;
  assert.equal(status.visibility, 'public');
  assert.equal(Array.from(status.status).length, 5000); // max_characters of the fixture
  assert.ok(status.status.endsWith('…'));
  await world.fake.sceneAction(SCENE_ACTIONS.POST, { message: 'x', visibility: 'direct' });
  assert.equal(world.server.statuses[1].visibility, 'unlisted', 'never direct by this action');
});

test('post_status: a failure is an output, in the configured language', async (t) => {
  const world = await connected(t);
  world.server.rejectStatuses = true;
  let ack = await world.fake.sceneAction(SCENE_ACTIONS.POST, { message: 'hello' });
  assert.equal(ack.success, true);
  assert.equal(ack.data.outputs.sent, false);
  assert.match(ack.data.outputs.error, /refused by the server/);
  ack = await world.fake.sceneAction(SCENE_ACTIONS.POST, {
    message: 'hello',
    image_url: 'http://camera.example/missing.jpg',
  });
  assert.match(ack.data.outputs.error, /image not read/);
  ack = await world.fake.sceneAction(SCENE_ACTIONS.POST, { message: '  ' });
  assert.equal(ack.data.outputs.sent, false);
});

test('post_status: at most 30 posts an hour from scenes', async (t) => {
  const world = await connected(t);
  for (let i = 0; i < MAX_POSTS_PER_HOUR; i += 1) {
    await world.fake.sceneAction(SCENE_ACTIONS.POST, { message: `post ${i}` });
  }
  const ack = await world.fake.sceneAction(SCENE_ACTIONS.POST, { message: 'one too many' });
  assert.equal(ack.data.outputs.sent, false);
  assert.match(ack.data.outputs.error, /too many posts/);
  assert.equal(world.server.statuses.length, MAX_POSTS_PER_HOUR);
  world.clock.time += 60 * 60 * 1000 + 1;
  const later = await world.fake.sceneAction(SCENE_ACTIONS.POST, { message: 'an hour later' });
  assert.equal(later.data.outputs.sent, true);
});

test('send_direct_message: to a followed account, in the same conversation', async (t) => {
  const world = await connected(t);
  const ack = await world.fake.sceneAction(SCENE_ACTIONS.DIRECT, {
    recipient: 'alice@social.example',
    message: 'The garage is closed.',
    in_reply_to: '01QABC',
  });
  assert.equal(ack.data.outputs.sent, true);
  assert.deepEqual(world.server.statuses[0], {
    ...world.server.statuses[0],
    status: '@alice@social.example The garage is closed.',
    visibility: 'direct',
    in_reply_to_id: '01QABC',
  });
});

test('send_direct_message: never to a stranger, unless the account is allowed', async (t) => {
  const world = await connected(t);
  for (const recipient of ['bob', 'nobody@elsewhere.example', 'not an address']) {
    const ack = await world.fake.sceneAction(SCENE_ACTIONS.DIRECT, { recipient, message: 'hi' });
    assert.equal(ack.data.outputs.sent, false, recipient);
    assert.match(ack.data.outputs.error, /recipient refused/);
  }
  assert.deepEqual(world.server.statuses, []);
  await world.fake.configUpdated({ ...BASE_CONFIG, allowed_accounts: 'bob' });
  await settle();
  const ack = await world.fake.sceneAction(SCENE_ACTIONS.DIRECT, {
    recipient: '@bob',
    message: 'hi',
  });
  assert.equal(ack.data.outputs.sent, true);
  assert.equal(world.server.statuses[0].status, '@bob@social.example hi');
});

test('a refused token: said in the Configuration screen, retried slowly', async (t) => {
  const server = createFakeServer();
  server.tokens = new Set(['another']);
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'disconnected');
  assert.match(world.fake.connectionStatus.message.en, /access token refused/);
  assert.equal(await world.wake(), CREDENTIALS_RETRY_MS);
  server.tokens = new Set([TOKEN]);
  await world.wake();
  assert.equal(world.app.connection, 'connected');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('the server down: disconnected, then back with what was missed', async (t) => {
  const world = await connected(t);
  world.server.down = 'ECONNREFUSED';
  world.server.dropSockets();
  await world.wake(); // nudged: the catch-up fails
  assert.equal(world.app.connection, 'disconnected');
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  world.server.down = null;
  world.server.notify('mention', ALICE, { text: 'while down' });
  await world.wake();
  assert.equal(world.app.connection, 'connected');
  assert.deepEqual(
    events(world, TRIGGERS.MENTION).map((event) => event.data.text),
    ['while down'],
  );
});

test('the test action reports the account, its counters and the allowed list', async (t) => {
  const world = await connected(t);
  const ack = await world.fake.action(ACTION_KEY, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message?.en ?? ack.data.en,
    'Connected as @gladys@social.example. 3 followers, 0 unread notifications. Allowed accounts: 2.',
  );
});

test('the widget: counters, last notifications, mark as read', async (t) => {
  const world = await connected(t);
  world.server.notify('mention', ALICE, { text: 'hello' });
  world.server.notify('follow', BOB);
  await settle();
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true);
  const [status, list, read, testButton] = ack.data.content.components;
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Mastodon', '@gladys@social.example'],
      ['Abonnés', 3],
      ['Non lues', 2],
    ],
  );
  assert.deepEqual(
    list.items.map((item) => [item.title, item.badge.text]),
    [
      ['@bob@social.example', 'Abonné'],
      ['@alice@social.example', 'Mention'],
    ],
  );
  assert.equal(read.action.key, READ_ACTION);
  assert.equal(testButton.action.key, TEST_ACTION);
  const done = await world.fake.widgetAction(WIDGET_KEY, READ_ACTION);
  assert.equal(done.success, true);
  assert.equal(world.server.marker, world.server.notifications.at(-1).id);
  const after = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.equal(after.data.content.components[0].items[2].value, 0);
  assert.ok(!after.data.content.components.some((c) => c.action?.key === READ_ACTION));
});

test('adding the device publishes the counters again and refreshes the widget', async (t) => {
  const world = await connected(t);
  const before = world.fake.widgetRefreshes.length;
  await addDevice(world);
  assert.ok(world.fake.states.length >= 4);
  assert.ok(world.fake.widgetRefreshes.length > before);
});

test('another account: starts again from its newest notification', async (t) => {
  const world = await connected(t);
  world.server.notify('mention', ALICE);
  await settle();
  world.server.tokens.add('other-token');
  await world.fake.configUpdated({ ...BASE_CONFIG, access_token: 'other-token' });
  await settle();
  assert.equal(world.app.connection, 'connected');
  assert.equal(world.app.data.lastId, world.server.notifications.at(-1).id);
  assert.equal(world.fake.sceneEvents.length, 1);
});

test('a long cut: read back from its oldest end, page after page', async (t) => {
  const world = await connected(t);
  world.server.sockets[0].open = false; // dead: misses what follows
  for (let i = 0; i < 60; i += 1) {
    world.server.notify('favourite', BOB);
  }
  world.server.notify('mention', ALICE, { text: 'in the middle' });
  for (let i = 0; i < 30; i += 1) {
    world.server.notify('favourite', BOB);
  }
  world.server.sockets[0].drop(1006);
  await settle(200);
  assert.equal(events(world, TRIGGERS.INTERACTION).length, 90);
  assert.deepEqual(
    events(world, TRIGGERS.MENTION).map((event) => event.data.text),
    ['in the middle'],
  );
  assert.equal(world.app.data.lastId, world.server.notifications.at(-1).id);
});

test('a notification during the reconnection is not lost', async (t) => {
  const server = createFakeServer();
  const world = await connected(t, { server });
  // The mention arrives while the new stream opens: no socket carries it,
  // then a newer favourite comes through the new stream. The catch-up after
  // the opening still starts before the mention.
  server.onSocket = () => {
    server.onSocket = null;
    server.notify('mention', ALICE, { text: 'between the two' });
    setImmediate(() => setImmediate(() => server.notify('favourite', BOB)));
  };
  server.sockets[0].drop(1006);
  await settle(100);
  assert.deepEqual(
    events(world, TRIGGERS.MENTION).map((event) => event.data.text),
    ['between the two'],
  );
  assert.equal(events(world, TRIGGERS.INTERACTION).length, 1);
});

test('a state of another account found in /data starts afresh', async (t) => {
  const server = createFakeServer();
  server.notify('mention', ALICE, { text: 'history' });
  const world = await connected(t, {
    server,
    stored: {
      account: 'old.example|42',
      lastId: '113000000000000001',
      recent: [
        { kind: 'follow', author: 'x@old.example', text: '', at: '2026-10-01T00:00:00.000Z' },
      ],
    },
  });
  assert.equal(world.app.data.account, `social.example|${SELF_ID}`);
  assert.equal(world.app.data.lastId, server.notifications.at(-1).id);
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.ok(!world.app.data.recent.some((entry) => entry.author === 'x@old.example'));
});

test('a private mention never adds a recipient from its text', async (t) => {
  const world = await connected(t);
  await world.fake.sceneAction(SCENE_ACTIONS.DIRECT, {
    recipient: 'alice',
    message: 'Reply: hello @stranger@evil.example and @bob',
  });
  const [status] = world.server.statuses;
  assert.equal(
    status.status,
    '@alice@social.example Reply: hello @\u2060stranger@\u2060evil.example and @\u2060bob',
  );
});

test('a failed post does not use the hourly quota', async (t) => {
  const world = await connected(t);
  for (let i = 0; i < MAX_POSTS_PER_HOUR + 5; i += 1) {
    await world.fake.sceneAction(SCENE_ACTIONS.POST, {
      message: 'x',
      image_url: 'http://camera.example/missing.jpg',
    });
  }
  const ack = await world.fake.sceneAction(SCENE_ACTIONS.POST, { message: 'works' });
  assert.equal(ack.data.outputs.sent, true);
});

test('stop() does not wait for a stream that never opens', async (t) => {
  const server = createFakeServer();
  server.WebSocket = class {
    addEventListener() {}
    close() {}
  };
  const world = await createWorld({ server });
  const started = Date.now();
  await world.app.stop();
  assert.ok(Date.now() - started < 1000);
  t.after(() => {});
});

test('no allowed account: mentions start nothing, followers still do', async (t) => {
  const world = await connected(t, { config: { ...BASE_CONFIG, allowed_accounts: '' } });
  world.server.notify('mention', ALICE, { text: 'open the garage' });
  world.server.notify('mention', ALICE, { text: 'open the garage', visibility: 'direct' });
  world.server.notify('follow', BOB);
  world.server.notify('favourite', BOB);
  await settle();
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.FOLLOWER, TRIGGERS.INTERACTION],
  );
  const ack = await world.fake.action(ACTION_KEY, {});
  assert.match(
    ack.data.message?.en ?? ack.data.en,
    /No allowed account: the mentions start no scene\./,
  );
});
