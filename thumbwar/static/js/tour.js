// the guided tour, wispr flow style: each step asks you to actually do
// the thing and advances itself when you have. next skips a step, and
// the whole thing lives one click away in settings forever.

import { S, on } from './state.js';
import { rumble } from './rumble.js';
import { confetti } from './confetti.js';
import { setMode } from './modes.js';

const el = document.getElementById('tour');
const ctx = {};

const STEPS = [
  { title: 'welcome to thumbwar',
    body: 'a cockpit for running claude code agents in parallel, controller first, keyboard always. this tour walks the whole loop — do each step for real and it advances by itself.' },
  { title: 'learn your controller',
    body: 'press ? (or the guide button) and mash your pad: every control lights up on the map. close it with b or esc to move on.',
    chips: ['?', 'guide'], when: () => ctx.help && S.mode !== 'help' },
  { title: 'spawn your first agent',
    body: 'press n (or start) and pick a repo — a claude wakes up in a real terminal on a card.',
    chips: ['n', 'start'], when: () => S.order.length >= 1 },
  { title: 'talk to it',
    body: 'press a (or enter) to start typing into the agent. a sends enter, b backs out. say hi.',
    chips: ['a'], when: () => ctx.typing },
  { title: 'push to talk',
    body: 'hold l3 — click the left stick in — speak, and let go. wispr flow types what you said. no pad or no wispr? skip this step.',
    chips: ['l3'], when: () => ctx.ptt },
  { title: 'the command wheel',
    body: 'press x (or w). point the right stick at a slice like a weapon wheel, roll the rim with the dpad, lb rb flip groups, a fires. try /context, then close with b.',
    chips: ['x'], when: () => ctx.wheel && S.mode !== 'wheel' },
  { title: 'go parallel',
    body: 'spawn a second agent (n again), then flick the left stick sideways — or [ and ] — to hop between cards. 1 to 9 jumps straight to a card.',
    chips: ['n', '[ ]'], when: () => S.order.length >= 2 },
  { title: 'the grid',
    body: 'press g (or right stick down) to see the whole fleet at once, numbered to match the jump keys.',
    chips: ['g'], when: () => ctx.grid },
  { title: 'reading the room',
    body: 'every card reads its agent: a spinner and cooking timer while it works, mint breathing when it needs you, the git branch (orange when dirty) and a sparkline of output. r3 or tab jumps to whoever needs you.',
    chips: ['tab'] },
  { title: 'away mode',
    body: 'press a (share on the pad) to slip away on purpose. when your agents finish — or stop to ask permission — a floating card finds you anywhere in macos and counts you back in. b comes back.',
    chips: ['a', 'share'], when: () => ctx.away },
  { title: 'the pr bay',
    body: 'when a branch is ready, the prs tab lists open pull requests. hold r2 and a ring fills until the merge lands; letting go backs out. nobody merges by accident.',
    chips: ['r2'], glow: '#modetabs button[data-goto="prs"]' },
  { title: 'make it yours',
    body: 'press , (or select) for settings: themes — midnight is the night shift one — sounds, rumble, paddle quick slots, and the little input visualizer in the corner.',
    chips: [','], when: () => ctx.settings },
  { title: 'airborne',
    body: 'that is the whole loop: spawn, cook, judge, merge, repeat. press ? whenever you forget a button, and take this tour again from settings any time.',
    last: true },
];

let idx = -1;
let active = false;
let poll = null;
let advancing = false;

on('mode', ({ mode }) => {
  if (mode === 'help') ctx.help = true;
  if (mode === 'wheel') ctx.wheel = true;
  if (mode === 'settings') ctx.settings = true;
});
on('typing', ({ on: t }) => { if (t) ctx.typing = true; });
on('ws:ptt', (m) => { if (m.down && m.ok) ctx.ptt = true; });
on('ws:away', (m) => { if (m.on) ctx.away = true; });

export function start() {
  for (const k of Object.keys(ctx)) delete ctx[k];
  idx = -1;
  active = true;
  advancing = false;
  setMode('deck');
  el.classList.remove('hidden');
  clearInterval(poll);
  poll = setInterval(check, 350);
  next();
}

function check() {
  if (S.grid) ctx.grid = true;
  const step = STEPS[idx];
  if (active && step && step.when && step.when()) advance();
}

function advance() {
  if (advancing) return;
  advancing = true;
  el.classList.add('did');
  rumble('confirm');
  setTimeout(() => {
    el.classList.remove('did');
    advancing = false;
    next();
  }, 450);
}

function next() {
  idx += 1;
  if (idx >= STEPS.length) return finish(true);
  render();
}

function finish(fanfare) {
  active = false;
  clearInterval(poll);
  poll = null;
  el.classList.add('hidden');
  unglow();
  try { localStorage.setItem('tw-tour', 'done'); } catch { /* private mode */ }
  if (fanfare) { confetti(); rumble('done'); }
}

function unglow() {
  document.querySelectorAll('.tour-glow').forEach((n) => n.classList.remove('tour-glow'));
}

function render() {
  unglow();
  const s = STEPS[idx];
  if (s.glow) {
    const t = document.querySelector(s.glow);
    if (t) t.classList.add('tour-glow');
  }
  el.innerHTML = `
    <div class="tour-card">
      <div class="tour-top"><span class="spark">✻</span>
        <span class="tour-count">${idx + 1} / ${STEPS.length}</span>
        <button class="tour-skip">skip the tour</button>
      </div>
      <h2></h2>
      <p></p>
      <div class="tour-foot">
        <span class="tour-chips">${(s.chips || []).map((c) => `<span class="btn-chip">${c}</span>`).join('')}</span>
        <button class="bubble-btn tour-next">${s.last ? 'finish' : s.when ? 'skip step' : 'next'}</button>
      </div>
    </div>`;
  el.querySelector('h2').textContent = s.title;
  el.querySelector('p').textContent = s.body;
  el.querySelector('.tour-next').addEventListener('click', () => (s.last ? finish(true) : next()));
  el.querySelector('.tour-skip').addEventListener('click', () => finish(false));
}

on('tour:start', start);

// first run: offer the whole loop once, hands on
on('ws:hello', () => {
  let done = null;
  try { done = localStorage.getItem('tw-tour'); } catch { done = 'done'; }
  if (!done && !active) setTimeout(() => { if (!active) start(); }, 900);
});

const emptyBtn = document.getElementById('empty-tour');
if (emptyBtn) emptyBtn.addEventListener('click', () => start());
