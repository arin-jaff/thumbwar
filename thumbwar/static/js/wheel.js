// the wheel: every claude code menu on a radial pie. the right stick
// points at a slice, the dpad rolls around the rim, a fires.

import { S, on, emit, activeSession } from './state.js';
import { send, sendStdin } from './ws.js';
import { rumble } from './rumble.js';
import { setMode } from './modes.js';

export const GROUPS = [
  { name: 'flow', items: [
    { label: '/clear', hint: 'fresh context' },
    { label: '/compact', hint: 'squeeze context' },
    { label: '/context', hint: 'whats in the window' },
    { label: '/cost', hint: 'the damage' },
    { label: '/todos', hint: 'the list' },
    { label: '/usage', hint: 'plan limits' },
    { label: '/rewind', hint: 'go back in time' },
    { label: '/resume', hint: 'pick up a session' },
    { label: '/export', hint: 'save transcript' },
  ]},
  { name: 'craft', items: [
    { label: '/review', hint: 'review a pr' },
    { label: '/security-review', hint: 'check the diff' },
    { label: '/pr-comments', hint: 'fetch comments' },
    { label: '/init', hint: 'write claude.md' },
    { label: '/memory', hint: 'edit memory' },
    { label: '/output-style', hint: 'change the voice' },
    { label: '/vim', hint: 'vim keys' },
  ]},
  { name: 'model', items: [
    { label: 'default', cmd: '/model default', hint: 'recommended' },
    { label: 'fable', cmd: '/model fable', hint: 'deepest' },
    { label: 'opus', cmd: '/model opus', hint: 'big brain' },
    { label: 'sonnet', cmd: '/model sonnet', hint: 'daily driver' },
    { label: 'haiku', cmd: '/model haiku', hint: 'quick' },
    { label: 'picker', cmd: '/model', hint: 'open the menu' },
  ]},
  { name: 'rig', items: [
    { label: '/config', hint: 'settings' },
    { label: '/permissions', hint: 'allow rules' },
    { label: '/hooks', hint: 'hooks' },
    { label: '/mcp', hint: 'servers' },
    { label: '/agents', hint: 'subagents' },
    { label: '/bashes', hint: 'background shells' },
    { label: '/statusline', hint: 'status line' },
    { label: '/status', hint: 'whats up' },
    { label: '/doctor', hint: 'health check' },
    { label: '/help', hint: 'help' },
  ]},
  { name: 'keys', items: [
    { label: 'cycle modes', raw: '\x1b[Z', hint: 'shift tab' },
    { label: 'interrupt', raw: '\x1b', hint: 'esc' },
    { label: 'background it', raw: '\x02', hint: 'ctrl b' },
    { label: 'expand output', raw: '\x0f', hint: 'ctrl o' },
    { label: 'todos', raw: '\x14', hint: 'ctrl t' },
    { label: 'transcript', raw: '\x12', hint: 'ctrl r' },
    { label: 'undo typing', raw: '\x1f', hint: 'ctrl _' },
    { label: 'redraw', raw: '\x0c', hint: 'ctrl l' },
  ]},
  { name: 'agent', items: [
    { label: 'duplicate', act: 'duplicate', hint: 'twin this agent' },
    { label: 'restart', act: 'restart', hint: 'fresh claude, same repo' },
    { label: 'broadcast', act: 'broadcast', hint: 'type into every agent' },
    { label: 'kill', act: 'kill', hint: 'end this agent' },
  ]},
];

const pieEl = document.getElementById('wheel-pie');
const hubLabel = document.getElementById('hub-label');
const hubHint = document.getElementById('hub-hint');
const groupsEl = document.getElementById('wheel-groups');

let pos = 0;                  // selected slice

// -- geometry ---------------------------------------------------------------

const C = 200, R_HUB = 66, R_OUT = 186, R_LABEL = 130;

function pt(a, r) {
  return `${(C + r * Math.sin(a)).toFixed(2)} ${(C - r * Math.cos(a)).toFixed(2)}`;
}

