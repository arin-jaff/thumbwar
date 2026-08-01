// the one socket. reconnects forever, routes messages onto the bus as ws:<type>.

import { S, emit } from './state.js';

let sock = null;
let retry = 500;

export function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  sock = new WebSocket(`${scheme}://${location.host}/ws`);
  sock.onopen = () => {
    S.connected = true;
    retry = 500;
    emit('conn', { up: true });
  };
  sock.onclose = () => {
    S.connected = false;
    emit('conn', { up: false });
    setTimeout(connect, retry);
    retry = Math.min(retry * 1.7, 8000);
  };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    emit('ws:' + m.t, m);
  };
}

export function send(obj) {
  if (sock && sock.readyState === 1) sock.send(JSON.stringify(obj));
}

const enc = new TextEncoder();

export function sendStdin(id, text) {
  const bytes = typeof text === 'string' ? enc.encode(text) : text;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const data = btoa(bin);
  // broadcast mode mirrors every keystroke into every agent
  if (S.broadcast && S.order.includes(id)) {
    for (const sid of S.order) send({ t: 'stdin', id: sid, data });
    return;
  }
  send({ t: 'stdin', id, data });
}
