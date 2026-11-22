/* Lynks — інтерактив сайту (без залежностей) */
document.documentElement.classList.remove('no-js');

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------------------------------------------------------- API */
async function api(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || 'Помилка сервера');
  return data;
}

function setCartCount(n) {
  $$('[data-cart-count]').forEach((el) => {
    el.textContent = n;
    el.hidden = !n;
  });
  const btn = $('.cart-btn');
  if (btn) {
    btn.classList.remove('bump');
    void btn.offsetWidth; // restart animation
    btn.classList.add('bump');
  }
}

/* ---------------------------------------------------------------- toasts */
function toast({ title, text = '', img, link, error = false }) {
  const wrap = $('.toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' toast--error' : '');
  if (img) {
    const i = document.createElement('img');
    i.src = img; i.alt = '';
    el.append(i);
  }
  const box = document.createElement('div');
  const b = document.createElement('b'); b.textContent = title;
  const s = document.createElement('span'); s.textContent = text;
  box.append(b, s);
  el.append(box);
  if (link) {
    const a = document.createElement('a');
    a.href = link.href; a.textContent = link.label;
    el.append(a);
  }
  wrap.append(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3200);
}

/* ---------------------------------------------------------------- fly to cart */
function flyToCart(img) {
  const target = $('.cart-btn');
  if (!img || !target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = img.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const fly = document.createElement('img');
  fly.src = img.currentSrc || img.src;
  fly.className = 'fly';
  fly.style.left = `${a.left + a.width / 2 - 32}px`;
  fly.style.top = `${a.top + a.height / 2 - 32}px`;
  document.body.append(fly);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  fly.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.6}px, ${dy - 80}px) scale(.8)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0.2 },
    ],
    { duration: 750, easing: 'cubic-bezier(.5,0,.2,1)' }
  ).onfinish = () => fly.remove();
}

/* ---------------------------------------------------------------- add to cart */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn || btn.disabled) return;
  e.preventDefault();

  const id = btn.dataset.add;
  const qtyInput = btn.hasAttribute('data-add-qty') ? $('[data-qty]') : null;
  const qty = qtyInput ? Math.max(1, Math.min(99, parseInt(qtyInput.value, 10) || 1)) : 1;
  const scope = btn.closest('.card, .pdp');
  const img = scope && $('img', scope);
  const name = scope && ($('.card__title, .pdp__title', scope)?.textContent.trim() || '');

  btn.disabled = true;
  try {
    const data = await api('/api/cart/add', { product_id: id, qty });
    flyToCart(img);
    setTimeout(() => setCartCount(data.total_items), 600);
    btn.classList.add('is-added');
    const label = $('span', btn);
    const prev = label?.textContent;
    if (label) label.textContent = 'Додано ✓';
    setTimeout(() => {
      btn.classList.remove('is-added');
      if (label) label.textContent = prev;
    }, 1400);
    toast({
      title: qty > 1 ? `Додано ${qty} шт.` : 'Додано в кошик',
      text: name,
      img: img?.src,
      link: { href: '/cart', label: 'Кошик →' },
    });
  } catch (err) {
    toast({ title: 'Не вдалося додати', text: err.message, error: true });
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------- stepper (product page) */
$$('[data-stepper]').forEach((st) => {
  const input = $('[data-qty]', st);
  st.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    input.value = Math.max(1, Math.min(99, (parseInt(input.value, 10) || 1) + Number(b.dataset.step)));
  });
  input.addEventListener('change', () => {
    input.value = Math.max(1, Math.min(99, parseInt(input.value, 10) || 1));
  });
});

