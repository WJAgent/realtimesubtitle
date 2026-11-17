import { bus } from './bus.js';
import { IDLE } from './config.js';

const stage = document.getElementById('stage');

function line(lang, text, isSource) {
  const p = document.createElement('p');
  p.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  p.className = `line ${lang}`;
  if (isSource) p.classList.add('src');
  if (text) {
    p.textContent = text;
  } else {
    p.textContent = '…';
    p.classList.add('pending');
  }
  return p;
}

function render(state) {
  document.documentElement.style.setProperty('--size', state.size ?? 5);
  document.body.dataset.pos = state.pos || 'middle';
  stage.replaceChildren();

  if (!state.entries?.length) {
    const idle = document.createElement('article');
    idle.className = 'entry idle';
    idle.append(line('en', IDLE.en), line('zh', IDLE.zh));
    stage.append(idle);
    return;
  }

  for (const e of state.entries) {
    const article = document.createElement('article');
    article.className = 'entry' + (e.final ? '' : ' draft');
    article.append(line('en', e.en, e.srcLang === 'en'), line('zh', e.zh, e.srcLang === 'zh'));
    stage.append(article);
  }
}

bus.onmessage = (ev) => {
  if (ev.data?.type === 'state') render(ev.data);
};

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}
document.addEventListener('dblclick', toggleFullscreen);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'f' || ev.key === 'F') toggleFullscreen();
});

render({ entries: [] });
bus.postMessage({ type: 'hello' }); // ask the operator console for the current screen
