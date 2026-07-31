// spawn a new agent: pick a repo, adopt a tmux session, or drop a shell.

import { S, on } from './state.js';
import { send } from './ws.js';
import { rumble } from './rumble.js';
import { setMode } from './modes.js';

const listEl = document.getElementById('spawn-list');
const tabsEl = document.getElementById('spawn-tabs');

const TABS = ['dirs', 'tmux', 'shell'];

export function open() {
  S.spawnUI.sel = 0;
  send({ t: 'dirs' });
  render();
}

export function keys(name) {
  const rows = currentRows();
  switch (name) {
    case 'dpad_up': S.spawnUI.sel = Math.max(0, S.spawnUI.sel - 1); render(); rumble('tick'); break;
    case 'dpad_down': S.spawnUI.sel = Math.min(rows.length - 1, S.spawnUI.sel + 1); render(); rumble('tick'); break;
    case 'west': case 'dpad_right': flipTab(1); break;
    case 'dpad_left': flipTab(-1); break;
    case 'south': pick(rows[S.spawnUI.sel]); break;
  }
}

function flipTab(d) {
  const i = (TABS.indexOf(S.spawnUI.tab) + d + TABS.length) % TABS.length;
  S.spawnUI.tab = TABS[i];
  S.spawnUI.sel = 0;
  render();
  rumble('thock');
}

//: the panel shows this many rows, so selection must not walk past them
const VISIBLE = 12;

function currentRows() {
  if (S.spawnUI.tab === 'dirs') return S.spawnUI.dirs.slice(0, VISIBLE);
  if (S.spawnUI.tab === 'tmux') return S.spawnUI.tmux.slice(0, VISIBLE);
  return [
    { shell: true, name: 'plain shell at home', cmd: 'exec $SHELL', cwd: '~' },
    { shell: true, name: 'claude at home', cwd: '~' },
    { shell: true, name: 'claude --continue at home', cmd: 'claude --continue', cwd: '~' },
  ];
}

function pick(row) {
  if (!row) { rumble('error'); return; }
  if (S.spawnUI.tab === 'dirs') {
    send({ t: 'spawn', cwd: row.path, name: row.name });
  } else if (S.spawnUI.tab === 'tmux') {
    send({ t: 'adopt', target: row.name, cwd: '~' });
  } else {
    send({ t: 'spawn', cwd: row.cwd, name: row.name, cmd: row.cmd });
  }
}

function render() {
  tabsEl.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === S.spawnUI.tab);
  });
  const rows = currentRows();
  listEl.innerHTML = '';
  if (!rows.length) {
    const label = S.spawnUI.tab === 'tmux'
      ? (S.pad.tmux ? 'no tmux sessions to adopt' : 'tmux is not installed, so nothing to adopt')
      : 'no git repos found under your roots. add one in settings.';
    listEl.innerHTML = `<div class="spawn-empty">${label}</div>`;
    return;
  }
  rows.forEach((row, i) => {
    const d = document.createElement('div');
    d.className = 'spawn-row' + (i === S.spawnUI.sel ? ' sel' : '');
    const sub = row.path || (row.windows ? `${row.windows} windows` : row.cmd || 'claude');
    d.innerHTML = `<span class="sr-name"></span><span class="sr-path"></span>`;
    d.querySelector('.sr-name').textContent = row.name;
    d.querySelector('.sr-path').textContent = sub;
    d.addEventListener('click', () => { S.spawnUI.sel = i; pick(row); });
    listEl.appendChild(d);
  });
}

tabsEl.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => { S.spawnUI.tab = b.dataset.tab; S.spawnUI.sel = 0; render(); });
});

on('ws:dirs', (m) => {
  S.spawnUI.dirs = m.dirs || [];
  S.spawnUI.tmux = (m.tmux || []).filter((t) => !t.attached);
  render();
});

on('ws:session', () => { if (S.mode === 'spawn') setMode('deck'); });

on('mode', ({ mode }) => { if (mode === 'spawn') open(); });
