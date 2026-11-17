// Translation with automatic fallback:
//   1. phrasebook (exact, instant)
//   2. the provider chosen in settings
//   3. the remaining providers, in order, if that one fails
//
// Providers:
//   chrome    Chrome's on-device Translator API. Free, offline, no key.
//   gemini    Google Gemini API (free key from AI Studio). Best quality, uses the glossary.
//   mymemory  Free public endpoint, no key. Basic quality, small daily limit.

import { findPhrase, GLOSSARY } from './phrasebook.js';

const TIMEOUT_MS = 7000;

async function fetchJson(url, options = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function geminiPrompt(from) {
  const direction = from === 'en' ? 'English to Simplified Chinese' : 'Chinese to English';
  const glossary = GLOSSARY.length
    ? '\nAlways use these fixed translations for names and terms:\n' +
      GLOSSARY.map((g) => `${g.en} = ${g.zh}`).join('\n')
    : '';
  return (
    `You are a live interpreter at a wedding. Translate the user's message from ${direction}. ` +
    'The message is raw speech-recognition output: it may lack punctuation or contain small recognition errors, ' +
    'so translate the intended meaning naturally, warmly and concisely. Output only the translation.' +
    glossary
  );
}

export class CaptionTranslator {
  /** getConfig() returns { provider, geminiKey, geminiModel } */
  constructor(getConfig) {
    this.getConfig = getConfig;
    this.cache = new Map();
    this._chromeCache = {};
  }

  order() {
    const c = this.getConfig();
    const all = ['chrome', 'gemini', 'mymemory'];
    return [c.provider, ...all.filter((n) => n !== c.provider)].filter(
      (n) => n !== 'gemini' || c.geminiKey,
    );
  }

  /** @returns {Promise<{text: string, via: string}>} */
  async translate(text, from) {
    const to = from === 'en' ? 'zh' : 'en';
    const key = `${from}|${text}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const phrase = findPhrase(text, from);
    if (phrase) {
      const hit = { text: phrase, via: 'phrasebook' };
      this.cache.set(key, hit);
      return hit;
    }

    let lastError;
    for (const name of this.order()) {
      try {
        const out = ((await this['_' + name](text, from, to)) || '').trim();
        if (out) {
          const result = { text: out, via: name };
          this.cache.set(key, result);
          return result;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[translate:${name}]`, err);
      }
    }
    throw lastError || new Error('No translation provider available');
  }

  /** Call from a click handler: Chrome may need a user gesture to download its language models. */
  async warmUp() {
    if (!globalThis.Translator) {
      return { ok: false, msg: 'this browser has no on-device translation' };
    }
    try {
      await Promise.all([this._chromeTranslator('en', 'zh'), this._chromeTranslator('zh', 'en')]);
      return { ok: true };
    } catch (err) {
      return { ok: false, msg: err.message };
    }
  }

  // ---- providers -----------------------------------------------------------

  _chromeTranslator(from, to) {
    const key = from + to;
    if (!this._chromeCache[key]) {
      this._chromeCache[key] = (async () => {
        const ChromeTranslator = globalThis.Translator;
        if (!ChromeTranslator) throw new Error('Chrome Translator API not available');
        const targets = to === 'zh' ? ['zh', 'zh-Hans'] : [to];
        let last;
        for (const target of targets) {
          try {
            const pair = { sourceLanguage: from, targetLanguage: target };
            if ((await ChromeTranslator.availability(pair)) === 'unavailable') continue;
            return await ChromeTranslator.create(pair);
          } catch (e) {
            last = e;
          }
        }
        throw last || new Error(`No on-device ${from}→${to} model`);
      })().catch((e) => {
        delete this._chromeCache[key]; // retry next time
        throw e;
      });
    }
    return this._chromeCache[key];
  }

  async _chrome(text, from, to) {
    const t = await this._chromeTranslator(from, to);
    return t.translate(text);
  }

  async _gemini(text, from) {
    const { geminiKey, geminiModel } = this.getConfig();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
    const json = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: geminiPrompt(from) }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  }

  async _mymemory(text, from) {
    const pair = from === 'en' ? 'en|zh-CN' : 'zh-CN|en';
    const json = await fetchJson(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`,
    );
    const out = json.responseData?.translatedText ?? '';
    if (json.responseStatus !== 200 || /MYMEMORY WARNING/i.test(out)) {
      throw new Error('MyMemory limit reached');
    }
    return out;
  }
}
