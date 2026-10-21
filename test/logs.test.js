// -----------------------------------------------------------------------------
// What reaches `docker logs`: the lifecycle at info level, everything per
// notification at debug level, repeated failures once, never the token.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_ACTIONS } from '../src/app.js';
import { ALICE, BASE_CONFIG, BOB, TOKEN, addDevice, createWorld, settle } from './helpers/world.js';

/**
 * Captures the lines of the SDK logger (console.log for debug/info,
 * console.error for warn/error), at every level.
 */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const lines = [];
  // The SDK logger writes `[time] [LEVEL] [name]` then the arguments.
  const capture = (prefix, ...args) => {
    const [, level, name] = /\[(DEBUG|INFO|WARN|ERROR)\](?: \[([^\]]+)\])?/.exec(prefix) ?? [];
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    lines.push({ level: level?.toLowerCase(), name, text });
  };
  t.mock.method(console, 'log', capture);
  t.mock.method(console, 'error', capture);
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  return {
    lines,
    at: (...levels) => lines.filter((line) => levels.includes(line.level)).map((l) => l.text),
    clear: () => lines.splice(0),
  };
}

test('a normal cycle writes nothing at info level', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.ok(logs.at('info').some((line) => line.startsWith('Connected to Mastodon as')));
  await addDevice(world);
  logs.clear();
  world.server.notify('mention', ALICE, { text: 'lights off' });
  world.server.notify('follow', BOB);
  await settle();
  await world.wake(); // the 5-minute refresh
  world.server.dropSockets(); // a server restart: the stream comes back at once
  await settle();
  await world.fake.widgetGet('mastodon', { language: 'en', settings: {} });
  assert.equal(world.fake.sceneEvents.length, 2);
  assert.deepEqual(logs.at('info', 'warn', 'error'), []);
  assert.ok(logs.at('debug').length > 0, 'the details are at debug level');
});

test('one line per action of the user', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  logs.clear();
  await world.fake.sceneAction(SCENE_ACTIONS.POST, { message: 'hello' });
  assert.deepEqual(logs.at('info'), ['Status posted by a scene (unlisted)']);
});

test('a server down: one line when it starts, none per retry', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  logs.clear();
  world.server.down = 'ECONNREFUSED';
  world.server.dropSockets();
  await settle();
  for (let i = 0; i < 8; i += 1) {
    await world.wake();
  }
  const failures = logs
    .at('warn', 'error')
    .filter((line) => line.startsWith('Mastodon unreachable'));
  assert.equal(failures.length, 1);
  world.server.down = null;
  await world.wake();
  assert.ok(logs.at('info').includes('Mastodon reachable again'));
  assert.ok(!logs.at('info').some((line) => line.startsWith('Connected to Mastodon')));
});

test('no log line ever holds the token', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld({ config: { ...BASE_CONFIG, access_token: 'secret-token-x' } });
  t.after(() => world.app.stop());
  const ok = await createWorld();
  t.after(() => ok.app.stop());
  await ok.fake.sceneAction(SCENE_ACTIONS.DIRECT, { recipient: 'nobody', message: 'x' });
  await ok.fake.sceneAction(SCENE_ACTIONS.POST, {
    message: 'x',
    image_url: 'http://user:camera-password@camera.example/x.jpg',
  });
  const all = logs.lines.map((line) => line.text).join('\n');
  assert.ok(all.length > 0);
  for (const secret of ['secret-token-x', TOKEN, 'camera-password']) {
    assert.equal(all.includes(secret), false, secret);
  }
});
