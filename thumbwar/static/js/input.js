// every thumb, one river. ornnpad events, browser gamepads and the
// keyboard all become the same actions here, routed by mode.

import { S, on, emit, activeSession } from './state.js';
import { send, sendStdin } from './ws.js';
import { rumble } from './rumble.js';
import * as deck from './deck.js';
import * as wheel from './wheel.js';
import * as prs from './prs.js';
import * as spawn from './spawn.js';
import * as settingsUI from './settings.js';
import * as tour from './tour.js';
import { setMode } from './modes.js';

export const axes = { lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0 };

const ARROWS = { dpad_up: '\x1b[A', dpad_down: '\x1b[B', dpad_right: '\x1b[C', dpad_left: '\x1b[D' };

// -- typing mode ----------------------------------------------------------

export function setTyping(v) {
  const s = activeSession();
  S.typing = v && !!s;
  if (s) {
    if (S.typing) s.term.focus(); else s.term.blur();
    const tag = s.el.querySelector('.typing-tag');
    if (tag) tag.classList.toggle('hidden', !S.typing);
  }
  emit('typing', { on: S.typing });
}

on('typing:exit', () => setTyping(false));
on('typing:enter', () => setTyping(true));

function write(text) {
  const s = activeSession();
  if (s) sendStdin(s.id, text);
}

function slashCommand(cmd) {
  const s = activeSession();
  if (!s) return;
  sendStdin(s.id, cmd);
  setTimeout(() => sendStdin(s.id, '\r'), 160);
  rumble('confirm');
}

export { slashCommand };

// -- button router --------------------------------------------------------

let eastDownAt = 0;
let eastFired = false;
let l3Held = false;

function onDown(name) {
  emit('anykey');
  emit('btn', { name, down: true });

  // overlays swallow everything. help stays up while you mash, so the
  // map can light up under your thumbs; b, a or guide put it away.
  if (S.mode === 'help') {
    if (['east', 'south', 'guide', 'start', 'select'].includes(name)) setMode('deck');
    return;
  }
  if (S.mode === 'done') {
    if (['south', 'east', 'l1', 'r1'].includes(name)) emit('done:ack');
    return;
  }
  if (S.mode === 'away') {
    if (name === 'east' || name === 'south') { send({ t: 'away', on: false }); }
    return;
  }

  // a live tour may claim this press (a on info steps, y to skip)
  if (tour.intercept(name)) return;

  // global buttons
  switch (name) {
    case 'start': setMode('spawn'); return;
    case 'select': setMode('settings'); return;
    case 'share': send({ t: 'away', on: !S.away }); return;
    case 'guide': setMode('help'); return;
    case 'l3':
      l3Held = true;
      setTyping(true);
      send({ t: 'ptt', down: true });
      rumble('tick');
      return;
    case 'r3': {
      if (l3Held) { send({ t: 'interrupt_all' }); return; }
      // r3 takes you to whatever matters: the next agent waiting on a
      // decision if there is one, otherwise just recenter the view.
      if (deck.jumpNeedsYou()) {
        if (S.mode !== 'deck') setMode('deck');
        rumble('thock');
        return;
      }
      deck.setZoom(false); deck.setGrid(false);
      const s = activeSession();
      if (s) s.term.toBottom();
      rumble('thock');
      return;
    }
    case 'l4': case 'r4': case 'pl': case 'pr': {
      const slot = (S.settings.quick_slots || {})[name];
      if (slot && S.mode === 'deck') slashCommand(slot);
      return;
    }
  }

  if (S.mode === 'wheel') return wheelKeys(name);
  // b closes any panel, which is what every panel note promises
  if (name === 'east' && S.mode !== 'deck') { setMode('deck'); return; }
  if (S.mode === 'prs') return prs.keys(name);
  if (S.mode === 'spawn') return spawn.keys(name);
  if (S.mode === 'settings') return settingsUI.keys(name);
  return deckKeys(name);
}

function onUp(name) {
  emit('btn', { name, down: false });
  if (name === 'l3') {
    l3Held = false;
    send({ t: 'ptt', down: false });
    return;
  }
  if (name === 'east') {
    const held = performance.now() - eastDownAt;
    if (!eastFired && held < 380) eastTap();
    eastFired = false;
  }
}

function eastTap() {
  if (S.mode !== 'deck') { setMode('deck'); return; }
  if (S.zoom) { deck.setZoom(false); rumble('tick'); return; }
  if (S.grid) { deck.setGrid(false); rumble('tick'); return; }
  if (S.typing) { setTyping(false); rumble('tick'); return; }
}

