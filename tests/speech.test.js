import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeRecognition {
  static instances = [];
  constructor() {
    FakeRecognition.instances.push(this);
    this.aborted = false;
  }
  start() {
    this.onstart?.();
  }
  abort() {
    this.aborted = true;
  }
}

// speech.js picks the recognizer up from `window` when it is first loaded.
globalThis.window = { SpeechRecognition: FakeRecognition };
const { Listener, speechSupported } = await import('../src/speech.js');

const result = (text, isFinal = false) => Object.assign([{ transcript: text }], { isFinal });
const latest = () => FakeRecognition.instances.at(-1);

function makeListener() {
  const events = { interim: [], final: [], status: [], ended: 0 };
  const listener = new Listener({
    onInterim: (t) => events.interim.push(t),
    onFinal: (t) => events.final.push(t),
    onEnd: () => events.ended++,
    onStatus: (kind, detail) => events.status.push([kind, detail]),
  });
  return { listener, events };
}

beforeEach(() => {
  FakeRecognition.instances = [];
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
});

test('speech recognition is detected', () => {
  assert.equal(speechSupported, true);
});

test('start() begins a continuous English session with interim results', () => {
  const { listener, events } = makeListener();
  listener.start();
  const rec = latest();
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(rec.lang, 'en-US');
  assert.equal(rec.continuous, true);
  assert.equal(rec.interimResults, true);
  assert.deepEqual(events.status.at(-1), ['listening', undefined]);
});

test('switching language while running restarts recognition in the new language', () => {
  const { listener } = makeListener();
  listener.start();
  const first = latest();
  listener.setLang('zh');
  assert.equal(first.aborted, true);
  assert.equal(FakeRecognition.instances.length, 2);
  assert.equal(latest().lang, 'zh-CN');
});

test('English interim fragments are joined with spaces', () => {
  const { listener, events } = makeListener();
  listener.start();
  latest().onresult({ resultIndex: 0, results: [result('hello'), result('world')] });
  assert.deepEqual(events.interim, ['hello world']);
});

test('Chinese interim fragments are joined without spaces', () => {
  const { listener, events } = makeListener();
  listener.setLang('zh');
  listener.start();
  latest().onresult({ resultIndex: 0, results: [result('你好'), result('世界')] });
  assert.deepEqual(events.interim, ['你好世界']);
});

test('final results go to onFinal, not onInterim', () => {
  const { listener, events } = makeListener();
  listener.start();
  latest().onresult({ resultIndex: 0, results: [result('good evening', true)] });
  assert.deepEqual(events.final, ['good evening']);
  assert.deepEqual(events.interim, []);
});

test('a session that ends on its own is restarted quietly', () => {
  const { listener, events } = makeListener();
  listener.start();
  latest().onend();
  assert.equal(events.ended, 1);
  assert.equal(FakeRecognition.instances.length, 1);
  mock.timers.tick(250);
  assert.equal(FakeRecognition.instances.length, 2);
});

test('after an error the restart is delayed to 1.5 seconds', () => {
  const { listener } = makeListener();
  listener.start();
  const rec = latest();
  rec.onerror({ error: 'network' });
  rec.onend();
  mock.timers.tick(250);
  assert.equal(FakeRecognition.instances.length, 1);
  mock.timers.tick(1250);
  assert.equal(FakeRecognition.instances.length, 2);
});

test('a blocked microphone stops the listener and does not restart', () => {
  const { listener, events } = makeListener();
  listener.start();
  const rec = latest();
  rec.onerror({ error: 'not-allowed' });
  rec.onend();
  mock.timers.tick(5000);
  assert.equal(listener.running, false);
  assert.equal(FakeRecognition.instances.length, 1);
  assert.deepEqual(events.status.at(-1), ['error', 'not-allowed']);
});

test('no-speech errors are ignored', () => {
  const { listener, events } = makeListener();
  listener.start();
  latest().onerror({ error: 'no-speech' });
  assert.equal(events.status.some(([kind]) => kind === 'error'), false);
});

test('stop() aborts the session and reports the mic is off', () => {
  const { listener, events } = makeListener();
  listener.start();
  const rec = latest();
  listener.stop();
  assert.equal(rec.aborted, true);
  assert.equal(listener.running, false);
  assert.deepEqual(events.status.at(-1), ['off', undefined]);
});