// one donut wedge from angle a0 to a1 (radians from the top, clockwise)
function wedge(a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${pt(a0, R_HUB)} L ${pt(a0, R_OUT)} A ${R_OUT} ${R_OUT} 0 ${large} 1 ${pt(a1, R_OUT)}`
       + ` L ${pt(a1, R_HUB)} A ${R_HUB} ${R_HUB} 0 ${large} 0 ${pt(a0, R_HUB)} Z`;
}

// -- selection ----------------------------------------------------------------

export function roll(delta) {
  const n = GROUPS[S.wheel.group].items.length;
  select((pos + delta + n) % n);
}

export function group(delta) {
  const n = GROUPS.length;
  S.wheel.group = (S.wheel.group + delta + n) % n;
  pos = 0;
  render();
  rumble('thock');
}

function select(i) {
  if (i === pos) return;
  pos = i;
  S.wheel.item = i;
  paint();
  rumble('detent');
}

// the right stick points at a slice. called every frame while the wheel is up.
export function point(rx, ry) {
  const mag = Math.hypot(rx, ry);
  if (mag < 0.5) return;
  const n = GROUPS[S.wheel.group].items.length;
  const step = (2 * Math.PI) / n;
  let a = Math.atan2(rx, ry);              // 0 at the top, clockwise positive
  if (a < 0) a += 2 * Math.PI;
  select(Math.round(a / step) % n);
}

export function pick(i) {
  const n = GROUPS[S.wheel.group].items.length;
  if (i < 0 || i >= n) return;
  select(i);
  fire();
}

export function fire() {
  const item = GROUPS[S.wheel.group].items[pos];
  const s = activeSession();
  if (!s) { rumble('error'); return; }
  if (item.act) {
    if (item.act === 'broadcast') {
      S.broadcast = !S.broadcast;
      emit('broadcast');
    } else send({ t: item.act, id: s.id });
  } else if (item.raw) {
    sendStdin(s.id, item.raw);
  } else {
    sendStdin(s.id, item.cmd || item.label);
    setTimeout(() => sendStdin(s.id, '\r'), 160);
  }
  rumble('confirm');
  setMode('deck');
}

// -- paint --------------------------------------------------------------------

export function render() {
  groupsEl.innerHTML = '';
  GROUPS.forEach((g, i) => {
    const b = document.createElement('button');
    b.textContent = g.name;
    b.className = i === S.wheel.group ? 'on' : '';
    b.addEventListener('click', () => { S.wheel.group = i; pos = 0; render(); });
    groupsEl.appendChild(b);
  });

  const items = GROUPS[S.wheel.group].items;
  const n = items.length;
  const step = (2 * Math.PI) / n;
  let svg = '';
  items.forEach((item, i) => {
    // slice i is centered on its notch, so item 0 sits square at the top
    const a0 = i * step - step / 2, a1 = i * step + step / 2;
    const amDeg = (i * step * 180) / Math.PI;
    let rot = amDeg - 90;
    if (amDeg > 90 && amDeg <= 270) rot += 180;   // keep labels upright
    const [lx, ly] = [C + R_LABEL * Math.sin(i * step), C - R_LABEL * Math.cos(i * step)];
    const size = item.label.length > 12 ? 10.5 : 12.5;
    svg += `<g class="pie-slice" data-i="${i}">
      <path d="${wedge(a0 + 0.012, a1 - 0.012)}"></path>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="${size}"
        transform="rotate(${rot.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})">${escXml(item.label)}</text>
    </g>`;
  });
  pieEl.innerHTML = `<svg viewBox="0 0 400 400" role="menu" aria-label="commands">${svg}</svg>`;
  pieEl.querySelectorAll('.pie-slice').forEach((g) => {
    const i = +g.dataset.i;
    g.addEventListener('pointerenter', () => select(i));
    g.addEventListener('click', () => pick(i));
  });
  if (pos >= n) pos = 0;
  paint();
}

function paint() {
  pieEl.querySelectorAll('.pie-slice').forEach((g) => {
    g.classList.toggle('sel', +g.dataset.i === pos);
  });
  const item = GROUPS[S.wheel.group].items[pos];
  hubLabel.textContent = item ? item.label : '';
  hubHint.textContent = item ? item.hint || '' : '';
}

function escXml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

on('mode', ({ mode }) => { if (mode === 'wheel') render(); });