function deckKeys(name) {
  switch (name) {
    case 'south':
      if (S.grid) { deck.setGrid(false); deck.refitActive(); }
      if (S.typing) write('\r');
      else { setTyping(true); rumble('tick'); }
      break;
    case 'east':
      eastDownAt = performance.now();
      eastFired = false;
      setTimeout(() => {
        if (!eastFired && performance.now() - eastDownAt >= 380 && S.mode === 'deck') {
          eastFired = true;
          write('\x1b');
          rumble('interrupt');
        }
      }, 390);
      break;
    case 'west': setMode('wheel'); break;
    case 'north': write('\x0f'); rumble('tick'); break;   // ctrl+o, expand
    case 'l1': write('\x1b'); rumble('reject'); break;    // reject the hunk
    case 'r1': write('\r'); rumble('accept'); break;      // accept the hunk
    case 'rstick_left': deck.nav(-1); break;
    case 'rstick_right': deck.nav(1); break;
    case 'rstick_up': deck.setZoom(true); rumble('thock'); break;
    case 'rstick_down': deck.setGrid(!S.grid); rumble('thock'); break;
    case 'dpad_up': case 'dpad_down': case 'dpad_left': case 'dpad_right':
      if (S.typing) write(ARROWS[name]);
      else if (name === 'dpad_left') deck.nav(-1);
      else if (name === 'dpad_right') deck.nav(1);
      else { setMode('wheel'); wheel.roll(name === 'dpad_down' ? 1 : -1); }
      break;
  }
}

function wheelKeys(name) {
  switch (name) {
    case 'dpad_up': wheel.roll(-1); break;
    case 'dpad_down': wheel.roll(1); break;
    case 'dpad_left': case 'l1': wheel.group(-1); break;
    case 'dpad_right': case 'r1': wheel.group(1); break;
    case 'south': wheel.fire(); break;
    case 'east': case 'west': setMode('deck'); break;
  }
}

// a pad going away mid press must not leave a repeat running forever
export function releaseAll() {
  for (const key of [...repeaters.keys()]) stopRepeat(key.replace(/:delay$/, ''));
  gpState.buttons.fill(false);
  gpState.dig = {};
  for (const key of Object.keys(lDig)) delete lDig[key];
}

// -- left stick: video game menus ------------------------------------------
// in any panel the left stick is the dpad (auto repeat included), so every
// menu drives like a game menu. in the deck a horizontal flick flips cards.

const PANELS = ['wheel', 'prs', 'spawn', 'settings'];
const lDig = {};   // direction name -> 'panel' | 'deck'

// a mode change orphans held repeats: the interval routes by the CURRENT
// mode, so a held roll would re-open the wheel right after a fired it.
// drop every repeater and stick classification; a still-held stick gets
// re-classified next frame under the new mode's rules.
on('mode', () => {
  for (const key of [...repeaters.keys()]) stopRepeat(key.replace(/:delay$/, ''));
  for (const key of Object.keys(lDig)) delete lDig[key];
});

function lstickMenus() {
  const dirs = [
    ['dpad_right', axes.lx, Math.abs(axes.ly)],
    ['dpad_left', -axes.lx, Math.abs(axes.ly)],
    ['dpad_up', axes.ly, Math.abs(axes.lx)],
    ['dpad_down', -axes.ly, Math.abs(axes.lx)],
  ];
  const inPanel = PANELS.includes(S.mode);
  for (const [name, v, other] of dirs) {
    const held = lDig[name];
    if (!held && v > 0.6 && v > other * 1.4) {
      if (inPanel) { lDig[name] = 'panel'; pressWithRepeat(name); }
      else if (S.mode === 'deck' && !S.typing
               && (name === 'dpad_left' || name === 'dpad_right')) {
        lDig[name] = 'deck';
        deck.nav(name === 'dpad_left' ? -1 : 1);
      }
    } else if (held && v < 0.35) {
      delete lDig[name];
      if (held === 'panel') release(name);
    }
  }
}

// -- dpad auto repeat -----------------------------------------------------

const repeaters = new Map();

function pressWithRepeat(name) {
  onDown(name);
  if (!name.startsWith('dpad')) return;
  stopRepeat(name);
  const t = setTimeout(() => {
    repeaters.set(name, setInterval(() => onDown(name), 120));
  }, 340);
  repeaters.set(name + ':delay', t);
}

function stopRepeat(name) {
  clearTimeout(repeaters.get(name + ':delay'));
  clearInterval(repeaters.get(name));
  repeaters.delete(name); repeaters.delete(name + ':delay');
}

function release(name) {
  stopRepeat(name);
  onUp(name);
}

// -- ornnpad over the wire ------------------------------------------------

on('ws:pad', ({ ev }) => {
  if (ev.type === 'down') pressWithRepeat(ev.name);
  else if (ev.type === 'up') release(ev.name);
  else if (ev.type === 'axis') {
    if (ev.name === 'left_stick') { axes.lx = ev.data.x; axes.ly = ev.data.y; }
    else if (ev.name === 'right_stick') { axes.rx = ev.data.x; axes.ry = ev.data.y; }
    else if (ev.name === 'left_trigger') axes.l2 = ev.value;
    else if (ev.name === 'right_trigger') axes.r2 = ev.value;
  } else if (ev.type === 'gesture') {
    if (ev.name === 'right_stick.full_circle_cw') { emit('deck:spin'); rumble('done'); }
  } else if (ev.type === 'battery') {
    S.pad.battery = ev.data;
    emit('battery');
  } else if (ev.type === 'connected') {
    S.pad.source = 'ornnpad';
    emit('padchange');
    rumble('connect');
  } else if (ev.type === 'disconnected') {
    S.pad.source = S.pad.available ? 'waiting' : 'none';
    releaseAll();
    emit('padchange');
  }
});

