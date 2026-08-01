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
      <span class="card-git hidden"></span>
      <canvas class="card-spark" width="96" height="16"></canvas>
      <span class="typing-tag hidden">${GLYPH.prompt} typing</span>
    </div>`;
  el.querySelector('.card-name').textContent = info.name;
  el.querySelector('.card-cwd').textContent = info.cwd.replace(/^\/Users\/[^/]+/, '~');
  el.querySelector('.card-x').addEventListener('click', () => send({ t: 'kill', id: info.id }));
  el.addEventListener('mousedown', (e) => {
    const i = S.order.indexOf(info.id);
    if (i >= 0 && i !== S.active) { S.active = i; emit('deck:nav'); }
    // clicking into the terminal focuses xterm, so make the ui agree
    if (e.target.closest('.term-host')) emit('typing:enter');
  });
  deckEl.appendChild(el);

  const sess = { ...info, el, term: null, hist: new Array(48).fill(0), bytesAcc: 0 };
  if (info.state === 'working') {
    sess.workT0 = performance.now() - (info.working_for || 0) * 1000;
  }
  S.sessions.set(info.id, sess);
  paintGit(sess);
  S.order.push(info.id);
  // a new card takes the thumb unless you are mid sentence in another one
  if (!S.typing) S.active = S.order.length - 1;
  sess.term = new TermView(info.id, el.querySelector('.term-host'));
  refresh();
  requestAnimationFrame(() => sess.term.refit());
}

export function removeSession(id) {
  const sess = S.sessions.get(id);
  if (!sess) return;
  emit('deck:gone', { name: sess.name });
  const i = S.order.indexOf(id);
  const wasActive = i === S.active;
  sess.term.dispose();
  sess.el.remove();
  S.sessions.delete(id);
  S.order.splice(i, 1);
  // keep the same card under the thumb when one before it exits
  if (i < S.active) S.active -= 1;
  if (S.active >= S.order.length) S.active = Math.max(0, S.order.length - 1);
  // never let keystrokes land in whichever agent slid into the empty slot
  if (wasActive && S.typing) emit('typing:exit');
  floatPos = S.active;
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

// take the thumb to the next agent waiting on a decision, if any
export function jumpNeedsYou() {
  const n = S.order.length;
  for (let step = 1; step <= n; step++) {
    const i = (S.active + step) % n;
    if (S.sessions.get(S.order[i]).state === 'needs_you') { jump(i); return true; }
  }
  return false;
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
    // grid badges share the 1-9 jump keys
    if (i < 9) s.el.dataset.n = i + 1; else delete s.el.dataset.n;
  });
  layout();
}

// -- transforms -----------------------------------------------------------

const GAP = 22;

// tile every card into the stage, centering whatever is left on the last row
function gridPlan(n) {
  if (!n) return null;
  const first = S.sessions.get(S.order[0]).el;
  // offset sizes, not client rects: the cards already carry a scale transform
  const cardW = first.offsetWidth, cardH = first.offsetHeight;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = (stageEl.clientWidth - GAP * (cols + 1)) / cols;
  const cellH = (stageEl.clientHeight - GAP * (rows + 1)) / rows;
  const scale = Math.min(cellW / cardW, cellH / cardH, 1);
  const card = { width: cardW, height: cardH };
  return (i) => {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, n - r * cols);
    const c = i - r * cols;
    return {
      x: (c - (inRow - 1) / 2) * (card.width * scale + GAP),
      y: (r - (rows - 1) / 2) * (card.height * scale + GAP),
      scale,
    };
  };
}

function layout() {
  const n = S.order.length;
  const g = S.grid ? gridPlan(n) : null;
  S.order.forEach((id, i) => {
    const s = S.sessions.get(id);
    const off = i - floatPos;
    const el = s.el;
    el.classList.toggle('is-active', i === S.active);
    if (g) {
      const { x, y, scale } = g(i);
      el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
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

// how long this agent has been cooking, claude style
function cookedFor(s, now) {
  if (!s.workT0) return '';
  const t = Math.max(0, (now - s.workT0) / 1000);
  return t < 60 ? ` (${Math.floor(t)}s)` : ` (${Math.floor(t / 60)}m ${String(Math.floor(t % 60)).padStart(2, '0')}s)`;
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
      stateEl.textContent = verbFor(s.id) + '.' + cookedFor(s, now);
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
  if (!s || !s.term) return;
  s.term.write(m.data);
  s.bytesAcc += m.data.length * 0.75;      // base64 to bytes, near enough
});
on('ws:status', (m) => {
  const s = S.sessions.get(m.id);
  if (!s) return;
  const was = s.state;
  s.state = m.state;
  s.finished = m.finished;
  if (was !== 'working' && m.state === 'working') s.workT0 = performance.now();
  if (m.state !== 'working') s.workT0 = 0;
  if (was === 'working' && m.state === 'needs_you') rumble('needs_you');
  refresh();
});

// -- git chip and the output sparkline -------------------------------------

export function paintGit(s) {
  const el = s.el.querySelector('.card-git');
  el.classList.toggle('hidden', !s.branch);
  if (!s.branch) return;
  el.textContent = s.branch + (s.dirty ? ` ±${s.dirty}` : '');
  el.classList.toggle('dirty', s.dirty > 0);
}

on('ws:git', (m) => {
  const s = S.sessions.get(m.id);
  if (!s) return;
  s.branch = m.branch;
  s.dirty = m.dirty;
  paintGit(s);
});

function drawSpark(s) {
  const c = s.el.querySelector('.card-spark');
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 96, 16);
  const max = Math.max(1, ...s.hist);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mint').trim() || '#3fd99f';
  s.hist.forEach((v, i) => {
    if (!v) return;
    const h = Math.max(1.5, Math.sqrt(v / max) * 15);
    ctx.fillRect(i * 2, 16 - h, 1.5, h);
  });
}

setInterval(() => {
  for (const s of S.sessions.values()) {
    s.hist.push(s.bytesAcc);
    s.hist.shift();
    s.bytesAcc = 0;
    drawSpark(s);
  }
}, 1000);
on('deck:nav', () => refresh());

window.addEventListener('resize', () => {
  for (const s of S.sessions.values()) s.term.refit();
});

export function refitActive() {
  const s = activeSession();
  if (s) s.term.refit();
}

requestAnimationFrame(tickAnim);
