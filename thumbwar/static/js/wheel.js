// the wheel: every claude code menu, rolled with a thumb.

import { S, on, activeSession } from './state.js';
import { sendStdin } from './ws.js';
import { rumble } from './rumble.js';
import { setMode } from './modes.js';

const GROUPS = [
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
];

const itemsEl = document.getElementById('wheel-items');
const groupsEl = document.getElementById('wheel-groups');

let pos = 0;          // selected index
let float = 0;        // animated
let lastCross = 0;

export function roll(delta) {
  const items = GROUPS[S.wheel.group].items;
  const next = Math.min(items.length - 1, Math.max(0, pos + delta));
  if (next === pos) { rumble('tick'); return; }
  pos = next;
  S.wheel.item = pos;
}

export function group(delta) {
  const n = GROUPS.length;
  S.wheel.group = (S.wheel.group + delta + n) % n;
  pos = 0; float = 0;
  render();
  rumble('thock');
}

export function fire() {
  const item = GROUPS[S.wheel.group].items[pos];
  const s = activeSession();
  if (!s) { rumble('error'); return; }
  if (item.raw) {
    sendStdin(s.id, item.raw);
  } else {
    sendStdin(s.id, item.cmd || item.label);
    setTimeout(() => sendStdin(s.id, '\r'), 160);
  }
  rumble('confirm');
  setMode('deck');
}

export function render() {
  groupsEl.innerHTML = '';
  GROUPS.forEach((g, i) => {
    const b = document.createElement('button');
    b.textContent = g.name;
    b.className = i === S.wheel.group ? 'on' : '';
    b.addEventListener('click', () => { S.wheel.group = i; pos = 0; float = 0; render(); });
    groupsEl.appendChild(b);
  });
  itemsEl.innerHTML = '';
  GROUPS[S.wheel.group].items.forEach((item, i) => {
    const d = document.createElement('div');
    d.className = 'wheel-item';
    d.innerHTML = `<span class="wi-label"></span><span class="wi-hint"></span>`;
    d.querySelector('.wi-label').textContent = item.label;
    d.querySelector('.wi-hint').textContent = item.hint || '';
    d.addEventListener('click', () => { pos = i; fire(); });
    itemsEl.appendChild(d);
  });
  layout();
}

function layout() {
  const kids = itemsEl.children;
  for (let i = 0; i < kids.length; i++) {
    const off = i - float;
    const el = kids[i];
    el.style.transform =
      `translateY(${off * 52 - 22}px) scale(${1 - Math.min(0.3, Math.abs(off) * 0.09)}) ` +
      `rotateX(${-off * 9}deg)`;
    el.style.opacity = String(Math.max(0, 1 - Math.abs(off) * 0.24));
    el.classList.toggle('center', Math.round(float) === i);
  }
}

function anim() {
  if (S.mode === 'wheel') {
    const diff = pos - float;
    if (Math.abs(diff) > 0.002) {
      float += diff * 0.22;
      if (Math.abs(pos - float) < 0.004) float = pos;
      const c = Math.round(float);
      if (c !== lastCross) { lastCross = c; rumble('detent'); }
      layout();
    }
  }
  requestAnimationFrame(anim);
}
requestAnimationFrame(anim);

on('mode', ({ mode }) => { if (mode === 'wheel') render(); });