/* ---------------------------------------------------------------- cart page */
const cartEl = $('[data-cart]');
if (cartEl) {
  cartEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cart-action]');
    if (!btn) return;
    const line = btn.closest('[data-line]');
    const action = btn.dataset.cartAction;
    $$('button', line).forEach((b) => (b.disabled = true));
    try {
      const data = await api('/api/cart/update', { product_id: btn.dataset.id, action });
      setCartCount(data.total_items);
      $('[data-cart-total]').textContent = data.total_price_fmt;
      $('[data-cart-count-text]').textContent = data.total_items;
      if (data.quantity > 0) {
        $('[data-line-qty]', line).textContent = data.quantity;
        $('[data-line-sum]', line).textContent = data.subtotal_fmt;
      } else {
        line.classList.add('is-removing');
        setTimeout(() => line.remove(), 350);
      }
      if (data.total_items === 0) {
        setTimeout(() => {
          cartEl.remove();
          $('[data-cart-empty]').hidden = false;
        }, 360);
      }
    } catch (err) {
      toast({ title: 'Помилка', text: err.message, error: true });
    } finally {
      $$('button', line).forEach((b) => (b.disabled = false));
    }
  });

  // проста клієнтська валідація форми
  const form = $('[data-checkout]');
  form?.addEventListener('submit', (e) => {
    let ok = true;
    $$('.field', form).forEach((f) => {
      const input = $('input, textarea', f);
      let msg = '';
      if (input.name === 'name' && input.value.trim().length < 2) msg = "Вкажіть ім'я";
      if (input.name === 'phone' && input.value.replace(/\D/g, '').length < 10) msg = 'Вкажіть коректний номер телефону';
      if (input.name === 'city' && input.value.trim().length < 2) msg = 'Вкажіть місто';
      let small = $('small', f);
      f.classList.toggle('has-error', !!msg);
      if (msg) {
        if (!small) { small = document.createElement('small'); f.append(small); }
        small.textContent = msg;
        if (ok) input.focus();
        ok = false;
      } else small?.remove();
    });
    if (!ok) e.preventDefault();
    else $('button[type=submit]', form).disabled = true;
  });
}

/* ---------------------------------------------------------------- catalog: filter + sort */
const grid = $('[data-grid]');
if (grid) {
  const cards = $$('.card', grid);
  const counter = $('[data-visible-count]');
  const empty = $('[data-empty]');
  let filter = '';

  const apply = () => {
    let visible = 0;
    cards.forEach((c) => {
      const show = !filter || c.dataset.tag === filter;
      c.classList.toggle('is-hidden', !show);
      if (show) visible++;
    });
    if (counter) counter.textContent = visible;
    if (empty) empty.hidden = visible > 0;
  };

  $$('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      $$('[data-filter]').forEach((x) => x.classList.toggle('is-active', x === b));
      filter = b.dataset.filter;
      apply();
    })
  );

  $('[data-sort]')?.addEventListener('change', (e) => {
    const v = e.target.value;
    const sorted = [...cards].sort((a, b) => {
      if (v === 'price-asc') return a.dataset.price - b.dataset.price;
      if (v === 'price-desc') return b.dataset.price - a.dataset.price;
      if (v === 'name') return a.dataset.name.localeCompare(b.dataset.name, 'uk');
      return a.dataset.order - b.dataset.order;
    });
    const run = () => sorted.forEach((c) => grid.append(c));
    document.startViewTransition ? document.startViewTransition(run) : run();
  });
}

/* ---------------------------------------------------------------- header, nav, dropdown */
const header = $('#header');
const onScroll = () => header?.classList.toggle('is-scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

const nav = $('#nav');
const burger = $('.burger');
burger?.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  burger.setAttribute('aria-expanded', open);
  document.body.style.overflow = open ? 'hidden' : '';
});

