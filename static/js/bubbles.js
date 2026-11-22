/* Lynks 404 — прихована гра з мильними бульбашками.
   • бульбашки спливають на фоні; клік / тап — лопнути
   • «4», «0», «4» живуть у великих бульбашках — лопніть усі три
   • рідкісна золота бульбашка = +5
   • затисніть на порожньому місці — видуєте власну бульбашку (не передуйте!)
   • рух курсора створює вітерець; швидкі серії дають комбо до ×5 */
(() => {
  const section = document.querySelector('[data-nf]');
  const canvas = document.querySelector('[data-bubbles]');
  if (!section || !canvas) return;

  const ctx = canvas.getContext('2d');
  const stage = section.querySelector('[data-nf-stage]');
  const hud = section.querySelector('[data-hud]');
  const scoreEl = section.querySelector('[data-score]');
  const bestEl = section.querySelector('[data-best]');
  const comboEl = section.querySelector('[data-combo]');
  const soundBtn = section.querySelector('[data-sound]');
  const psst = section.querySelector('[data-psst]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватний режим */ } },
  };

  let W = 0, H = 0, dpr = 1, running = false, visible = true, last = performance.now(), t = 0;
  let bubbles = [], parts = [], texts = [], digits = [];
  let score = 0, best = +store.get('lynks_bubbles_best', 0), combo = 1, lastPop = 0, poppedAny = false;
  let blowing = null, pointer = { x: -999, y: -999, vx: 0, vy: 0 }, won = false;
  let colors = {};
  bestEl.textContent = best;

  /* ---------- кольори з поточної теми ---------- */
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const hex = (v, f) => (cs.getPropertyValue(v).trim() || f);
    colors = {
      brand: hex('--brand-500', '#14b8a6'),
      brandDeep: hex('--brand-600', '#0f766e'),
      lime: hex('--lime-500', '#a3e635'),
      dark: document.documentElement.classList.contains('dark'),
    };
  }
  readColors();
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

  /* ---------- звук (синтезований, без файлів) ---------- */
  let audio = null, muted = store.get('lynks_bubbles_muted', '0') === '1';
  const syncSoundBtn = () => { soundBtn.textContent = muted ? '🔇' : '🔊'; soundBtn.setAttribute('aria-pressed', String(!muted)); };
  syncSoundBtn();
  soundBtn.addEventListener('click', () => { muted = !muted; store.set('lynks_bubbles_muted', muted ? '1' : '0'); syncSoundBtn(); });

  function popSound(r, gold) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const now = audio.currentTime;
      const freq = Math.max(260, 1500 - r * 10) * (gold ? 1.5 : 1);
      // «чпок»: короткий шум крізь смуговий фільтр + тональний блік
      const len = 0.06;
      const buf = audio.createBuffer(1, audio.sampleRate * len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const noise = audio.createBufferSource(); noise.buffer = buf;
      const bp = audio.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 2; bp.Q.value = 1.2;
      const g1 = audio.createGain(); g1.gain.value = 0.35;
      noise.connect(bp).connect(g1).connect(audio.destination); noise.start(now);
      const osc = audio.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now); osc.frequency.exponentialRampToValueAtTime(freq * 2.2, now + 0.07);
      const g2 = audio.createGain(); g2.gain.setValueAtTime(0.12, now); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      osc.connect(g2).connect(audio.destination); osc.start(now); osc.stop(now + 0.1);
      if (gold) { // дзвіночок
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 1760; g.gain.setValueAtTime(0.08, now + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
        o.connect(g).connect(audio.destination); o.start(now + 0.05); o.stop(now + 0.5);
      }
    } catch { /* звук необов'язковий */ }
  }

  /* ---------- розміри ---------- */
  function resize() {
    const r = section.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    placeDigits();
  }

  function stageBox() {
    const s = stage.getBoundingClientRect(), r = section.getBoundingClientRect();
    return { x: s.left - r.left, y: s.top - r.top, w: s.width, h: s.height };
  }

  /* ---------- бульбашки ---------- */
  function makeBubble(opts = {}) {
    const r = opts.r ?? rand(10, 46);
    return {
      x: opts.x ?? rand(r, W - r), y: opts.y ?? H + r + rand(0, 80), r,
      vx: opts.vx ?? 0, vy: opts.vy ?? -rand(16, 42) * (reduce ? 0.35 : 1),
      phase: rand(0, Math.PI * 2), wob: rand(1.5, 3), drift: rand(8, 22), hue: rand(0, 360),
      kind: opts.kind ?? (Math.random() < 0.045 ? 'gold' : 'normal'), born: t, grow: opts.grow ?? 0,
    };
  }

  function targetCount() { return Math.round(Math.min(24, Math.max(8, (W * H) / 30000))); }

  function placeDigits(fresh = false) {
    const s = stageBox();
    const r = Math.max(36, Math.min(s.w / 6.4, s.h / 2.4, 112));
    const cx = s.x + s.w / 2, cy = s.y + s.h * 0.45;
    const gap = r * 2.05;
    const spots = [{ x: cx - gap, y: cy + r * 0.25 }, { x: cx, y: cy - r * 0.2 }, { x: cx + gap, y: cy + r * 0.25 }];
    if (!digits.length || fresh) {
      digits = ['4', '0', '4'].map((ch, i) => ({
        ...makeBubble({ r, x: spots[i].x, y: spots[i].y, kind: 'digit', vy: 0, grow: fresh ? 0.001 : 1 }),
        ch, home: spots[i], seed: i * 1.7,
      }));
    } else {
      digits.forEach((d, i) => { d.home = spots[i]; d.r = r; });
    }
  }

  /* ---------- малювання ---------- */
  function hexToRgb(h) {
    const m = h.replace('#', '').match(/.{2}/g);
    return m ? m.map((x) => parseInt(x, 16)).join(',') : '20,184,166';
  }

  function drawBubble(b) {
    const k = b.grow < 1 ? easeOut(b.grow) : 1;
    const r = b.r * k;
    if (r < 1) return;
    const wob = Math.sin(t * b.wob + b.phase) * 0.035;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(1 + wob, 1 - wob);

    const brand = hexToRgb(colors.brand), lime = hexToRgb(colors.lime);
    const gold = b.kind === 'gold';
    const rimA = gold ? '255,196,0' : brand, rimB = gold ? '255,240,150' : lime;

    // тіло
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0.04)');
    g.addColorStop(0.72, `rgba(${rimA},${gold ? 0.1 : 0.05})`);
    g.addColorStop(0.93, `rgba(${rimA},${gold ? 0.35 : 0.2})`);
    g.addColorStop(1, `rgba(${rimB},${gold ? 0.7 : 0.45})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // переливчастий обідок
    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(t * 0.6 + b.phase, 0, 0);
      const base = gold ? 45 : b.hue;
      const sat = gold ? 95 : 85;
      [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((s, i) => cg.addColorStop(s, `hsla(${base + i * (gold ? 8 : 60)},${sat}%,${colors.dark ? 65 : 60}%,${gold ? 0.9 : 0.5})`));
      ctx.strokeStyle = cg;
    } else {
      ctx.strokeStyle = `rgba(${rimA},.5)`;
    }
    ctx.lineWidth = Math.max(1.2, r * (gold ? 0.07 : 0.045));
    ctx.beginPath(); ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();

    // цифра всередині
    if (b.kind === 'digit') {
      ctx.font = `700 ${r * 1.2}px Unbounded, Manrope, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tg = ctx.createLinearGradient(-r * 0.5, -r * 0.6, r * 0.5, r * 0.6);
      tg.addColorStop(0, colors.brandDeep); tg.addColorStop(0.5, colors.brand); tg.addColorStop(1, colors.lime);
      ctx.fillStyle = tg; ctx.globalAlpha = 0.92;
      ctx.fillText(b.ch, 0, r * 0.08);
      ctx.globalAlpha = 1;
    }
    if (gold) {
      ctx.font = `${r * 0.8}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.9; ctx.fillText('✨', 0, r * 0.05); ctx.globalAlpha = 1;
    }

    // відблиски
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.beginPath(); ctx.ellipse(-r * 0.4, -r * 0.42, r * 0.24, r * 0.11, -0.75, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath(); ctx.arc(r * 0.38, r * 0.42, r * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, x), 3);

  /* ---------- лопання ---------- */
  function pop(b, viaUser = true) {
    const gold = b.kind === 'gold', isDigit = b.kind === 'digit';
    // кільце + краплі
    parts.push({ type: 'ring', x: b.x, y: b.y, r: b.r, life: 1, gold });
    const n = Math.round(8 + b.r / 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), sp = rand(60, 160) + b.r;
      parts.push({ type: 'drop', x: b.x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 1, size: rand(1.5, 3.5), gold });
    }
    if (isDigit) parts.push({ type: 'digit', ch: b.ch, x: b.x, y: b.y, vx: rand(-60, 60), vy: -120, rot: 0, vr: rand(-4, 4), size: b.r * 1.2, life: 1, bounced: 0 });
    popSound(b.r, gold);
    if (!viaUser) return;

    const now = performance.now();
    combo = now - lastPop < 650 ? Math.min(5, combo + 1) : 1;
    lastPop = now;
    const pts = (gold ? 5 : isDigit ? 3 : 1) * combo;
    score += pts;
    texts.push({ x: b.x, y: b.y - b.r * 0.3, text: `+${pts}`, life: 1, gold: gold || combo > 2 });
    scoreEl.textContent = score;
    scoreEl.parentElement.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.parentElement.classList.add('bump');
    comboEl.textContent = combo > 1 ? `×${combo}` : '';
    if (score > best) { best = score; bestEl.textContent = best; store.set('lynks_bubbles_best', best); }
    if (!poppedAny) { poppedAny = true; hud.hidden = false; psst.classList.remove('is-on'); }
    if (isDigit && digits.every((d) => d.popped)) win();
  }

  function win() {
    if (won) return;
    won = true;
    section.classList.add('is-won');
    document.querySelector('[data-nf-title]').innerHTML = 'Ви лопнули <em>помилку 404</em> 🎉';
    document.querySelector('[data-nf-lead]').textContent = 'Сторінки все одно немає, зате рекорд — ваш. Цифри скоро надуються знову, а поки — гляньте каталог.';
    const s = stageBox();
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(40, 160);
      bubbles.push(makeBubble({ x: s.x + s.w / 2, y: s.y + s.h * 0.45, r: rand(6, 20), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, grow: 0.001 }));
    }
    if (typeof window.lynksToast === 'function') {
      window.lynksToast({ title: 'Бульбашковий майстер 🫧', text: `Ваш рахунок: ${score}. Рекорд: ${best}`, link: { href: '/catalog', label: 'Каталог →' } });
    }
    setTimeout(() => { won = false; section.classList.remove('is-won'); placeDigits(true); }, 9000);
  }

  /* ---------- оновлення кадру ---------- */
  function update(dt) {
    t += dt;
    // нові фонові бульбашки
    const normal = bubbles.length;
    if (normal < targetCount() && Math.random() < dt * 2.2) bubbles.push(makeBubble());

    const wind = !reduce;
    const all = bubbles.concat(digits.filter((d) => !d.popped));
    for (const b of all) {
      if (b.grow < 1) b.grow = Math.min(1, b.grow + dt * (b.kind === 'digit' ? 0.9 : 3));
      if (wind) {
        const dx = b.x - pointer.x, dy = b.y - pointer.y, dist = Math.hypot(dx, dy);
        const reach = 110 + b.r;
        if (dist < reach && dist > 0.1) {
          const f = (1 - dist / reach) * (b.kind === 'digit' ? 0.25 : 1);
          b.vx += (dx / dist) * f * 90 * dt + pointer.vx * f * 0.9 * dt;
          b.vy += (dy / dist) * f * 90 * dt + pointer.vy * f * 0.9 * dt;
        }
      }
      if (b.kind === 'digit') {
        // пружинимо до свого місця й погойдуємось
        const hx = b.home.x + Math.sin(t * 0.8 + b.seed) * 8, hy = b.home.y + Math.cos(t * 1.1 + b.seed) * 10;
        b.vx += (hx - b.x) * 3 * dt; b.vy += (hy - b.y) * 3 * dt;
        b.vx *= 1 - 2.2 * dt; b.vy *= 1 - 2.2 * dt;
      } else {
        b.vx += Math.sin(t * 0.7 + b.phase) * b.drift * dt;
        b.vx *= 1 - 0.9 * dt;
        b.vy += (-rand(16, 40) * (reduce ? 0.35 : 1) - b.vy) * 0.6 * dt; // повертаємось до спливання
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    bubbles = bubbles.filter((b) => b.y > -b.r - 40 && b.x > -120 && b.x < W + 120);

    // видування власної бульбашки
    if (blowing) {
      blowing.r = Math.min(90, blowing.r + dt * 40);
      blowing.x = pointer.x; blowing.y = pointer.y;
      if (performance.now() - blowing.start > 2600) { // передули!
        const b = blowing; blowing = null;
        pop(b, false);
        texts.push({ x: b.x, y: b.y, text: 'передули 😅', life: 1.2 });
      }
    }

    // частинки
    for (const p of parts) {
      if (p.type === 'ring') { p.r += dt * 120; p.life -= dt * 3.2; }
      else if (p.type === 'drop') { p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 1.5 * dt; p.life -= dt * 1.6; }
      else if (p.type === 'digit') {
        p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const floor = H - p.size * 0.5;
        if (p.y > floor && p.bounced < 2) { p.y = floor; p.vy *= -0.45; p.vx *= 0.7; p.vr *= 0.6; p.bounced++; }
        if (p.bounced >= 2) p.life -= dt * 0.8;
      }
    }
    parts = parts.filter((p) => p.life > 0 && p.y < H + 200);
    for (const tx of texts) { tx.y -= 40 * dt; tx.life -= dt * 1.1; }
    texts = texts.filter((x) => x.life > 0);
    pointer.vx *= 0.85; pointer.vy *= 0.85;
    if (performance.now() - lastPop > 1200 && combo > 1) { combo = 1; comboEl.textContent = ''; }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    for (const b of bubbles) drawBubble(b);
    for (const d of digits) if (!d.popped) drawBubble(d);
    if (blowing) drawBubble(blowing);

    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.type === 'ring') {
        ctx.strokeStyle = p.gold ? 'rgba(255,200,40,.9)' : `rgba(${hexToRgb(colors.brand)},.7)`;
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.type === 'drop') {
        ctx.fillStyle = p.gold ? '#fbbf24' : (colors.dark ? 'rgba(255,255,255,.85)' : colors.brand);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'digit') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.font = `700 ${p.size}px Unbounded, Manrope, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tg = ctx.createLinearGradient(0, -p.size / 2, 0, p.size / 2);
        tg.addColorStop(0, colors.brand); tg.addColorStop(1, colors.lime);
        ctx.fillStyle = tg; ctx.fillText(p.ch, 0, 0); ctx.restore();
      }
    }
    for (const tx of texts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, tx.life));
      ctx.font = '700 16px Unbounded, Manrope, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = tx.gold ? '#f59e0b' : (colors.dark ? '#fff' : colors.brandDeep);
      ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt); render();
    requestAnimationFrame(loop);
  }
  function start() { if (running || !visible || document.hidden) return; running = true; last = performance.now(); requestAnimationFrame(loop); }
  function stop() { running = false; }

  /* ---------- керування ---------- */
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function hit(p) {
    const list = digits.filter((d) => !d.popped && d.grow >= 1).concat(bubbles.slice().reverse());
    return list.find((b) => Math.hypot(b.x - p.x, b.y - p.y) < Math.max(b.r * 1.05, 20));
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    pointer.x = p.x; pointer.y = p.y;
    const b = hit(p);
    if (b) {
      if (b.kind === 'digit') b.popped = true; else bubbles.splice(bubbles.indexOf(b), 1);
      pop(b);
      return;
    }
    // почати видувати бульбашку
    blowing = { ...makeBubble({ x: p.x, y: p.y, r: 6, vy: 0, kind: 'normal', grow: 1 }), start: performance.now() };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointer.x > -900) { pointer.vx = (p.x - pointer.x) * 30; pointer.vy = (p.y - pointer.y) * 30; }
    pointer.x = p.x; pointer.y = p.y;
    if (e.pointerType === 'mouse') canvas.style.cursor = hit(p) ? 'pointer' : 'default';
  });
  const release = () => {
    if (!blowing) return;
    const b = blowing; blowing = null;
    if (b.r > 12) { b.vy = -20; b.vx = pointer.vx * 0.05; b.grow = 1; bubbles.push(b); texts.push({ x: b.x, y: b.y - b.r - 8, text: b.r > 60 ? 'ого! 😮' : '🫧', life: 0.9 }); }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { blowing = null; });
  canvas.addEventListener('pointerleave', () => { pointer.x = -999; pointer.y = -999; });

  /* ---------- старт ---------- */
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; visible ? start() : stop(); });
  io.observe(section);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 150); });
  (document.fonts?.ready || Promise.resolve()).then(() => {
    resize();
    for (let i = 0; i < targetCount(); i++) bubbles.push(makeBubble({ y: rand(0, H) }));
    start();
  });
  // ненав'язлива підказка, якщо гравець ще нічого не знайшов
  setTimeout(() => { if (!poppedAny) psst.classList.add('is-on'); }, 7000);
})();
