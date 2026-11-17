// Thin wrapper around the browser's Web Speech API (free; Chrome sends the audio to Google).
// It listens in ONE language at a time, so the operator tells it who is speaking.

const CODES = { en: 'en-US', zh: 'zh-CN' };
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const speechSupported = !!SR;

export class Listener {
  /** handlers: { onInterim(text), onFinal(text), onEnd(), onStatus(kind, detail) } */
  constructor(handlers) {
    this.h = handlers;
    this.lang = 'en';
    this.running = false;
    this.rec = null;
    this._timer = null;
    this._err = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._err = null;
    this._spawn();
  }

  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this._kill();
    this.h.onStatus?.('off');
  }

  setLang(lang) {
    this.lang = lang;
    if (this.running) {
      this._kill();
      this._spawn();
    }
  }

  _kill() {
    if (!this.rec) return;
    const r = this.rec;
    r.onstart = r.onresult = r.onerror = r.onend = null;
    try { r.abort(); } catch { /* already stopped */ }
    this.rec = null;
  }

  _spawn() {
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = CODES[this.lang];

    rec.onstart = () => this.h.onStatus?.('listening');

    rec.onresult = (ev) => {
      const joiner = this.lang === 'en' ? ' ' : '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) this.h.onFinal(text);
        else interim += (interim ? joiner : '') + text;
      }
      if (interim) this.h.onInterim(interim);
    };

    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      this._err = ev.error;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') this.running = false;
      this.h.onStatus?.('error', ev.error);
    };

    // Chrome ends sessions on its own after silence or a few minutes: restart quietly.
    rec.onend = () => {
      this.h.onEnd?.();
      if (this.running) {
        const delay = this._err ? 1500 : 250;
        this._err = null;
        this._timer = setTimeout(() => this.running && this._spawn(), delay);
      } else if (!this._err) {
        this.h.onStatus?.('off');
      }
    };

    this.rec = rec;
    try { rec.start(); } catch (e) { this.h.onStatus?.('error', e.message); }
  }
}