const drop = $('.nav__drop');
if (drop) {
  const toggle = $('.nav__toggle', drop);
  const setOpen = (v) => { drop.classList.toggle('is-open', v); toggle.setAttribute('aria-expanded', v); };
  let t;
  const hoverable = matchMedia('(hover: hover) and (min-width: 901px)');
  drop.addEventListener('mouseenter', () => { if (hoverable.matches) { clearTimeout(t); setOpen(true); } });
  drop.addEventListener('mouseleave', () => { if (hoverable.matches) t = setTimeout(() => setOpen(false), 220); });
  toggle.addEventListener('click', () => setOpen(!drop.classList.contains('is-open')));
  document.addEventListener('click', (e) => { if (!drop.contains(e.target) && hoverable.matches) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

/* ---------------------------------------------------------------- reveal on scroll */
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
  : null;
$$('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('is-visible')));

/* ---------------------------------------------------------------- image fallback */
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || img.dataset.fallback) return;
  const id = img.closest('[data-id]')?.dataset.id;
  if (id) { img.dataset.fallback = '1'; img.src = `/placeholder/${id}.svg`; }
}, true);

/* ---------------------------------------------------------------- 404: протри екран губкою */
const wipe = $('[data-wipe]');
if (wipe) {
  const canvas = $('[data-wipe-canvas]', wipe);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const sponge = $('[data-sponge]', wipe);
  const nf = $('[data-nf]');
  const percentEl = $('[data-nf-percent]');
  const barEl = $('[data-nf-bar]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GOAL = 0.72; // скільки треба протерти, щоб «заблищало»
  let w = 0, h = 0, dpr = 1, last = null, down = false, done = false, checkT = 0, lastFoam = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function paintGrime() {
    const r = wipe.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    // базовий шар бруду
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#9c8463'); g.addColorStop(.5, '#7d6a4f'); g.addColorStop(1, '#a08a66');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // плями
    const stains = ['rgba(92,70,40,.55)', 'rgba(130,110,70,.5)', 'rgba(70,82,52,.45)', 'rgba(160,140,100,.45)', 'rgba(60,45,30,.4)'];
    for (let i = 0; i < 46; i++) {
      const x = rand(0, w), y = rand(0, h), rad = rand(14, Math.max(w, h) * .2);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, stains[i % stains.length]); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    // крапельки та розводи
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${rand(40, 90)|0},${rand(30, 70)|0},${rand(15, 40)|0},${rand(.15, .45)})`;
      ctx.beginPath(); ctx.arc(rand(0, w), rand(0, h), rand(.6, 3.2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = `rgba(55,40,22,${rand(.12, .25)})`; ctx.lineWidth = rand(6, 22);
      ctx.beginPath(); const x = rand(0, w), y = rand(0, h);
      ctx.moveTo(x, y); ctx.bezierCurveTo(x + rand(-120, 120), y + rand(-60, 60), x + rand(-160, 160), y + rand(-80, 80), x + rand(-200, 200), y + rand(-40, 40));
      ctx.stroke();
    }
    // напис пальцем по пилюці
    ctx.save();
    ctx.translate(w / 2, h * .42); ctx.rotate(-.06);
    ctx.font = `700 ${Math.max(22, w * .065)}px Unbounded, Manrope, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillText('ПОМИЙ МЕНЕ', 0, 0);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function scrub(a, b) {
    ctx.globalCompositeOperation = 'destination-out';
    const size = Math.max(34, w * .085);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / (size * .25)));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * (i / steps), y = a.y + (b.y - a.y) * (i / steps);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, size);
      rg.addColorStop(0, 'rgba(0,0,0,.55)'); rg.addColorStop(.6, 'rgba(0,0,0,.25)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function foam(p) {
    const now = performance.now();
    if (reduce || now - lastFoam < 45) return;
    lastFoam = now;
    const b = document.createElement('i');
    const s = rand(8, 22);
    b.className = 'foam';
    b.style.cssText = `left:${p.x + rand(-26, 26) - s / 2}px;top:${p.y + rand(-14, 14) - s / 2}px;width:${s}px;height:${s}px;--fx:${rand(-20, 20)}px;--fy:${rand(-50, -15)}px`;
    wipe.append(b);
    b.addEventListener('animationend', () => b.remove());
  }

  function measure() {
    // рахуємо прозорі пікселі на зменшеній сітці
    const step = 8 * dpr;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = 0, total = 0;
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        total++;
        if (data[((y | 0) * canvas.width + (x | 0)) * 4 + 3] < 90) clear++;
      }
    }
    return clear / total;
  }

  function update() {
    const ratio = measure();
    const pct = Math.min(100, Math.round((ratio / GOAL) * 100));
    percentEl.textContent = pct + '%';
    barEl.style.width = pct + '%';
    if (ratio >= GOAL) finish();
  }

  function finish() {
    if (done) return;
    done = true;
    percentEl.textContent = '100%'; barEl.style.width = '100%';
    wipe.classList.add('is-clean'); nf.classList.add('is-clean');
    $('[data-nf-title]').innerHTML = 'Блищить! Але сторінки <em>тут немає</em>';
    $('[data-nf-lead]').textContent = 'Дякуємо за прибирання 😄 Ця адреса порожня, тож оберіть категорію нижче або скористайтеся пошуком.';
    const auto = $('[data-nf-auto]');
    if (auto) auto.hidden = true;
    if (!reduce) {
      for (let i = 0; i < 18; i++) {
        const s = document.createElement('span');
        s.className = 'sparkle';
        s.textContent = ['✨', '🫧', '✦', '💧'][i % 4];
        s.style.cssText = `left:${rand(15, 85)}%;top:${rand(20, 75)}%;--fx:${rand(-80, 80)}px;--fy:${rand(-90, 30)}px;animation-delay:${rand(0, .35)}s`;
        wipe.append(s);
        s.addEventListener('animationend', () => s.remove());
      }
    }
    toast({ title: 'Ідеальна чистота ✨', text: 'Ви знайшли 404 — але засоби в каталозі справжні', link: { href: '/catalog', label: 'Каталог →' } });
  }

  const moveSponge = (p) => { sponge.style.transform = `translate(${p.x}px, ${p.y}px)`; };

  wipe.addEventListener('pointerdown', (e) => {
    if (done) return;
    down = true; last = pos(e);
    wipe.classList.add('is-active', 'is-touched');
    wipe.setPointerCapture(e.pointerId);
    scrub(last, last); moveSponge(last); foam(last);
  });
  wipe.addEventListener('pointermove', (e) => {
    const p = pos(e);
    moveSponge(p);
    // на десктопі можна мити просто рухом миші
    const scrubbing = down || e.pointerType === 'mouse';
    if (!scrubbing || done) { last = p; return; }
    wipe.classList.add('is-touched');
    scrub(last || p, p); foam(p); last = p;
    clearTimeout(checkT); checkT = setTimeout(update, 120);
  });
  const stop = () => { down = false; wipe.classList.remove('is-active'); if (!done) update(); };
  wipe.addEventListener('pointerup', stop);
  wipe.addEventListener('pointercancel', stop);
  wipe.addEventListener('pointerleave', () => { last = null; });

  // «Протерти за мене» — губка сама робить зигзаги
  $('[data-nf-auto]')?.addEventListener('click', () => {
    if (done) return;
    wipe.classList.add('is-touched', 'is-active');
    if (reduce) { finish(); return; }
    const rows = 7, pts = [];
    for (let r = 0; r <= rows; r++) {
      const y = (h / rows) * r;
      pts.push({ x: r % 2 ? w + 20 : -20, y }, { x: r % 2 ? -20 : w + 20, y: y + h / rows / 2 });
    }
    let i = 0, prev = pts[0];
    const t0 = performance.now(), dur = 1600;
    (function frame(now) {
      const k = Math.min(1, (now - t0) / dur);
      const target = Math.floor(k * (pts.length - 1));
      while (i < target) {
        i++;
        const seg = 12;
        for (let s = 1; s <= seg; s++) {
          const p = { x: prev.x + (pts[i].x - prev.x) * s / seg, y: prev.y + (pts[i].y - prev.y) * s / seg };
          scrub(p, p);
        }
        prev = pts[i]; moveSponge(prev); foam({ x: Math.max(20, Math.min(w - 20, prev.x)), y: prev.y });
      }
      update();
      if (k < 1 && !done) requestAnimationFrame(frame);
      else { wipe.classList.remove('is-active'); finish(); }
    })(t0);
  });

  // малюємо після завантаження шрифтів, щоб напис був фірмовим
  (document.fonts?.ready || Promise.resolve()).then(paintGrime);
  let rt;
  addEventListener('resize', () => {
    if (done || Math.abs(wipe.getBoundingClientRect().width - w) < 2) return; // ігноруємо «стрибки» адресного рядка на мобільних
    clearTimeout(rt); rt = setTimeout(() => { paintGrime(); update(); }, 200);
  });
}

