// boot. wires the socket to the modules and keeps the chrome honest.

import { S, on, emit } from './state.js';
import { connect, send } from './ws.js';
import * as deck from './deck.js';
import { setMode } from './modes.js';
import { WORDMARK } from './art.js';
import './input.js';
import './wheel.js';
import './prs.js';
import './spawn.js';
import './settings.js';
import './overlay.js';

const connChip = document.getElementById('conn-chip');
const padChip = document.getElementById('pad-chip');
const battChip = document.getElementById('battery-chip');
const hintsEl = document.getElementById('hints');
const toastsEl = document.getElementById('toasts');

// -- hello ----------------------------------------------------------------

on('ws:hello', (m) => {
  S.settings = m.settings;
  S.pad.available = m.pad.available;
  S.pad.tmux = m.tmux;
  if (m.pad.available) S.pad.source = 'ornnpad';
  for (const info of m.sessions) deck.addSession(info);
  deck.refresh();
  paintPad();
  if (m.away && !S.away) emit('ws:away', { on: true });
  renderHints();
});

on('conn', ({ up }) => {
  connChip.textContent = up ? 'live' : 'reconnecting.';
  connChip.classList.toggle('live', up);
  connChip.classList.toggle('warn', !up);
});

function paintPad() {
  const words = { ornnpad: 'pad · hid', gamepad: 'pad · browser', waiting: 'pad · asleep', none: 'no pad' };
  padChip.textContent = words[S.pad.source] || 'no pad';
  padChip.classList.toggle('live', S.pad.source === 'ornnpad' || S.pad.source === 'gamepad');
}

on('padchange', paintPad);

on('battery', () => {
  const b = S.pad.battery;
  if (!b) return;
  battChip.classList.remove('hidden');
  battChip.textContent = `${b.percent}%${b.charging ? ' +' : ''} batt`;
  battChip.classList.toggle('warn', b.percent <= 15 && !b.charging);
});

// -- toasts ---------------------------------------------------------------

on('ws:toast', ({ text, kind }) => toast(text, kind));

function toast(text, kind = '') {
  const d = document.createElement('div');
  d.className = 'toast ' + (kind || '');
  d.textContent = text;
  toastsEl.appendChild(d);
  setTimeout(() => d.remove(), 3400);
}

// -- hints ----------------------------------------------------------------

function chip(cls, glyph) {
  return `<span class="btn-chip chip-${cls}">${glyph}</span>`;
}

const H = {
  deck: [
    [chip('a', 'a'), 'type'], [chip('x', 'x'), 'wheel'], [chip('y', 'y'), 'expand'],
    [chip('stick', 'r✜'), 'flip cards'], [chip('stick', 'l✜'), 'scroll'],
    [chip('lr', 'lb'), 'reject'], [chip('lr', 'rb'), 'accept'], [chip('start', 'start'), 'new'],
  ],
  typing: [
    [chip('dpad', '✚'), 'arrows'], [chip('a', 'a'), 'enter'], [chip('b', 'b'), 'leave · hold interrupts'],
    [chip('lr', 'lb'), 'esc'], [chip('lr', 'rb'), 'enter'], [chip('stick', 'l3'), 'hold to talk'],
  ],
  wheel: [
    [chip('dpad', '✚'), 'roll · flip groups'], [chip('a', 'a'), 'send'], [chip('b', 'b'), 'close'],
  ],
  prs: [
    [chip('dpad', '✚'), 'pick'], [chip('lr', 'r2'), 'squeeze to merge'], [chip('a', 'a'), 'checkout'],
    [chip('y', 'y'), 'open'], [chip('lr', 'rb'), 'refresh'], [chip('b', 'b'), 'close'],
  ],
  spawn: [
    [chip('dpad', '✚'), 'pick'], [chip('x', 'x'), 'tabs'], [chip('a', 'a'), 'go'], [chip('b', 'b'), 'close'],
  ],
  settings: [
    [chip('dpad', '✚'), 'pick · tune'], [chip('a', 'a'), 'toggle'], [chip('b', 'b'), 'close'],
  ],
  help: [[chip('b', 'b'), 'close']],
  done: [[chip('a', 'a'), 'dismiss']],
  away: [[chip('b', 'b'), 'come back']],
};

function renderHints() {
  const rows = S.mode === 'deck' && S.typing ? H.typing : H[S.mode] || H.deck;
  hintsEl.innerHTML = rows.map(([c, label]) => `<span class="hint">${c} ${label}</span>`).join('');
}

on('mode', renderHints);
on('typing', renderHints);

// -- help content ---------------------------------------------------------

document.getElementById('help-art').textContent = WORDMARK;

const HELP = [
  ['the deck', [
    ['a', 'type into the agent'], ['b', 'back · hold to interrupt'],
    ['x', 'the command wheel'], ['y', 'expand output'],
    ['right stick', 'flip through cards'], ['left stick', 'scroll · l2 turbo'],
    ['stick up', 'zoom'], ['stick down', 'grid'],
  ]],
  ['judgment', [
    ['lb', 'reject the hunk'], ['rb', 'accept the hunk'],
    ['r2 squeeze', 'merge a pr'], ['hold b', 'interrupt the agent'],
    ['l3 + r3', 'interrupt everyone'],
  ]],
  ['buttons', [
    ['start', 'new agent'], ['select', 'settings'],
    ['share', 'away mode'], ['guide', 'this screen'],
    ['l3 hold', 'push to talk'], ['r3', 'recenter'],
    ['paddles', 'quick slash commands'],
  ]],
  ['keyboard', [
    ['arrows', 'move'], ['enter', 'type'], ['esc', 'back'],
    ['n', 'new'], [',', 'settings'], ['a', 'away'], ['?', 'help'],
    ['1 to 9', 'jump to card'], ['ctrl `', 'leave typing'],
  ]],
];

document.getElementById('help-cols').innerHTML = HELP.map(([title, rows]) => `
  <div class="help-group"><h3>${title}</h3>
    ${rows.map(([k, v]) => `<div class="help-row"><span class="k"><span class="btn-chip">${k}</span></span>${v}</div>`).join('')}
  </div>`).join('');

// -- chrome clicks --------------------------------------------------------

document.querySelectorAll('#modetabs button').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.goto));
});

// barrel roll, obviously
on('deck:spin', () => {
  document.getElementById('deck').animate(
    [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(360deg)' }],
    { duration: 900, easing: 'cubic-bezier(.34,1.2,.64,1)' });
});

// presence: any press tells the server a human is here
let lastAck = 0;
on('anykey', () => {
  const now = Date.now();
  if (now - lastAck > 2000) { lastAck = now; send({ t: 'ack' }); }
});
document.addEventListener('pointerdown', () => emit('anykey'));

connect();
renderHints();
