// confetti, because your agents finished and that deserves pageantry.

const COLORS = ['#3fd99f', '#f0824f', '#f5c15c', '#6fb7ff', '#d9a0ff'];

export function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = innerWidth;
  c.height = innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const ps = Array.from({ length: 90 }, () => ({
    x: c.width / 2 + (Math.random() - 0.5) * 160,
    y: c.height * 0.28,
    vx: (Math.random() - 0.5) * 900,
    vy: -Math.random() * 700 - 220,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 14,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  let last = performance.now();
  const t0 = last;
  (function frame(now) {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of ps) {
      p.vy += 1500 * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.a += p.va * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (now - t0 < 1900) requestAnimationFrame(frame);
    else c.remove();
  })(last);
}