/* ---------------------------------------------------------------- cookie-утиліти */
const Cookie = {
  get(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  },
  set(name, value, days) {
    let c = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
    if (days) c += `; max-age=${days * 86400}`;
    if (location.protocol === 'https:') c += '; Secure';
    document.cookie = c;
  },
};
// налаштування зберігаємо на рік лише за згоди «всі», інакше — до закриття браузера
const prefDays = () => (Cookie.get('lynks_consent') === 'all' ? 365 : 0);

/* ---------------------------------------------------------------- теми */
const root = document.documentElement;
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

function applyMode(mode) {
  root.dataset.mode = mode;
  root.classList.toggle('dark', mode === 'dark' || (mode === 'auto' && darkMQ.matches));
}
darkMQ.addEventListener?.('change', () => { if (root.dataset.mode === 'auto') applyMode('auto'); });

function withTransition(fn, origin) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) {
    root.classList.add('theme-switching');
    fn();
    setTimeout(() => root.classList.remove('theme-switching'), 400);
    return;
  }
  root.classList.add('vt-theme');
  const t = document.startViewTransition(fn);
  t.ready.then(() => {
    const x = origin?.x ?? innerWidth - 60, y = origin?.y ?? 40;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.animate(
      { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' }
    );
  });
  t.finished.finally(() => root.classList.remove('vt-theme'));
}

