// the pr bay. dpad picks, the right trigger squeezes a merge.

import { S, on, activeSession } from './state.js';
import { send } from './ws.js';
import { rumble } from './rumble.js';

const listEl = document.getElementById('prs-list');
const repoEl = document.getElementById('prs-repo');

let merging = false;
let lastRamp = 0;

export function open() {
  const s = activeSession();
  S.prs.cwd = s ? s.cwd : '';
  S.prs.sel = 0;
  S.prs.holding = 0;
  repoEl.textContent = S.prs.cwd.replace(/^\/Users\/[^/]+/, '~');
  listEl.innerHTML = '<div class="pr-empty">asking gh.</div>';
  if (S.prs.cwd) send({ t: 'prs', cwd: S.prs.cwd });
  else listEl.innerHTML = '<div class="pr-empty">no active session to read a repo from</div>';
}

export function keys(name) {
  const n = S.prs.list.length;
  switch (name) {
    case 'dpad_up': if (n) { S.prs.sel = Math.max(0, S.prs.sel - 1); S.prs.holding = 0; render(); rumble('tick'); } break;
    case 'dpad_down': if (n) { S.prs.sel = Math.min(n - 1, S.prs.sel + 1); S.prs.holding = 0; render(); rumble('tick'); } break;
    case 'south': {
      const pr = S.prs.list[S.prs.sel];
      if (pr) send({ t: 'pr_checkout', cwd: S.prs.cwd, number: pr.number });
      break;
    }
    case 'north': {
      // a pad press carries no browser user activation, so let the os open it
      const pr = S.prs.list[S.prs.sel];
      if (pr && pr.url) { send({ t: 'open_url', url: pr.url }); rumble('tick'); }
      break;
    }
    case 'r1': open(); rumble('tick'); break;
  }
}

// analog squeeze: fill the ring with the right trigger, merge at full
export function pressure(v, dt) {
  const pr = S.prs.list[S.prs.sel];
  if (!pr || merging) return;
  if (v > 0.12) {
    S.prs.holding = Math.min(1, S.prs.holding + v * dt / 1.1);
    const now = performance.now();
    if (now - lastRamp > 90) { lastRamp = now; rumble('ramp:' + S.prs.holding.toFixed(2)); }
    if (S.prs.holding >= 1) {
      merging = true;
      send({ t: 'pr_merge', cwd: S.prs.cwd, number: pr.number });
    }
    paintRing();
  } else if (S.prs.holding > 0) {
    S.prs.holding = Math.max(0, S.prs.holding - dt * 1.6);
    if (S.prs.holding === 0) rumble('still');
    paintRing();
  }
}

function paintRing() {
  const sel = listEl.querySelector('.pr-card.sel .merge-ring');
  if (sel) sel.style.setProperty('--p', S.prs.holding.toFixed(3));
}

function render() {
  const rows = S.prs.list;
  if (S.prs.error) {
    listEl.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'pr-empty';
    d.textContent = S.prs.error;
    listEl.appendChild(d);
    return;
  }
  if (!rows.length) {
    listEl.innerHTML = '<div class="pr-empty">no open prs. go make some agents work.</div>';
    return;
  }
  listEl.innerHTML = '';
  rows.forEach((pr, i) => {
    const d = document.createElement('div');
    d.className = 'pr-card' + (i === S.prs.sel ? ' sel' : '');
    const checks = pr.checks || {};
    const checksChip = checks.fail ? `<span class="pr-chip bad">✗ ${checks.fail}</span>`
      : checks.pending ? `<span class="pr-chip wait">● ${checks.pending}</span>`
      : checks.pass ? `<span class="pr-chip ok">✓ ${checks.pass}</span>` : '';
    d.innerHTML = `
      <div class="merge-ring" style="--p:0"></div>
      <div class="pr-num">#${pr.number} · ${esc(pr.author)}${pr.draft ? ' · draft' : ''}</div>
      <div class="pr-title">${esc(pr.title)}</div>
      <div class="pr-meta">
        <span class="pr-chip">${esc(pr.head)} → ${esc(pr.base)}</span>
        ${checksChip}
        ${pr.review ? `<span class="pr-chip ${pr.review === 'APPROVED' ? 'ok' : 'wait'}">${pr.review.toLowerCase().replace(/_/g, ' ')}</span>` : ''}
        <span class="pr-adds">+${pr.additions}</span><span class="pr-dels">-${pr.deletions}</span>
      </div>`;
    d.addEventListener('click', () => { S.prs.sel = i; render(); });
    listEl.appendChild(d);
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

on('ws:prs', (m) => {
  S.prs.list = m.prs || [];
  S.prs.error = m.error || '';
  S.prs.sel = 0;
  render();
});

on('ws:pr_merged', () => {
  merging = false;
  S.prs.holding = 0;
  rumble('still');
  if (S.mode === 'prs') open();
});

on('mode', ({ mode }) => { if (mode === 'prs') open(); });
