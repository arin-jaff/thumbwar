// the settings panel. dpad picks a row, left and right tune it.

import { S, on } from './state.js';
import { send } from './ws.js';
import { rumble } from './rumble.js';

const listEl = document.getElementById('settings-list');

const COUNTDOWNS = [0, 3, 5, 10, 15, 30];
const AWAY_AFTER = [15, 30, 60, 120, 300];

const ROWS = [
  { key: 'countdown_seconds', label: 'countdown before the pull back',
    kind: 'cycle', values: COUNTDOWNS, fmt: (v) => (v === 0 ? 'off' : v + 's') },
  { key: 'auto_return', label: 'jump back at zero', kind: 'toggle' },
  { key: 'overlay_always', label: 'overlay even when not away', kind: 'toggle' },
  { key: 'auto_away', label: 'slip away on your own', kind: 'toggle' },
  { key: 'auto_away_after', label: 'after this much quiet',
    kind: 'cycle', values: AWAY_AFTER, fmt: (v) => v + 's' },
  { key: 'rumble', label: 'rumble', kind: 'toggle' },
  { key: 'rumble_intensity', label: 'rumble strength', kind: 'slider',
    min: 0.1, max: 1, step: 0.1, fmt: (v) => Math.round(v * 100) + '%' },
  { key: 'deadzone', label: 'stick deadzone', kind: 'slider',
    min: 0.05, max: 0.3, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'wispr_key', label: 'wispr push to talk combo', kind: 'text' },
  { key: 'merge_method', label: 'merge style', kind: 'cycle',
    values: ['squash', 'merge', 'rebase'], fmt: (v) => v },
  { key: 'session_cmd', label: 'session command', kind: 'text' },
  { label: 'try the rumble', kind: 'button', run: () => rumble('done') },
  { label: 'try the overlay', kind: 'button', run: () => send({ t: 'overlay_test' }) },
];

export function keys(name) {
  const i = S.settingsUI.sel;
  const row = ROWS[i];
  switch (name) {
    case 'dpad_up': S.settingsUI.sel = Math.max(0, i - 1); render(); rumble('tick'); break;
    case 'dpad_down': S.settingsUI.sel = Math.min(ROWS.length - 1, i + 1); render(); rumble('tick'); break;
    case 'dpad_left': adjust(row, -1); break;
    case 'dpad_right': adjust(row, 1); break;
    case 'south':
      if (row.kind === 'toggle') adjust(row, 1);
      else if (row.kind === 'button') { row.run(); rumble('confirm'); }
      else if (row.kind === 'text') {
        const input = listEl.querySelector('.set-row.sel .set-input');
        if (input) input.focus();
      }
      break;
  }
}

function adjust(row, dir) {
  if (!row || !row.key) { if (row && row.kind === 'button' && dir > 0) row.run(); return; }
  const cur = S.settings[row.key];
  let next = cur;
  if (row.kind === 'toggle') next = !cur;
  else if (row.kind === 'cycle') {
    const i = row.values.indexOf(cur);
    next = row.values[Math.min(row.values.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
  } else if (row.kind === 'slider') {
    next = Math.min(row.max, Math.max(row.min, +(cur + dir * row.step).toFixed(3)));
  } else return;
  if (next !== cur) {
    send({ t: 'set', key: row.key, value: next });
    rumble('tick');
  }
}

export function render() {
  listEl.innerHTML = '';
  ROWS.forEach((row, i) => {
    const d = document.createElement('div');
    d.className = 'set-row' + (i === S.settingsUI.sel ? ' sel' : '');
    const label = `<span class="set-label">${row.label}</span>`;
    const v = row.key ? S.settings[row.key] : null;
    if (row.kind === 'toggle') {
      d.innerHTML = `${label}<span class="set-toggle ${v ? 'on' : ''}"></span>`;
      d.querySelector('.set-toggle').addEventListener('click', () => adjust(row, 1));
    } else if (row.kind === 'cycle') {
      d.innerHTML = `${label}<span class="set-value">${row.fmt(v)}</span>`;
    } else if (row.kind === 'slider') {
      d.innerHTML = `${label}<input class="set-slider" type="range" min="${row.min}" max="${row.max}" step="${row.step}" value="${v}"><span class="set-value">${row.fmt(v)}</span>`;
      d.querySelector('input').addEventListener('input', (e) => {
        send({ t: 'set', key: row.key, value: +e.target.value });
      });
    } else if (row.kind === 'text') {
      d.innerHTML = `${label}<input class="set-input" value="">`;
      const input = d.querySelector('input');
      input.value = v ?? '';
      input.addEventListener('change', () => send({ t: 'set', key: row.key, value: input.value }));
      input.addEventListener('keydown', (e) => e.stopPropagation());
    } else if (row.kind === 'button') {
      d.innerHTML = `${label}<button class="set-btn">go</button>`;
      d.querySelector('button').addEventListener('click', row.run);
    }
    d.addEventListener('mousedown', () => { S.settingsUI.sel = i; render(); });
    listEl.appendChild(d);
  });
}

on('ws:settings', (m) => {
  S.settings = m.settings;
  if (S.mode === 'settings') render();
});

on('mode', ({ mode }) => { if (mode === 'settings') render(); });