const picker = $('[data-theme-picker]');
if (picker) {
  const toggle = $('[data-theme-toggle]', picker);
  const setOpen = (v) => { picker.classList.toggle('is-open', v); toggle.setAttribute('aria-expanded', v); };
  toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!picker.classList.contains('is-open')); });
  document.addEventListener('click', (e) => { if (!picker.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  const mark = (sel, attr, val) => $$(sel, picker).forEach((b) => {
    const on = b.dataset[attr] === val;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', on);
  });

  picker.addEventListener('click', (e) => {
    const point = { x: e.clientX, y: e.clientY };
    const m = e.target.closest('[data-mode-set]');
    const t = e.target.closest('[data-theme-set]');
    if (m) {
      const mode = m.dataset.modeSet;
      withTransition(() => applyMode(mode), point);
      Cookie.set('lynks_mode', mode, prefDays());
      mark('[data-mode-set]', 'modeSet', mode);
    }
    if (t) {
      const theme = t.dataset.themeSet;
      withTransition(() => { root.dataset.theme = theme; }, point);
      $('meta[name="theme-color"]')?.setAttribute('content', t.dataset.meta);
      Cookie.set('lynks_theme', theme, prefDays());
      mark('[data-theme-set]', 'themeSet', theme);
    }
  });
}

/* ---------------------------------------------------------------- cookie-банер */
const banner = $('[data-cookie]');
if (banner) {
  const prefsBox = $('[data-cookie-prefs]', banner);
  const prefInput = $('[data-cookie-pref]', banner);

  const open = (custom = false) => {
    banner.hidden = false;
    banner.classList.remove('is-leaving');
    banner.classList.toggle('is-custom', custom);
    prefsBox.hidden = !custom;
    prefInput.checked = Cookie.get('lynks_consent') !== 'necessary';
  };
  const close = () => {
    banner.classList.add('is-leaving');
    banner.addEventListener('animationend', () => { banner.hidden = true; banner.classList.remove('is-leaving'); }, { once: true });
  };

  function save(choice) {
    Cookie.set('lynks_consent', choice, 365);
    // перезаписуємо налаштування теми з потрібним строком життя
    const days = choice === 'all' ? 365 : 0;
    ['lynks_theme', 'lynks_mode'].forEach((n) => {
      const v = Cookie.get(n);
      if (v) Cookie.set(n, v, days);
    });
    const label = $('[data-consent-label]');
    if (label) label.textContent = choice === 'all' ? 'Прийнято всі cookie' : 'Лише необхідні cookie';
    close();
    toast({ title: 'Збережено 🍪', text: choice === 'all' ? 'Тема запам\'ятається на рік' : 'Лише необхідні cookie' });
  }

  $('[data-cookie-customize]', banner).addEventListener('click', () => open(true));
  $$('[data-cookie-save]', banner).forEach((b) => b.addEventListener('click', () => {
    let choice = b.dataset.cookieSave;
    // у режимі налаштування головна кнопка зберігає вибір перемикача
    if (choice === 'all' && banner.classList.contains('is-custom')) choice = prefInput.checked ? 'all' : 'necessary';
    save(choice);
  }));
  $$('[data-cookie-open]').forEach((b) => b.addEventListener('click', () => open(true)));

  // у режимі налаштування підписуємо головну кнопку інакше
  const primary = $('[data-cookie-save="all"]', banner);
  new MutationObserver(() => {
    primary.textContent = banner.classList.contains('is-custom') ? 'Зберегти вибір' : 'Прийняти всі';
  }).observe(banner, { attributes: true, attributeFilter: ['class'] });
}
