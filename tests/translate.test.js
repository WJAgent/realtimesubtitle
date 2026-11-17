import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CaptionTranslator } from '../src/translate.js';

const realFetch = globalThis.fetch;

function config(overrides = {}) {
  return { provider: 'chrome', geminiKey: '', geminiModel: 'gemini-2.5-flash', ...overrides };
}

function translator(overrides) {
  const cfg = config(overrides);
  return new CaptionTranslator(() => cfg);
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function myMemoryEcho() {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const pair = new URL(url).searchParams.get('langpair');
    return jsonResponse({ responseStatus: 200, responseData: { translatedText: `T(${pair})` } });
  };
  return calls;
}

beforeEach(() => {
  mock.method(console, 'warn', () => {});
  delete globalThis.Translator;
});

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  globalThis.fetch = realFetch;
  delete globalThis.Translator;
});

// ---- provider order -----------------------------------------------------------

test('order puts the chosen provider first and skips gemini without a key', () => {
  assert.deepEqual(translator({ provider: 'chrome' }).order(), ['chrome', 'mymemory']);
  assert.deepEqual(translator({ provider: 'mymemory' }).order(), ['mymemory', 'chrome']);
});

test('order includes gemini when a key is set', () => {
  assert.deepEqual(translator({ provider: 'chrome', geminiKey: 'k' }).order(), ['chrome', 'gemini', 'mymemory']);
  assert.deepEqual(translator({ provider: 'gemini', geminiKey: 'k' }).order(), ['gemini', 'chrome', 'mymemory']);
});

// ---- phrasebook and cache -----------------------------------------------------

test('phrasebook hits never call a provider', async () => {
  globalThis.fetch = async () => {
    throw new Error('network must not be used for phrasebook hits');
  };
  const out = await translator().translate('good evening, everyone!', 'en');
  assert.deepEqual(out, { text: '大家晚上好', via: 'phrasebook' });
});

test('a repeated line is served from the cache', async () => {
  const calls = myMemoryEcho();
  const t = translator({ provider: 'mymemory' });
  const first = await t.translate('Nice to meet you', 'en');
  const second = await t.translate('Nice to meet you', 'en');
  assert.equal(calls.length, 1);
  assert.deepEqual(second, first);
});

test('the cache is keyed by direction as well as text', async () => {
  myMemoryEcho();
  const t = translator({ provider: 'mymemory' });
  const fromEnglish = await t.translate('Anna', 'en');
  const fromChinese = await t.translate('Anna', 'zh');
  assert.equal(fromEnglish.text, 'T(en|zh-CN)');
  assert.equal(fromChinese.text, 'T(zh-CN|en)');
});

// ---- fallback -----------------------------------------------------------------

test('falls back to MyMemory when the on-device translator is unavailable', async () => {
  myMemoryEcho();
  const out = await translator({ provider: 'chrome' }).translate('Nice to meet you', 'en');
  assert.equal(out.via, 'mymemory');
});

test('MyMemory quota warnings are treated as failures, never shown as a translation', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      responseStatus: 200,
      responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' },
    });
  await assert.rejects(translator({ provider: 'mymemory' }).translate('Nice to meet you', 'en'));
  const failures = console.warn.mock.calls.filter((call) => call.arguments[0] === '[translate:mymemory]');
  assert.equal(failures.length, 1);
  assert.match(failures[0].arguments[1].message, /MyMemory limit reached/);
});

test('falls through to Gemini after a MyMemory quota warning', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('mymemory')) {
      return jsonResponse({
        responseStatus: 200,
        responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' },
      });
    }
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '很高兴认识你' }] } }] });
  };
  const out = await translator({ provider: 'mymemory', geminiKey: 'k' }).translate('Nice to meet you', 'en');
  assert.deepEqual(out, { text: '很高兴认识你', via: 'gemini' });
});

test('throws when no provider can translate', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(translator({ provider: 'mymemory' }).translate('Nice to meet you', 'en'));
});

test('a provider that hangs is aborted after the timeout', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  globalThis.fetch = (url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  const pending = translator({ provider: 'mymemory' }).translate('Nice to meet you', 'en');
  await new Promise((resolve) => setImmediate(resolve));
  mock.timers.tick(7000);
  await assert.rejects(pending);
  assert.equal(aborted, true);
});

// ---- Gemini request -----------------------------------------------------------

test('Gemini request carries the key in a header, never in the URL, and the right direction', async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url: String(url), options };
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '很高兴认识你' }] } }] });
  };
  const out = await translator({ provider: 'gemini', geminiKey: 'secret-key' }).translate('Nice to meet you', 'en');
  assert.equal(out.via, 'gemini');
  assert.ok(seen.url.includes('gemini-2.5-flash:generateContent'));
  assert.ok(!seen.url.includes('secret-key'));
  assert.equal(seen.options.headers['x-goog-api-key'], 'secret-key');
  const body = JSON.parse(seen.options.body);
  assert.match(body.systemInstruction.parts[0].text, /English to Simplified Chinese/);
  assert.equal(body.contents[0].parts[0].text, 'Nice to meet you');
});

test('Gemini prompt for Chinese speakers asks for Chinese to English', async () => {
  let body;
  globalThis.fetch = async (url, options) => {
    body = JSON.parse(options.body);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'Nice to meet you' }] } }] });
  };
  await translator({ provider: 'gemini', geminiKey: 'k' }).translate('很高兴认识你', 'zh');
  assert.match(body.systemInstruction.parts[0].text, /Chinese to English/);
});

// ---- Chrome on-device translator ---------------------------------------------

test('on-device translator falls back from "zh" to "zh-Hans" when needed', async () => {
  const created = [];
  globalThis.Translator = {
    availability: async ({ targetLanguage }) => (targetLanguage === 'zh' ? 'unavailable' : 'available'),
    create: async (pair) => {
      created.push(pair.targetLanguage);
      return { translate: async (text) => `[${pair.targetLanguage}] ${text}` };
    },
  };
  const out = await translator({ provider: 'chrome' }).translate('Nice to meet you', 'en');
  assert.deepEqual(out, { text: '[zh-Hans] Nice to meet you', via: 'chrome' });
  assert.deepEqual(created, ['zh-Hans']);
});

test('warmUp reports when the browser has no on-device translation', async () => {
  const result = await translator().warmUp();
  assert.equal(result.ok, false);
});
