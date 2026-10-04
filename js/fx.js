/* Sparse gold dust rises slowly from the stage floor. Motion is time based,
   bounded to the bottom third, and suspended while the board is hidden. */
(function () {
  'use strict';
  const canvas = document.getElementById('fx-canvas');
  const main = document.getElementById('main-screen');
  const ctx = canvas?.getContext('2d', {alpha: true});
  if (!ctx || !main) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0, particles = [], running = false, raf = null, last = 0;
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 32;
  const g = sprite.getContext('2d');
  const glow = g.createRadialGradient(16,16,0,16,16,16);
  glow.addColorStop(0,'rgba(255,232,177,.8)');
  glow.addColorStop(.18,'rgba(235,196,110,.35)');
  glow.addColorStop(1,'rgba(235,196,110,0)');
  g.fillStyle = glow; g.fillRect(0,0,32,32);
  const active = () => main.classList.contains('active') && !document.hidden && !motion.matches;
  const particle = () => ({x: Math.random()*W,y: H*(.72+Math.random()*.28),
    vx: (Math.random()-.5)*.6,vy: .5+Math.random()*1.4,r: .5+Math.random()*.65,
    alpha: .12+Math.random()*.28,phase: Math.random()*Math.PI*2});
  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1,2);
    canvas.width = Math.round(W*dpr); canvas.height = Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    particles = Array.from({length: Math.max(20,Math.min(48,Math.round(W*H/32000)))},particle);
  }
  function frame(now) {
    const dt = Math.min(.05,Math.max(0,(now-last)/1000)); last = now;
    ctx.clearRect(0,0,W,H); ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      p.x += p.vx*dt; p.y -= p.vy*dt;
      if (p.y < H*.65) { p.y = H+4; p.x = Math.random()*W; }
      const fade = Math.min(1,Math.max(0,(p.y/H-.65)/.1));
      ctx.globalAlpha = p.alpha*fade*(.75+.25*Math.sin(now/2100+p.phase));
      ctx.drawImage(sprite,p.x-4,p.y-4,8,8);
      ctx.fillStyle = '#e7ca8c'; ctx.fillRect(p.x,p.y,p.r,p.r);
    }
    ctx.globalAlpha = 1; raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (active()) {
      if (running) return;
      resize(); running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    } else {
      running = false;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null; ctx.clearRect(0,0,W,H);
    }
  }
  addEventListener('resize',resize);
  document.addEventListener('visibilitychange',sync);
  motion.addEventListener('change',sync);
  new MutationObserver(sync).observe(main,{attributes:true,attributeFilter:['class']});
  sync();
  window.__fx = {get running() {return running;},get count() {return particles.length;},get size() {return [W,H];}};
})();
