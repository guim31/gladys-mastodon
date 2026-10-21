// -----------------------------------------------------------------------------
// The pieces on their own: addresses typed by people, the HTML of a status,
// notification ids, the REST client (errors, rate limits, server variants),
// the streaming API and the image of a post.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccount, parseServer } from '../src/config.js';
import { ERROR_KINDS, MastodonClient, compareIds, retryAfter } from '../src/mastodon/client.js';
import { openStream } from '../src/mastodon/stream.js';
import { htmlToText, sceneEventOf, withoutLeadingMentions } from '../src/notifications.js';
import { MAX_IMAGE_BYTES, fetchImage } from '../src/image.js';
import { fixture } from './helpers/world.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('account addresses: as people type them, always with their domain', () => {
  assert.equal(parseAccount('@Alice@Mastodon.Social'), 'alice@mastodon.social');
  assert.equal(parseAccount('bob', 'social.example'), 'bob@social.example');
  assert.equal(parseAccount('https://mastodon.social/@carol'), 'carol@mastodon.social');
  assert.equal(parseAccount(' @dave_1 ', 'social.example'), 'dave_1@social.example');
  for (const wrong of ['', 'not an address', 'a@b@c', 'https://x.example/users/z']) {
    assert.equal(parseAccount(wrong, 'social.example'), null, wrong);
  }
});

test('server addresses: https implied, path dropped, no credentials', () => {
  assert.equal(parseServer('mastodon.social').href, 'https://mastodon.social/');
  assert.equal(parseServer('https://mastodon.social/@me/').href, 'https://mastodon.social/');
  assert.equal(parseServer('http://192.0.2.10:8080').href, 'http://192.0.2.10:8080/');
  assert.equal(parseServer('ftp://x.example'), null);
  assert.equal(parseServer('https://user:pass@x.example'), null);
  assert.equal(parseServer(''), null);
});

test('the HTML of a status becomes text, without the leading mentions', () => {
  const [, , , mention] = fixture('notifications');
  assert.equal(htmlToText(mention.status.content), '@gladys open the garage');
  assert.equal(withoutLeadingMentions('@gladys @bob@x.example, lights off'), 'lights off');
  assert.equal(htmlToText('<p>a &amp; b<br>c</p><p>d &#8364; &#x1F600;</p>'), 'a & b\nc\n\nd € 😀');
  assert.equal(htmlToText(null), '');
});

test('the recorded GoToSocial notifications map to their triggers', () => {
  const context = { selfId: 'someone-else', domain: 'social.example' };
  const keys = fixture('notifications').map((n) => sceneEventOf(n, context)?.key ?? null);
  assert.deepEqual(keys, [
    'post_interaction',
    'post_interaction',
    'new_follower',
    'mention_received',
    'direct_message_received',
    'new_follower',
  ]);
  assert.equal(sceneEventOf({ type: 'poll', account: { id: 'x' } }, context), null);
  assert.equal(sceneEventOf({ type: 'mention', account: { id: 'x' } }, context), null);
});

test('notification ids: Mastodon snowflakes by number, GoToSocial ULIDs by text', () => {
  assert.ok(compareIds('113000000000000001', '99999999999999999') > 0);
  assert.ok(compareIds('01M5EQ1F4QNV0G7X8KAJ35MGBV', '01M5EQ1F25MGRS6AMHHWER3Z89') > 0);
  assert.equal(compareIds('42', '42'), 0);
});

test('the client: typed errors, never the token in a message', async () => {
  const answers = [
    [json(401, fixture('error-401')), ERROR_KINDS.TOKEN],
    [json(403, { error: 'outside the authorized scopes' }), ERROR_KINDS.FORBIDDEN],
    [json(422, { error: 'too long' }), ERROR_KINDS.REJECTED],
    [json(503, { error: 'down' }), ERROR_KINDS.SERVER],
    [new Response('<html>nginx</html>', { status: 404 }), ERROR_KINDS.NOT_MASTODON],
    [new Response('<html>ok</html>', { status: 200 }), ERROR_KINDS.NOT_MASTODON],
  ];
  for (const [response, kind] of answers) {
    const client = new MastodonClient({
      server: new URL('https://social.example'),
      token: 'the-token',
      fetch: async () => response,
    });
    await assert.rejects(client.verifyCredentials(), (err) => {
      assert.equal(err.kind, kind);
      assert.equal(err.message.includes('the-token'), false);
      return true;
    });
  }
  const offline = new MastodonClient({
    server: new URL('https://social.example'),
    token: 't',
    fetch: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    },
  });
  await assert.rejects(offline.instance(), { kind: ERROR_KINDS.UNREACHABLE });
});

