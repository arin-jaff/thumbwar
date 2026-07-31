// haptics with taste. backend pad if present, browser gamepad otherwise.

import { S } from './state.js';
import { send } from './ws.js';

// local approximations of the backend patterns, for gamepad api pads
const LOCAL = {
  tick:      [{ d: 20, s: 0, w: 0.35 }],
  detent:    [{ d: 22, s: 0, w: 0.45 }],
  thock:     [{ d: 50, s: 0.28, w: 0.5 }],
  accept:    [{ d: 30, s: 0, w: 0.6 }, { gap: 40 }, { d: 50, s: 0, w: 0.9 }],
  reject:    [{ d: 110, s: 0.75, w: 0 }],
  confirm:   [{ d: 90, s: 0.3, w: 0.8 }],
  done:      [{ d: 90, s: 0.4, w: 0.7 }, { gap: 90 }, { d: 90, s: 0.4, w: 0.7 }, { gap: 90 }, { d: 140, s: 0.55, w: 0.95 }],
  error:     [{ d: 80, s: 0.8, w: 0 }, { gap: 60 }, { d: 80, s: 0.8, w: 0 }],
  connect:   [{ d: 40, s: 0, w: 0.45 }, { gap: 50 }, { d: 70, s: 0.2, w: 0.6 }],
  interrupt: [{ d: 160, s: 0.9, w: 0.3 }],
  heartbeat: [{ d: 60, s: 0.35, w: 0 }, { gap: 100 }, { d: 80, s: 0.55, w: 0 }],
  still:     [],
};

let localTimer = null;

export function rumble(pattern) {
  if (S.settings.rumble === false) return;
  if (S.pad.available) {
    send({ t: 'rumble', pattern });
    return;
  }
  playLocal(pattern);
}

function actuator() {
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  return gp && gp.vibrationActuator ? gp.vibrationActuator : null;
}

function playLocal(pattern) {
  const act = actuator();
  if (!act) return;
  if (localTimer) { clearTimeout(localTimer); localTimer = null; }
  if (pattern === 'still') { act.reset && act.reset(); return; }
  if (pattern.startsWith('ramp:')) {
    const p = Math.min(1, Math.max(0, parseFloat(pattern.slice(5)) || 0));
    act.playEffect('dual-rumble', {
      duration: 80, strongMagnitude: 0.5 * p, weakMagnitude: p * p,
    }).catch(() => {});
    return;
  }
  const steps = LOCAL[pattern];
  if (!steps || !steps.length) return;
  const k = S.settings.rumble_intensity ?? 0.8;
  let i = 0;
  const step = () => {
    if (i >= steps.length) { localTimer = null; return; }
    const s = steps[i++];
    if (s.gap) { localTimer = setTimeout(step, s.gap); return; }
    act.playEffect('dual-rumble', {
      duration: s.d, strongMagnitude: Math.min(1, s.s * k), weakMagnitude: Math.min(1, s.w * k),
    }).catch(() => {});
    localTimer = setTimeout(step, s.d + 4);
  };
  step();
}
