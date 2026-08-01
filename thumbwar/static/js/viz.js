// the input visualizer: a little live controller in the corner, so a
// stream, a clip, or a curious shoulder-surfer can see your thumbs.
// toggle with v or from settings.

import { S, on } from './state.js';
import { controllerSvg } from './padmap.js';

const el = document.getElementById('miniviz');
el.classList.add('padmap');
el.innerHTML = controllerSvg(false);

function apply() {
  el.classList.toggle('hidden', S.settings.input_viz === false);
}

on('ws:hello', apply);
on('ws:settings', apply);
