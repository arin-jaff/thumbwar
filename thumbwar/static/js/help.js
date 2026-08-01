// the controller map screen: the labeled drawing from padmap.js plus
// the keyboard strip. it stays up while you mash; b puts it away.

import { S, on } from './state.js';
import { setMode } from './modes.js';
import { controllerSvg } from './padmap.js';

const mapEl = document.getElementById('help-map');
const kbdEl = document.getElementById('help-kbd');

mapEl.classList.add('padmap');
document.getElementById('help').addEventListener('click', () => setMode('deck'));

function render() {
  mapEl.innerHTML = controllerSvg(true, S.settings.quick_slots);
  const KBD = [
    ['←↑↓→', 'move'], ['enter', 'type'], ['esc', 'back'], ['n', 'new'],
    [',', 'settings'], ['a', 'away'], ['?', 'this map'], ['1-9', 'jump'],
    ['w', 'wheel'], ['z', 'zoom'], ['g', 'grid'], ['[ ]', 'flip'],
    ['tab', 'needs you'], ['v', 'visualizer'], ['ctrl `', 'leave typing'],
  ];
  kbdEl.innerHTML = KBD.map(([k, v]) =>
    `<span class="hint"><span class="btn-chip">${k}</span> ${v}</span>`).join('');
}

on('mode', ({ mode }) => { if (mode === 'help') render(); });
on('ws:hello', render);