test('a 429: the wait comes from Retry-After or X-RateLimit-Reset', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  assert.equal(retryAfter(new Headers({ 'retry-after': '3' }), now), 3000);
  assert.equal(
    retryAfter(new Headers({ 'x-ratelimit-reset': '2026-10-21T10:05:00.000Z' }), now),
    300_000,
  );
  assert.equal(retryAfter(new Headers(), now), undefined);
});

test('the server: v2 then v1, the streaming host, the length of a post', async () => {
  const requests = [];
  const client = new MastodonClient({
    server: new URL('https://social.example'),
    token: 't',
    fetch: async (url) => {
      requests.push(new URL(url).pathname);
      if (new URL(url).pathname === '/api/v2/instance') {
        return json(404, { error: 'Not Found' });
      }
      return json(200, {
        uri: 'social.example',
        version: '3.5.0',
        urls: { streaming_api: 'wss://streaming.social.example' },
        configuration: { statuses: { max_characters: 1000 } },
      });
    },
  });
  const server = await client.instance();
  assert.deepEqual(requests, ['/api/v2/instance', '/api/v1/instance']);
  assert.deepEqual(server, {
    domain: 'social.example',
    maxCharacters: 1000,
    streaming: 'wss://streaming.social.example',
    version: '3.5.0',
  });
  assert.equal(
    client.streamingUrl(server.streaming),
    'wss://streaming.social.example/api/v1/streaming?stream=user%3Anotification',
  );
  // GoToSocial announces wss:// even over http://: the configured scheme wins.
  const local = new MastodonClient({ server: new URL('http://192.0.2.10:8080'), token: 't' });
  assert.equal(
    local.streamingUrl('wss://192.0.2.10:8080'),
    'ws://192.0.2.10:8080/api/v1/streaming?stream=user%3Anotification',
  );
  const fromFixture = await new MastodonClient({
    server: new URL('https://social.example'),
    token: 't',
    fetch: async () => json(200, fixture('instance-v2')),
  }).instance();
  assert.equal(fromFixture.domain, 'social.example');
  assert.equal(fromFixture.maxCharacters, 5000);
});

test('the stream: notifications parsed, other events ignored, refusal before open', async () => {
  const received = [];
  let socket;
  class FakeSocket {
    constructor(url, protocols) {
      socket = this;
      this.protocols = protocols;
      this.listeners = {};
      setImmediate(() => this.emit('open', {}));
    }
    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }
    emit(type, event) {
      (this.listeners[type] ?? []).forEach((listener) => listener(event));
    }
    close() {}
  }
  let closed = null;
  const stream = await openStream({
    url: 'wss://social.example/api/v1/streaming',
    token: 'tok',
    WebSocket: FakeSocket,
    onNotification: (n) => received.push(n),
    onClose: (code) => {
      closed = code;
    },
  });
  assert.deepEqual(socket.protocols, ['tok']);
  socket.emit('message', { data: JSON.stringify(fixture('stream-event')) });
  socket.emit('message', { data: JSON.stringify({ event: 'delete', payload: '123' }) });
  socket.emit('message', { data: 'not json' });
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'mention');
  socket.emit('close', { code: 1006 });
  assert.equal(closed, 1006);
  stream.close(); // already closed: nothing more

  class Refused extends FakeSocket {
    constructor(...args) {
      super(...args);
      this.listeners.open = [];
      setImmediate(() => this.emit('close', { code: 1006 }));
    }
    addEventListener(type, listener) {
      if (type !== 'open') {
        super.addEventListener(type, listener);
      }
    }
  }
  await assert.rejects(
    openStream({ url: 'wss://x', token: 'bad', WebSocket: Refused, onNotification() {} }),
    /closed \(1006\)/,
  );
});

test('the image of a post: an image type, a bounded size, credentials as Basic', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  let seen;
  const image = await fetchImage('http://me:secret@camera.example/snap.jpg', {
    fetch: async (url, init) => {
      seen = { url: String(url), authorization: init.headers.authorization };
      return new Response(jpeg, { headers: { 'content-type': 'image/jpg' } });
    },
  });
  assert.equal(seen.url, 'http://camera.example/snap.jpg');
  assert.equal(seen.authorization, `Basic ${Buffer.from('me:secret').toString('base64')}`);
  assert.equal(image.contentType, 'image/jpeg');
  assert.equal(image.extension, 'jpg');
  assert.deepEqual(image.buffer, jpeg);

  const cases = [
    ['file:///etc/passwd', null],
    [
      'http://camera.example/x',
      new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    ],
    ['http://camera.example/x', new Response('x', { status: 401 })],
    [
      'http://camera.example/x',
      new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), {
        headers: { 'content-type': 'image/png' },
      }),
    ],
  ];
  for (const [address, response] of cases) {
    await assert.rejects(fetchImage(address, { fetch: async () => response }), {
      kind: ERROR_KINDS.IMAGE,
    });
  }
});
