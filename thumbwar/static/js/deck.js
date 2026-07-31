// the deck: a springy carousel of agent bubbles.

import { S, on, emit, activeSession } from './state.js';
import { TermView } from './term.js';
import { rumble } from './rumble.js';
import { send } from './ws.js';
import { spinnerFrame, verbFor, GLYPH } from './art.js';

const deckEl = document.getElementById('deck');
const dotsEl = document.getElementById('dots');
const emptyEl = document.getElementById('empty-deck');
const stageEl = document.getElementById('stage');

let floatPos = 0;         // animated card index
let lastTickAt = 0;       // integer crossing for detent rumble

export function addSession(info) {
  if (S.sessions.has(info.id)) return;
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = info.id;
  el.innerHTML = `
    <div class="card-top">
      <span class="jewel">·</span>
      <span class="card-name"></span>
      <span class="card-cwd"></span>
      <button class="card-x" title="end this agent">✕</button>
    </div>
    <div class="term-host"></div>
    <div class="card-foot">
      <span class="card-state">ready</span>
      <span class="typing-tag hidden">${GLYPH.prompt} typing</span>
    </div>`;
  el.querySelector('.card-name').textContent = info.name;
  el.querySelector('.card-cwd').textContent = info.cwd.replace(/^\/Users\/[^/]+/, '~');
  el.querySelector('.card-x').addEventListener('click', () => send({ t: 'kill', id: info.id }));
  el.addEventListener('mousedown', () => {
    const i = S.order.indexOf(info.id);
    if (i >= 0 && i !== S.active) { S.active = i; emit('deck:nav'); }
  });
  deckEl.appendChild(el);

  const sess = { ...info, el, term: null };
  S.sessions.set(info.id, sess);
  S.order.push(info.id);
  S.active = S.order.length - 1;
  sess.term = new TermView(info.id, el.querySelector('.term-host'));
  refresh();
  requestAnimationFrame(() => sess.term.refit());
}

export function removeSession(id) {
  const sess = S.sessions.get(id);
  if (!sess) return;
  sess.term.dispose();
  sess.el.remove();
  S.sessions.delete(id);
  const i = S.order.indexOf(id);
  S.order.splice(i, 1);
  if (S.active >= S.order.length) S.active = Math.max(0, S.order.length - 1);
  refresh();
}

export function nav(delta) {
  if (!S.order.length) return;
  const next = Math.min(S.order.length - 1, Math.max(0, S.active + delta));
  if (next === S.active) { rumble('tick'); return; }
  S.active = next;
  emit('deck:nav');
  refresh();
}

export function jump(index) {
  if (index >= 0 && index < S.order.length && index !== S.active) {
    S.active = index;
    emit('deck:nav');
    refresh();
  }
}

export function setZoom(v) { S.zoom = v; if (v) S.grid = false; layout(); }
export function setGrid(v) { S.grid = v; if (v) S.zoom = false; stageEl.classList.toggle('grid', v); layout(); }

export function refresh() {
  emptyEl.classList.toggle('hidden', S.order.length > 0);
  dotsEl.innerHTML = '';
  S.order.forEach((id, i) => {
    const s = S.sessions.get(id);
    const d = document.createElement('span');
    d.className = 'dot ' + s.state + (i === S.active ? ' on' : '');
    dotsEl.appendChild(d);
  });
  layout();
}

// -- transforms -----------------------------------------------------------

function layout() {
  const n = S.order.length;
  S.order.forEach((id, i) => {
    const s = S.sessions.get(id);
    const off = i - floatPos;
    const el = s.el;
    el.classList.toggle('is-active', i === S.active);
    if (S.grid) {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const c = i % cols, r = Math.floor(i / cols);
      const sc = Math.min(0.94 / cols, 0.9 / rows);
      const x = (c - (cols - 1) / 2) * (100 / cols);
      const y = (r - (rows - 1) / 2) * (86 / rows);
      el.style.transform = `translate(${x}vw, ${y}vh) scale(${sc})`;
      el.style.zIndex = i === S.active ? 40 : 20;
      el.style.opacity = 1;
    } else if (S.zoom && i === S.active) {
      el.style.transform = 'translateZ(120px) scale(1.13)';
      el.style.zIndex = 50;
      el.style.opacity = 1;
    } else {
      const x = off * 56;                       // percent of card width
      const z = -Math.abs(off) * 220;
      const ry = -off * 12;
      el.style.transform = `translateX(${x}%) translateZ(${z}px) rotateY(${ry}deg) scale(${1 - Math.min(0.22, Math.abs(off) * 0.09)})`;
      el.style.zIndex = String(30 - Math.round(Math.abs(off) * 4));
      el.style.opacity = String(Math.abs(off) > 2.6 ? 0 : 1 - Math.abs(off) * 0.22);
    }
  });
}

// spring the deck toward the active card, detent rumble on crossings
function tickAnim() {
  const target = S.active;
  const diff = target - floatPos;
  if (Math.abs(diff) > 0.002) {
    floatPos += diff * 0.16;
    if (Math.abs(target - floatPos) < 0.004) floatPos = target;
    const crossed = Math.round(floatPos);
    if (crossed !== lastTickAt) { lastTickAt = crossed; rumble('tick'); }
    layout();
  }
  requestAnimationFrame(tickAnim);
}

// jewels and status words breathe on their own clock
setInterval(() => {
  const now = performance.now();
  for (const s of S.sessions.values()) {
    const jewel = s.el.querySelector('.jewel');
    const stateEl = s.el.querySelector('.card-state');
    s.el.classList.toggle('working', s.state === 'working');
    s.el.classList.toggle('needs_you', s.state === 'needs_you');
    s.el.classList.toggle('finished', !!s.finished && s.state !== 'working');
    if (s.state === 'working') {
      jewel.textContent = spinnerFrame(now);
      stateEl.textContent = verbFor(s.id) + '.';
    } else if (s.state === 'needs_you') {
      jewel.textContent = GLYPH.caret;
      stateEl.textContent = 'needs you';
    } else if (s.finished) {
      jewel.textContent = GLYPH.spark;
      stateEl.textContent = 'done!';
    } else {
      jewel.textContent = '·';
      stateEl.textContent = 'ready';
    }
    stateEl.className = 'card-state ' + s.state;
  }
}, 120);

// -- wiring ---------------------------------------------------------------

on('ws:session', ({ session }) => { addSession(session); rumble('thock'); });
on('ws:exit', ({ id }) => removeSession(id));
on('ws:out', (m) => {
  const s = S.sessions.get(m.id);
  if (s && s.term) s.term.write(m.data);
});
on('ws:status', (m) => {
  const s = S.sessions.get(m.id);
  if (!s) return;
  const was = s.state;
  s.state = m.state;
  s.finished = m.finished;
  if (was === 'working' && m.state === 'needs_you') rumble('detent');
  refresh();
});
on('deck:nav', () => refresh());

window.addEventListener('resize', () => {
  for (const s of S.sessions.values()) s.term.refit();
});

export function refitActive() {
  const s = activeSession();
  if (s) s.term.refit();
}

requestAnimationFrame(tickAnim);
