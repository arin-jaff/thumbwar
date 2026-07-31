// xterm.js wiring for one session card.

import { send, sendStdin } from './ws.js';
import { emit } from './state.js';

const THEME = {
  background: '#0b1f1a',
  foreground: '#dff5ea',
  cursor: '#3fd99f',
  cursorAccent: '#0b1f1a',
  selectionBackground: 'rgba(63,217,159,.28)',
  black: '#0b1f1a', brightBlack: '#3c5a50',
  red: '#ff7a66', brightRed: '#ff9b8a',
  green: '#3fd99f', brightGreen: '#7deec0',
  yellow: '#f5c15c', brightYellow: '#ffd98a',
  blue: '#6fb7ff', brightBlue: '#9dcdff',
  magenta: '#d9a0ff', brightMagenta: '#e8c2ff',
  cyan: '#5fe0d0', brightCyan: '#93efe4',
  white: '#dff5ea', brightWhite: '#ffffff',
};

export class TermView {
  constructor(id, host) {
    this.id = id;
    this.term = new Terminal({
      theme: THEME,
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      scrollback: 8000,
      cursorBlink: true,
      allowTransparency: false,
      macOptionIsMeta: true,
    });
    this.fit = new FitAddon.FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(host);
    this.term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === 'keydown' && ev.ctrlKey && ev.key === '`') {
        emit('typing:exit');
        return false;
      }
      return true;
    });
    this.term.onData((d) => sendStdin(this.id, d));
    this.term.onResize(({ cols, rows }) => send({ t: 'resize', id: this.id, cols, rows }));
    send({ t: 'replay', id: this.id });
  }

  write(b64) {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    this.term.write(bytes);
  }

  refit() {
    try { this.fit.fit(); } catch { /* host not laid out yet */ }
  }

  scrollLines(n) { this.term.scrollLines(n); }
  scrollPages(n) { this.term.scrollPages(n); }
  toBottom() { this.term.scrollToBottom(); }
  focus() { this.term.focus(); }
  blur() { this.term.blur(); }
  dispose() { this.term.dispose(); }
}
