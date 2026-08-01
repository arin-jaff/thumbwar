// synthesized ui sounds. no assets, just webaudio, mapped to the same
// names as the rumble patterns so audio and haptics stay one language.

import { S } from './state.js';

let ctx = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// one enveloped oscillator sweep
function tone(c, { f0, f1 = 0, t = 0.08, type = 'sine', g = 0.12, at = 0 }) {
  const k = S.settings.sound_volume ?? 0.4;
  const o = c.createOscillator();
  const amp = c.createGain();
  const now = c.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(f0, now);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + t);
  amp.gain.setValueAtTime(0, now);
  amp.gain.linearRampToValueAtTime(g * k, now + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0008, now + t);
  o.connect(amp).connect(c.destination);
  o.start(now);
  o.stop(now + t + 0.03);
}

const PACK = {
  tick:      (c) => tone(c, { f0: 2100, t: 0.016, type: 'triangle', g: 0.04 }),
  detent:    (c) => tone(c, { f0: 1500, t: 0.022, type: 'triangle', g: 0.055 }),
  thock:     (c) => tone(c, { f0: 240, f1: 110, t: 0.07, g: 0.16 }),
  accept:    (c) => { tone(c, { f0: 660, t: 0.05, g: 0.1 }); tone(c, { f0: 990, t: 0.07, g: 0.1, at: 0.06 }); },
  reject:    (c) => tone(c, { f0: 200, f1: 130, t: 0.12, type: 'square', g: 0.05 }),
  confirm:   (c) => { tone(c, { f0: 523, t: 0.06, g: 0.1 }); tone(c, { f0: 784, t: 0.09, g: 0.1, at: 0.07 }); },
  done:      (c) => [523, 659, 784].forEach((f, i) => tone(c, { f0: f, t: 0.1, g: 0.11, at: i * 0.09 })),
  error:     (c) => { tone(c, { f0: 311, t: 0.07, type: 'square', g: 0.04 }); tone(c, { f0: 208, t: 0.1, type: 'square', g: 0.04, at: 0.08 }); },
  needs_you: (c) => { tone(c, { f0: 880, t: 0.09, g: 0.1 }); tone(c, { f0: 659, t: 0.13, g: 0.1, at: 0.1 }); },
  connect:   (c) => { tone(c, { f0: 440, t: 0.05, g: 0.08 }); tone(c, { f0: 660, t: 0.07, g: 0.08, at: 0.06 }); },
  interrupt: (c) => tone(c, { f0: 180, f1: 90, t: 0.14, type: 'sawtooth', g: 0.045 }),
};

export function sound(name) {
  if (S.settings.sound === false) return;
  const play = PACK[name];
  if (!play) return;
  const c = ac();
  if (c) play(c);
}
