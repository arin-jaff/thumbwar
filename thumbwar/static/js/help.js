// the controller map: a live diagram. buttons light up as you press
// them, the stick caps follow your thumbs, the paddle labels show your
// actual quick slots. the fastest way to learn the mappings is to mash.

import { S, on } from './state.js';
import { axes } from './input.js';
import { setMode } from './modes.js';

document.getElementById('help').addEventListener('click', () => setMode('deck'));

const mapEl = document.getElementById('help-map');
const kbdEl = document.getElementById('help-kbd');

// one callout: optional leader line plus one or more label lines
function callout(x, y, anchor, rows, to) {
  let s = '';
  if (to) {
    const sx = anchor === 'end' ? x + 6 : x - 6;
    s += `<path class="map-line" d="M ${sx} ${y - 4} L ${to[0]} ${to[1]}"/>`;
  }
  rows.forEach((r, i) => {
    s += `<text class="map-label" x="${x}" y="${y + i * 17}" text-anchor="${anchor}">${r}</text>`;
  });
  return s;
}

function chip(letter, color) {
  return `<tspan fill="${color}" font-weight="800">${letter}</tspan>`;
}

function render() {
  const q = S.settings.quick_slots || {};

  mapEl.innerHTML = `<svg viewBox="0 0 860 396" aria-label="controller map">
    <!-- triggers and bumpers -->
    <rect id="mk-l2" class="mk" x="300" y="66" width="52" height="12" rx="6"/>
    <rect id="mk-l1" class="mk" x="295" y="83" width="62" height="11" rx="5.5"/>
    <rect id="mk-r2" class="mk" x="508" y="66" width="52" height="12" rx="6"/>
    <rect id="mk-r1" class="mk" x="503" y="83" width="62" height="11" rx="5.5"/>

    <!-- body -->
    <rect class="map-body" x="255" y="98" width="350" height="192" rx="86"/>

    <!-- left stick -->
    <circle class="map-ring" cx="330" cy="160" r="27"/>
    <g id="mk-lcap-g"><circle id="mk-l3" class="mk" cx="330" cy="160" r="17"/></g>

    <!-- right stick -->
    <circle class="map-ring" cx="465" cy="235" r="27"/>
    <g id="mk-rcap-g"><circle id="mk-r3" class="mk" cx="465" cy="235" r="17"/></g>

    <!-- dpad -->
    <rect class="mk" x="384" y="209" width="22" height="54" rx="6"/>
    <rect class="mk" x="368" y="225" width="54" height="22" rx="6"/>
    <rect id="mk-dpad_up" class="mk-arm" x="384" y="209" width="22" height="20" rx="6"/>
    <rect id="mk-dpad_down" class="mk-arm" x="384" y="243" width="22" height="20" rx="6"/>
    <rect id="mk-dpad_left" class="mk-arm" x="368" y="225" width="20" height="22" rx="6"/>
    <rect id="mk-dpad_right" class="mk-arm" x="402" y="225" width="20" height="22" rx="6"/>

    <!-- a b x y -->
    <circle id="mk-north" class="mk" cx="530" cy="130" r="15"/>
    <circle id="mk-west" class="mk" cx="500" cy="160" r="15"/>
    <circle id="mk-east" class="mk" cx="560" cy="160" r="15"/>
    <circle id="mk-south" class="mk" cx="530" cy="190" r="15"/>
    <text class="map-key" x="530" y="130">y</text>
    <text class="map-key" x="500" y="160">x</text>
    <text class="map-key" x="560" y="160">b</text>
    <text class="map-key" x="530" y="190">a</text>

    <!-- center cluster -->
    <circle id="mk-select" class="mk" cx="404" cy="128" r="8"/>
    <circle id="mk-start" class="mk" cx="456" cy="128" r="8"/>
    <circle id="mk-guide" class="mk" cx="430" cy="158" r="12"/>
    <circle id="mk-share" class="mk" cx="430" cy="188" r="6.5"/>

    <!-- back paddles -->
    <rect id="mk-l4" class="mk back" x="286" y="298" width="42" height="13" rx="6.5"/>
    <rect id="mk-pl" class="mk back" x="286" y="316" width="42" height="13" rx="6.5"/>
    <rect id="mk-r4" class="mk back" x="532" y="298" width="42" height="13" rx="6.5"/>
    <rect id="mk-pr" class="mk back" x="532" y="316" width="42" height="13" rx="6.5"/>

    ${callout(240, 64, 'end', ['l2 · turbo scroll'], [300, 72])}
    ${callout(240, 92, 'end', ['l1 · reject the hunk'], [295, 88])}
    ${callout(240, 152, 'end', ['scroll · flick flips cards', 'drives every menu', 'l3 hold · push to talk'], [303, 160])}
    ${callout(240, 240, 'end', ['cards · roll the wheel', 'arrows while typing'], [368, 236])}
    ${callout(240, 305, 'end', [`l4 · ${esc(q.l4 || '—')}`, `pl · ${esc(q.pl || '—')}`], [286, 308])}

    ${callout(620, 64, 'start', ['r2 · squeeze to merge'], [560, 72])}
    ${callout(620, 92, 'start', ['r1 · accept the hunk'], [565, 88])}
    ${callout(620, 128, 'start', [
      `${chip('y', 'var(--marigold)')} expand output`,
      `${chip('x', 'var(--sky)')} the command wheel`,
      `${chip('b', 'var(--orange)')} back · hold interrupts`,
      `${chip('a', 'var(--mint-deep)')} type · send enter`,
    ], [578, 148])}
    ${callout(620, 232, 'start', ['flip cards · up zoom · down grid', 'points the wheel', 'r3 · jump to needs you · recenter'], [494, 232])}
    ${callout(620, 305, 'start', [`r4 · ${esc(q.r4 || '—')}`, `pr · ${esc(q.pr || '—')}`], [574, 308])}

    <text class="map-label dim" x="430" y="352" text-anchor="middle">select · settings&#160;&#160;&#160;start · new agent&#160;&#160;&#160;share · away&#160;&#160;&#160;guide · this map</text>
    <text class="map-label dim" x="430" y="374" text-anchor="middle">paddles are the dashed backs · set them in settings</text>
  </svg>`;

  const KBD = [
    ['←↑↓→', 'move'], ['enter', 'type'], ['esc', 'back'], ['n', 'new'],
    [',', 'settings'], ['a', 'away'], ['?', 'this map'], ['1-9', 'jump'],
    ['w', 'wheel'], ['z', 'zoom'], ['g', 'grid'], ['[ ]', 'flip'], ['ctrl `', 'leave typing'],
  ];
  kbdEl.innerHTML = KBD.map(([k, v]) =>
    `<span class="hint"><span class="btn-chip">${k}</span> ${v}</span>`).join('');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// -- live ---------------------------------------------------------------

on('btn', ({ name, down }) => {
  if (S.mode !== 'help') return;
  const el = document.getElementById('mk-' + name);
  if (el) el.classList.toggle('lit', down);
});

function live() {
  if (S.mode === 'help') {
    const l = document.getElementById('mk-lcap-g');
    const r = document.getElementById('mk-rcap-g');
    if (l) l.setAttribute('transform', `translate(${(axes.lx * 8).toFixed(1)} ${(-axes.ly * 8).toFixed(1)})`);
    if (r) r.setAttribute('transform', `translate(${(axes.rx * 8).toFixed(1)} ${(-axes.ry * 8).toFixed(1)})`);
    const l2 = document.getElementById('mk-l2');
    const r2 = document.getElementById('mk-r2');
    if (l2) l2.classList.toggle('lit', axes.l2 > 0.1);
    if (r2) r2.classList.toggle('lit', axes.r2 > 0.1);
  }
  requestAnimationFrame(live);
}
requestAnimationFrame(live);

on('mode', ({ mode }) => { if (mode === 'help') render(); });
on('ws:hello', render);