// -- browser gamepad fallback --------------------------------------------

// instant feedback the moment a pad wakes up, bluetooth included
window.addEventListener('gamepadconnected', (e) => {
  if (!S.pad.available && S.pad.source !== 'gamepad') {
    S.pad.source = 'gamepad';
    emit('padchange');
    emit('padfound', { id: e.gamepad.id || 'gamepad' });
    rumble('connect');
  }
});
window.addEventListener('gamepaddisconnected', () => {
  if (S.pad.source === 'gamepad' && !(navigator.getGamepads && navigator.getGamepads()[0])) {
    S.pad.source = 'none';
    releaseAll();
    emit('padchange');
  }
});

const GP_BTN = ['south', 'east', 'west', 'north', 'l1', 'r1', 'l2b', 'r2b',
  'select', 'start', 'l3', 'r3', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'guide'];
const gpState = { buttons: new Array(17).fill(false), dig: {} };

function pollGamepad() {
  if (S.pad.available) return;      // backend pad wins
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  if (!gp) {
    if (S.pad.source === 'gamepad') { S.pad.source = 'none'; releaseAll(); emit('padchange'); }
    return;
  }
  if (S.pad.source !== 'gamepad') { S.pad.source = 'gamepad'; emit('padchange'); }

  const dz = S.settings.deadzone ?? 0.12;
  const shape = (v) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));
  axes.lx = shape(gp.axes[0] || 0);
  axes.ly = -shape(gp.axes[1] || 0);
  axes.rx = shape(gp.axes[2] || 0);
  axes.ry = -shape(gp.axes[3] || 0);
  axes.l2 = gp.buttons[6] ? gp.buttons[6].value : 0;
  axes.r2 = gp.buttons[7] ? gp.buttons[7].value : 0;

  gp.buttons.forEach((b, i) => {
    if (i === 6 || i === 7 || i >= GP_BTN.length) return;
    const was = gpState.buttons[i];
    if (b.pressed && !was) pressWithRepeat(GP_BTN[i]);
    else if (!b.pressed && was) release(GP_BTN[i]);
    gpState.buttons[i] = b.pressed;
  });

  // digital projection of the right stick, with hysteresis
  for (const [name, v] of [['rstick_right', axes.rx], ['rstick_left', -axes.rx],
                           ['rstick_up', axes.ry], ['rstick_down', -axes.ry]]) {
    const held = gpState.dig[name];
    if (!held && v > 0.6) { gpState.dig[name] = true; pressWithRepeat(name); }
    else if (held && v < 0.35) { gpState.dig[name] = false; release(name); }
  }
}

// -- keyboard -------------------------------------------------------------

const KEYMAP = {
  'ArrowLeft': 'dpad_left', 'ArrowRight': 'dpad_right',
  'ArrowUp': 'dpad_up', 'ArrowDown': 'dpad_down',
  'Enter': 'south', 'Escape': 'east',
  'w': 'west', 'e': 'north',
  '[': 'rstick_left', ']': 'rstick_right',
  'z': 'rstick_up', 'g': 'rstick_down',
  'n': 'start', ',': 'select', 'a': 'share', '?': 'guide',
  'Tab': 'r3',
};

document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('.xterm, input, textarea')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[1-9]$/.test(e.key) && S.mode === 'deck') { deck.jump(+e.key - 1); return; }
  if (/^[1-9]$/.test(e.key) && S.mode === 'wheel') { wheel.pick(+e.key - 1); return; }
  if (e.key === 'v' && !e.repeat) {
    send({ t: 'set', key: 'input_viz', value: S.settings.input_viz === false });
    return;
  }
  const name = KEYMAP[e.key];
  if (!name) return;
  e.preventDefault();
  if (e.repeat) { if (name.startsWith('dpad')) onDown(name); return; }
  onDown(name);
});

document.addEventListener('keyup', (e) => {
  if (e.target.closest && e.target.closest('.xterm, input, textarea')) return;
  const name = KEYMAP[e.key];
  if (name) onUp(name);
});

// -- the frame loop: scroll velocity, gamepad poll, trigger ramps ---------

let last = performance.now();
let scrollAcc = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pollGamepad();
  lstickMenus();

  if (S.mode === 'deck' && !S.grid) {
    const s = activeSession();
    if (s && Math.abs(axes.ly) > 0.04) {
      const turbo = 1 + axes.l2 * 5;
      scrollAcc += -axes.ly * (14 + Math.abs(axes.ly) * 26) * turbo * dt;
      const n = Math.trunc(scrollAcc);
      if (n !== 0) { s.term.scrollLines(n); scrollAcc -= n; }
    }
  }
  if (S.mode === 'prs') prs.pressure(axes.r2, dt);
  if (S.mode === 'wheel') wheel.point(axes.rx, axes.ry);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
