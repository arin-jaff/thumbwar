// one store, one event bus. everything reads S, everything talks via emit/on.

export const S = {
  connected: false,
  sessions: new Map(),   // id -> {id, name, cwd, state, finished, term}
  order: [],             // deck order of session ids
  active: 0,             // index into order
  mode: 'deck',          // deck wheel prs spawn settings help done away
  zoom: false,
  grid: false,
  typing: false,         // keystrokes flow into the active terminal
  broadcast: false,      // stdin mirrors into every session
  away: false,
  settings: {},
  pad: { available: false, source: 'none', battery: null, tmux: false },
  prs: { list: [], sel: 0, cwd: '', holding: 0, error: '' },
  wheel: { group: 0, item: 0 },
  spawnUI: { tab: 'dirs', dirs: [], tmux: [], sel: 0 },
  settingsUI: { sel: 0 },
  done: { names: [] },
};

const bus = new EventTarget();

export function emit(name, detail = {}) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, fn) {
  bus.addEventListener(name, (e) => fn(e.detail));
}

export function activeSession() {
  return S.sessions.get(S.order[S.active]) || null;
}
