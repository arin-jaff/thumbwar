// one place decides what is on screen.

import { S, emit } from './state.js';
import { rumble } from './rumble.js';

const panelIds = ['wheel', 'prs', 'spawn', 'settings'];
const scrimIds = ['help', 'done', 'away'];

export function setMode(next) {
  if (next === S.mode) next = 'deck';
  for (const id of [...panelIds, ...scrimIds]) {
    document.getElementById(id).classList.toggle('hidden', id !== next);
  }
  const was = S.mode;
  S.mode = next;
  document.querySelectorAll('#modetabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.goto === (panelIds.includes(next) ? next : 'deck'));
  });
  if (next !== 'deck' || was !== 'deck') rumble('thock');
  emit('mode', { mode: next, was });
}
