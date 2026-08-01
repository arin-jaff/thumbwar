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
import './help.js';
import './viz.js';
import './tour.js';

const connChip = document.getElementById('conn-chip');
const padChip = document.getElementById('pad-chip');
const battChip = document.getElementById('battery-chip');
const hintsEl = document.getElementById('hints');
const toastsEl = document.getElementById('toasts');

// -- hello ----------------------------------------------------------------

function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme || 'mint';
}

on('ws:settings', ({ settings }) => { S.settings = settings; applyTheme(); });

on('ws:hello', (m) => {
  S.settings = m.settings;
  applyTheme();
  S.pad.available = m.pad.available;
  S.pad.tmux = m.tmux;
  S.pad.error = m.pad.error || '';
  if (m.bt) S.pad.bt = { connected: m.bt.connected || [], paired: m.bt.paired || [] };
  if (m.pad.available) S.pad.source = 'ornnpad';
  // hello also arrives on every reconnect, so reconcile rather than append
  const live = new Set(m.sessions.map((s) => s.id));
  for (const id of [...S.sessions.keys()]) if (!live.has(id)) deck.removeSession(id);
  for (const info of m.sessions) {
    const known = S.sessions.get(info.id);
    if (known) {
      Object.assign(known, { state: info.state, finished: info.finished,
                             branch: info.branch, dirty: info.dirty });
      known.workT0 = info.state === 'working'
        ? performance.now() - (info.working_for || 0) * 1000 : 0;
      known.term.resync();
      deck.paintGit(known);
    } else deck.addSession(info);
  }
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
  let text = words[S.pad.source] || 'no pad';
  let title = 'press guide or ? for the controller map';
  if (S.pad.source === 'none' || S.pad.source === 'waiting') {
    // the bluetooth scan knows about pads the browser cannot see yet
    const bt = S.pad.bt || {};
    const short = (n) => n.split('(')[0].trim().toLowerCase();
    if (bt.connected && bt.connected.length) {
      text = 'pad · asleep';
      title = `press any button on ${short(bt.connected[0])} to wake it`;
    } else if (bt.paired && bt.paired.length) {
      text = 'pad · off';
      title = `${short(bt.paired[0])} is paired but off. turn it on, then press a button`;
    } else if (S.pad.error) {
      title = S.pad.error + ' · click to rescan bluetooth';
    } else {
      title = 'click to rescan bluetooth';
    }
  }
  padChip.textContent = text;
  padChip.classList.toggle('live', S.pad.source === 'ornnpad' || S.pad.source === 'gamepad');
  padChip.title = title;
}

on('padchange', paintPad);
on('ws:bt', (m) => {
  S.pad.bt = { connected: m.connected || [], paired: m.paired || [] };
  paintPad();
});
padChip.addEventListener('click', () => {
  if (S.pad.source === 'none' || S.pad.source === 'waiting') {
    send({ t: 'bt_scan' });
    toast('scanning bluetooth for pads.', 'info');
  }
});
on('padfound', ({ id }) => toast(`pad connected: ${id.split('(')[0].trim().toLowerCase()}`, 'mint'));

// broadcast mode: one keystroke, every agent
const castChip = document.getElementById('cast-chip');
on('broadcast', () => {
  castChip.classList.toggle('hidden', !S.broadcast);
  toast(S.broadcast ? 'broadcast on: you are typing into every agent' : 'broadcast off', 'info');
});
castChip.addEventListener('click', () => { S.broadcast = false; emit('broadcast'); });

on('battery', () => {
  const b = S.pad.battery;
  if (!b) return;
  battChip.classList.remove('hidden');
  battChip.textContent = `${b.percent}%${b.charging ? ' +' : ''} batt`;
  battChip.classList.toggle('warn', b.percent <= 15 && !b.charging);
});

// -- toasts ---------------------------------------------------------------

on('ws:toast', ({ text, kind }) => toast(text, kind));

on('ws:needs_you', ({ name }) => {
  if (!S.away) toast(`${name} needs you · r3 or tab jumps there`, 'info');
});

on('deck:gone', ({ name }) => toast(`${name} ended`));

// -- background presence: the tab tells you what is happening --------------

const favicon = document.getElementById('favicon');
const ICON = (glyph, color) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ctext x='32' y='46' font-size='44' text-anchor='middle' fill='%23${color}'%3E${glyph}%3C/text%3E%3C/svg%3E`;
const ICONS = {
  plain: ICON('%E2%9C%BB', 'f0824f'),      // ✻ orange
  needs: ICON('%E2%9D%AF', 'e8a33d'),      // ❯ marigold
  done: ICON('%E2%9C%BB', '14a575'),       // ✻ mint
};

setInterval(() => {
  let cooking = 0, needs = 0, finished = 0;
  for (const s of S.sessions.values()) {
    if (s.state === 'working') cooking += 1;
    else if (s.state === 'needs_you') needs += 1;
    else if (s.finished) finished += 1;
  }
  document.title = needs ? `❯ ${needs} need${needs > 1 ? '' : 's'} you · thumbwar`
    : cooking ? `✻ ${cooking} cooking · thumbwar`
    : finished ? `✻ done · thumbwar` : 'thumbwar';
  const want = needs ? ICONS.needs : finished && !cooking ? ICONS.done : ICONS.plain;
  if (favicon.href !== want) favicon.href = want;
}, 1000);

const warned = new Set();
function warnOnce(key, text) {
  if (!text || warned.has(key)) return;
  warned.add(key);
  toast(text, 'error');
}

on('ws:ptt', ({ ok, down, error }) => {
  if (!ok && down === false) warnOnce('ptt', error);
});

on('ws:overlay_done', ({ code }) => {
  if (code === 3) warnOnce('overlay', 'the overlay needs pyobjc. sent a notification instead.');
});

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
    [chip('stick', 'r✜'), 'point'], [chip('dpad', '✚'), 'roll'], [chip('lr', 'lb rb'), 'groups'],
    [chip('a', 'a'), 'send'], [chip('b', 'b'), 'close'],
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

// -- help content (the live map itself lives in help.js) -------------------

document.getElementById('help-art').textContent = WORDMARK;

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
