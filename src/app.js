// Operator console: listens, translates, and tells the display window what to show.

import { bus } from './bus.js';
import { Listener, speechSupported } from './speech.js';
import { CaptionTranslator } from './translate.js';
import { PHRASES, normalize } from './phrasebook.js';

const $ = (sel) => document.querySelector(sel);

// ---- settings (saved in this browser only) ---------------------------------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
  },
};

const cfg = {
  provider: store.get('provider', 'chrome'),
  geminiKey: store.get('geminiKey', ''),
  geminiModel: store.get('geminiModel', 'gemini-flash-latest'),
  drafts: store.get('drafts', 'auto'),
  size: Number(store.get('size', 5)),
  lines: Number(store.get('lines', 3)),
  pos: store.get('pos', 'middle'),
};

// ---- state -----------------------------------------------------------------

let speakerLang = 'en';
let entries = [];   // everything shown so far; the last one may still be "live"
let current = null; // the live (not yet final) entry
let nextId = 1;
let idleTimer;
let draftTimer;
let lastDraftAt = 0;

const translator = new CaptionTranslator(() => cfg);

function makeEntry(srcLang, src) {
  return { id: nextId++, srcLang, src, tgt: '', final: false, seq: 0, via: '', t: new Date(), finalAt: 0 };
}

const draftsOn = () => cfg.drafts === 'on' || (cfg.drafts === 'auto' && cfg.provider === 'chrome');

// ---- publishing to the display ----------------------------------------------

function view(e) {
  return {
    id: e.id,
    srcLang: e.srcLang,
    final: e.final,
    en: e.srcLang === 'en' ? e.src : e.tgt,
    zh: e.srcLang === 'zh' ? e.src : e.tgt,
  };
}

function publish() {
  bus.postMessage({
    type: 'state',
    entries: entries.slice(-cfg.lines).map(view),
    size: cfg.size,
    pos: cfg.pos,
  });
}

bus.onmessage = (ev) => {
  if (ev.data?.type === 'hello') publish(); // a display window just opened
};

// ---- translation -------------------------------------------------------------

async function translateEntry(e) {
  const seq = ++e.seq; // ignore answers that arrive after newer text
  const asked = e.src;
  try {
    const r = await translator.translate(asked, e.srcLang);
    if (seq === e.seq) {
      e.tgt = r.text;
      e.via = r.via;
      $('#trStatus').textContent = `Last translation: ${r.via}`;
    }
  } catch (err) {
    if (seq === e.seq) $('#trStatus').textContent = `Translation failed: ${err.message}. Use "Type a line" to cover it.`;
  }
  publish();
  if (e.final) renderLog();
}

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => current && finalize(current.src), 4000);
}

function armDraft(e) {
  clearTimeout(draftTimer);
  const fire = () => {
    if (e.final || e.src === e.draftSrc) return;
    e.draftSrc = e.src;
    lastDraftAt = Date.now();
    translateEntry(e);
  };
  // Translate after a short pause, or every few seconds during a long run-on sentence.
  if (Date.now() - lastDraftAt > 2500) fire();
  else draftTimer = setTimeout(fire, 700);
}

function finalize(text) {
  clearTimeout(idleTimer);
  clearTimeout(draftTimer);
  if (!current) {
    const last = entries[entries.length - 1];
    if (last && last.final && last.srcLang === speakerLang && normalize(last.src) === normalize(text)) return; // duplicate
    current = makeEntry(speakerLang, text);
    entries.push(current);
  }
  current.src = text;
  current.final = true;
  current.finalAt = Date.now();
  const e = current;
  current = null;
  translateEntry(e);
  publish();
  renderLog();
}

// ---- speech ------------------------------------------------------------------

const listener = new Listener({
  onInterim(text) {
    if (!current) {
      current = makeEntry(speakerLang, text);
      entries.push(current);
      lastDraftAt = Date.now();
    } else {
      current.src = text;
    }
    armIdle();
    if (draftsOn()) armDraft(current);
    publish();
  },
  onFinal: finalize,
  onEnd() {
    if (current) finalize(current.src);
  },
  onStatus: setMic,
});

const MIC_ERRORS = {
  'not-allowed': 'Microphone blocked. Allow it in the address bar, then press Start.',
  'service-not-allowed': 'Speech service blocked. Allow the microphone in the address bar, then press Start.',
  'audio-capture': 'No microphone found.',
  network: 'Cannot reach the speech service. Check the internet connection.',
};

function setMic(kind, detail) {
  const status = $('#status');
  status.dataset.kind = kind;
  if (kind === 'listening') status.textContent = `Listening: ${speakerLang === 'en' ? 'English' : '中文'}`;
  else if (kind === 'error') status.textContent = MIC_ERRORS[detail] || `Mic problem: ${detail}`;
  else status.textContent = 'Mic off';
  $('#micBtn').textContent = listener.running ? 'Stop listening' : 'Start listening';
}

