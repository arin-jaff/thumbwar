// the in app disclaimer and the away screen.

import { S, on } from './state.js';
import { send } from './ws.js';
import { rumble } from './rumble.js';
import { setMode } from './modes.js';
import { SPINNER } from './art.js';

const namesEl = document.getElementById('done-names');
const ringEl = document.getElementById('done-ring');
const numEl = document.getElementById('done-num');
const dismissBtn = document.getElementById('done-dismiss');
const awaySpin = document.getElementById('away-spinner');
const awayDots = document.getElementById('away-dots');

let timer = null;

function startCountdown() {
  const total = S.settings.countdown_seconds ?? 3;
  clearInterval(timer);
  rumble('heartbeat');
  if (total <= 0) {
    ringEl.style.setProperty('--p', '1');
    numEl.textContent = '✻';
    return;
  }
  const t0 = performance.now();
  const paint = () => {
    const left = total - (performance.now() - t0) / 1000;
    if (left <= 0) { ack(); return; }
    ringEl.style.setProperty('--p', (left / total).toFixed(3));
    numEl.textContent = String(Math.ceil(left));
  };
  paint();
  timer = setInterval(paint, 50);
}

export function ack() {
  clearInterval(timer);
  timer = null;
  rumble('still');
  for (const s of S.sessions.values()) s.finished = false;
  send({ t: 'ack' });
  if (S.mode === 'done') setMode('deck');
}

on('ws:alldone', ({ names }) => {
  S.done.names = names || [];
  if (S.away) return;                    // the system overlay has this one
  if (['done'].includes(S.mode)) return;
  namesEl.textContent = S.done.names.length
    ? S.done.names.join(', ') + ' wrapped up'
    : 'everything wrapped up';
  setMode('done');
  startCountdown();
});

on('done:ack', ack);
dismissBtn.addEventListener('click', ack);

on('mode', ({ mode, was }) => {
  if (was === 'done' && mode !== 'done' && timer) { clearInterval(timer); timer = null; rumble('still'); }
});

// -- away ----------------------------------------------------------------

let awayTimer = null;

on('ws:away', ({ on: isAway }) => {
  S.away = isAway;
  if (isAway) {
    setMode('away');
    let f = 0;
    clearInterval(awayTimer);
    awayTimer = setInterval(() => {
      awaySpin.textContent = SPINNER[f++ % SPINNER.length];
      awayDots.innerHTML = '';
      for (const s of S.sessions.values()) {
        const d = document.createElement('span');
        d.className = 'away-dot';
        d.innerHTML = `<span class="d ${s.state}"></span>`;
        d.append(s.name);
        awayDots.appendChild(d);
      }
    }, 260);
  } else {
    clearInterval(awayTimer);
    awayTimer = null;
    if (S.mode === 'away') setMode('deck');
  }
});