async function warmUp() {
  if (cfg.provider !== 'chrome') return;
  const note = $('#trStatus');
  note.textContent = 'Preparing on-device translation…';
  const r = await translator.warmUp();
  note.textContent = r.ok
    ? 'On-device translation ready.'
    : `On-device translation unavailable (${r.msg}). Using the online translators instead.`;
}

function toggleMic() {
  if (listener.running) {
    listener.stop();
    if (current) finalize(current.src);
    return;
  }
  if (!speechSupported) {
    $('#unsupported').hidden = false;
    return;
  }
  listener.lang = speakerLang;
  listener.start();
  warmUp(); // runs inside the click, so Chrome may download its language models
}

function setSpeaker(lang) {
  if (lang === speakerLang) return;
  if (current) finalize(current.src);
  speakerLang = lang;
  for (const b of document.querySelectorAll('#langSeg button')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  }
  listener.setLang(lang);
  if (listener.running) setMic('listening');
}

// ---- quick phrases, manual lines, transcript --------------------------------

function pushShown(e) {
  if (current) finalize(current.src);
  entries.push(e);
  publish();
  renderLog();
}

for (const p of PHRASES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.append(p.en);
  const small = document.createElement('small');
  small.textContent = p.zh;
  b.append(small);
  b.addEventListener('click', () => {
    const e = makeEntry('en', p.en);
    e.tgt = p.zh;
    e.final = true;
    e.via = 'phrasebook';
    e.finalAt = Date.now();
    pushShown(e);
  });
  $('#phrases').append(b);
}

$('#manualForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const src = $('#manSrc').value.trim();
  if (!src) return;
  const e = makeEntry($('#manLang').value, src);
  e.tgt = $('#manTgt').value.trim();
  e.final = true;
  e.finalAt = Date.now();
  pushShown(e);
  if (!e.tgt) translateEntry(e);
  $('#manSrc').value = '';
  $('#manTgt').value = '';
});

function renderLog() {
  const log = $('#log');
  const finals = entries.filter((e) => e.final).slice(-100).reverse();
  if (!finals.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing yet. Lines appear here once a sentence is finished.';
    log.replaceChildren(li);
    return;
  }
  log.replaceChildren(
    ...finals.map((e) => {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = e.t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const en = document.createElement('span');
      en.className = 'en';
      en.lang = 'en';
      en.textContent = e.srcLang === 'en' ? e.src : e.tgt || '…';
      const zh = document.createElement('span');
      zh.className = 'zh';
      zh.lang = 'zh-Hans';
      zh.textContent = e.srcLang === 'zh' ? e.src : e.tgt || '…';
      const fix = document.createElement('button');
      fix.type = 'button';
      fix.textContent = 'Edit';
      fix.addEventListener('click', () => {
        $('#manLang').value = e.srcLang;
        $('#manSrc').value = e.src;
        $('#manTgt').value = e.tgt;
        $('#manSrc').focus();
      });
      li.append(time, en, fix, zh);
      return li;
    }),
  );
}

$('#downloadBtn').addEventListener('click', () => {
  const text = entries
    .filter((e) => e.final)
    .map((e) => {
      const en = e.srcLang === 'en' ? e.src : e.tgt;
      const zh = e.srcLang === 'zh' ? e.src : e.tgt;
      return `[${e.t.toLocaleTimeString()}]\nEN: ${en}\n中文: ${zh}`;
    })
    .join('\n\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = 'wedding-transcript.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---- wiring ------------------------------------------------------------------

for (const b of document.querySelectorAll('#langSeg button')) {
  b.addEventListener('click', () => setSpeaker(b.dataset.lang));
}
$('#micBtn').addEventListener('click', toggleMic);
$('#openBtn').addEventListener('click', () => {
  window.open('display.html', 'wedding-display', 'popup,width=1280,height=720');
});

for (const key of Object.keys(cfg)) {
  const input = $('#' + key);
  input.value = cfg[key];
  input.addEventListener('input', () => {
    cfg[key] = key === 'size' || key === 'lines' ? Number(input.value) : input.value;
    store.set(key, input.value);
    if (key === 'size') $('#sizeOut').textContent = cfg.size;
    if (key === 'provider' && listener.running) warmUp();
    publish();
  });
}
$('#sizeOut').textContent = cfg.size;

document.addEventListener('keydown', (ev) => {
  if (ev.target.closest('input, textarea, select') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'e') setSpeaker('en');
  else if (k === 'c') setSpeaker('zh');
  else if (k === 'm') toggleMic();
});

if (!speechSupported) $('#unsupported').hidden = false;
renderLog();
publish();
