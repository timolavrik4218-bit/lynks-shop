"""Lynks — інтернет-магазин миючих засобів (Flask).

Локально:   python app.py           → http://localhost:5000
На Render:  gunicorn app:app        (див. render.yaml)
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime
from html import escape
from pathlib import Path

from flask import (Flask, Response, abort, jsonify, redirect, render_template,
                   request, session, url_for)
from werkzeug.middleware.proxy_fix import ProxyFix

from products import CATEGORIES, HIGHLIGHTS, PRODUCTS

BASE_DIR = Path(__file__).resolve().parent
IMG_DIR = BASE_DIR / "static" / "images"
ON_RENDER = bool(os.environ.get("RENDER"))

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-change-me")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=ON_RENDER,
    SEND_FILE_MAX_AGE_DEFAULT=60 * 60 * 24 * 7,
    JSON_AS_ASCII=False,
)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("lynks")

TAG_SLUGS = {"Новинка": "new", "Акція": "sale", "Хіт": "hit",
             "Premium": "premium", "Еко": "eco", "Набір": "set"}
VOLUME_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(мл|л|кг|шт)\b", re.IGNORECASE)
MAX_QTY = 99

# Теми оформлення (ключ → назва, колір для перемикача, колір рядка браузера)
THEMES = {
    "eco":      {"name": "Еко",      "swatch": "#14b8a6", "meta": "#0b3b36"},
    "ocean":    {"name": "Океан",    "swatch": "#0ea5e9", "meta": "#0c4a6e"},
    "lavender": {"name": "Лаванда",  "swatch": "#a78bfa", "meta": "#3b0764"},
    "citrus":   {"name": "Цитрус",   "swatch": "#fb923c", "meta": "#7c2d12"},
}
MODES = {"auto": "Авто", "light": "Світла", "dark": "Темна"}
CONSENT_VALUES = {"all", "necessary"}


# ------------------------------------------------------------------ helpers
def _existing_images() -> set[str]:
    return {p.name for p in IMG_DIR.iterdir()} if IMG_DIR.exists() else set()


EXISTING_IMAGES = _existing_images()


def image_url(pid: int) -> str:
    img = PRODUCTS[pid].get("img", "")
    if img in EXISTING_IMAGES:
        return url_for("static", filename=f"images/{img}")
    return url_for("placeholder", pid=pid)


def product_view(pid: int) -> dict:
    p = PRODUCTS[pid]
    cat = CATEGORIES.get(p["category"], {})
    old = p.get("price_old")
    vol = VOLUME_RE.search(p["name"])
    return {
        **p,
        "id": pid,
        "image": image_url(pid),
        "url": url_for("product", pid=pid),
        "category_title": cat.get("short", ""),
        "category_full": cat.get("title", ""),
        "tag_slug": TAG_SLUGS.get(p.get("tag") or "", "default"),
        "discount": round((1 - p["price"] / old) * 100) if old and old > p["price"] else 0,
        "volume": f"{vol.group(1)} {vol.group(2)}" if vol else None,
    }


def products_in(category: str | None = None) -> list[dict]:
    return [product_view(pid) for pid, p in PRODUCTS.items()
            if category is None or p["category"] == category]


def get_cart() -> dict[str, int]:
    cart = session.get("cart") or {}
    # чистимо від неіснуючих товарів
    return {k: v for k, v in cart.items() if k.isdigit() and int(k) in PRODUCTS and v > 0}


def save_cart(cart: dict[str, int]) -> None:
    session["cart"] = cart
    session.modified = True


def cart_summary() -> dict:
    cart = get_cart()
    items, total = [], 0.0
    for pid_str, qty in cart.items():
        pv = product_view(int(pid_str))
        subtotal = pv["price"] * qty
        total += subtotal
        items.append({**pv, "quantity": qty, "subtotal": subtotal})
    return {"items": items, "count": sum(cart.values()), "total": total}


def money(value: float) -> str:
    value = float(value or 0)
    s = f"{value:,.0f}" if value.is_integer() else f"{value:,.2f}"
    return s.replace(",", " ") + " ₴"


app.jinja_env.filters["money"] = money


_ASSET_VERSIONS: dict[str, str] = {}


def asset(filename: str) -> str:
    """URL статичного файлу з хешем вмісту (?v=...), щоб браузер не тримав стару версію в кеші."""
    if filename not in _ASSET_VERSIONS:
        path = BASE_DIR / "static" / filename
        try:
            _ASSET_VERSIONS[filename] = hashlib.md5(path.read_bytes()).hexdigest()[:10]
        except OSError:
            _ASSET_VERSIONS[filename] = "0"
    return url_for("static", filename=filename, v=_ASSET_VERSIONS[filename])


app.jinja_env.globals["asset"] = asset


@app.context_processor
def inject_globals():
    counts = {}
    for p in PRODUCTS.values():
        counts[p["category"]] = counts.get(p["category"], 0) + 1
    theme = request.cookies.get("lynks_theme", "eco")
    mode = request.cookies.get("lynks_mode", "auto")
    consent = request.cookies.get("lynks_consent")
    return {
        "theme": theme if theme in THEMES else "eco",
        "mode": mode if mode in MODES else "auto",
        "themes": THEMES,
        "modes": MODES,
        "consent": consent if consent in CONSENT_VALUES else None,
        "categories": CATEGORIES,
        "category_counts": counts,
        "cart_count": sum(get_cart().values()),
        "year": datetime.now().year,
        "total_products": len(PRODUCTS),
    }


# ------------------------------------------------------------------ pages
@app.route("/")
def index():
    highlights = [product_view(pid) for pid in HIGHLIGHTS if pid in PRODUCTS]
    deals = [p for p in products_in() if p["discount"]][:8]
    novelties = [p for p in products_in() if p.get("tag") == "Новинка"][:8]
    return render_template("index.html", highlights=highlights, deals=deals, novelties=novelties)


@app.route("/catalog")
@app.route("/catalog/<category_name>")
def catalog(category_name: str | None = None):
    if category_name and category_name not in CATEGORIES:
        abort(404)
    items = products_in(category_name)
    q = (request.args.get("q") or "").strip()
    if q:
        ql = q.lower()
        items = [p for p in items if ql in p["name"].lower() or ql in p["desc"].lower()]
    title = CATEGORIES[category_name]["title"] if category_name else (
        f"Пошук: «{q}»" if q else "Увесь каталог")
    return render_template("catalog.html", products=items, title=title,
                           active_category=category_name, q=q)


@app.route("/deals")
def deals():
    items = [p for p in products_in() if p["discount"] or p.get("tag") == "Акція"]
    return render_template("catalog.html", products=items, title="Акції та знижки",
                           active_category=None, q="", is_deals=True)


@app.route("/product/<int:pid>")
def product(pid: int):
    if pid not in PRODUCTS:
        abort(404)
    p = product_view(pid)
    related = [x for x in products_in(p["category"]) if x["id"] != pid][:4]
    return render_template("product.html", product=p, related=related, title=p["name"])


@app.route("/cart")
def view_cart():
    return render_template("cart.html", cart=cart_summary(), title="Кошик")


@app.route("/checkout", methods=["POST"])
def checkout():
    summary = cart_summary()
    if not summary["items"]:
        return redirect(url_for("view_cart"))

    form = {k: (request.form.get(k) or "").strip()[:300]
            for k in ("name", "phone", "city", "delivery", "comment")}
    errors = {}
    if len(form["name"]) < 2:
        errors["name"] = "Вкажіть ім'я"
    if len(re.sub(r"\D", "", form["phone"])) < 10:
        errors["phone"] = "Вкажіть коректний номер телефону"
    if len(form["city"]) < 2:
        errors["city"] = "Вкажіть місто"
    if errors:
        return render_template("cart.html", cart=summary, title="Кошик",
                               errors=errors, form=form), 400

    order_id = datetime.now().strftime("%y%m%d-%H%M%S")
    order = {
        "id": order_id, **form,
        "items": [{"id": i["id"], "name": i["name"], "qty": i["quantity"],
                   "price": i["price"]} for i in summary["items"]],
        "total": summary["total"],
    }
    log.info("NEW ORDER %s", json.dumps(order, ensure_ascii=False))
    notify_telegram(order)
    save_cart({})
    return render_template("order_success.html", order=order, title="Замовлення прийнято")


def notify_telegram(order: dict) -> None:
    """Надсилає замовлення в Telegram, якщо задані TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID."""
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return
    lines = [f"🧾 <b>Нове замовлення #{order['id']}</b>",
             f"👤 {escape(order['name'])}", f"📞 {escape(order['phone'])}",
             f"📍 {escape(order['city'])} {escape(order['delivery'])}"]
    if order["comment"]:
        lines.append(f"💬 {escape(order['comment'])}")
    lines.append("")
    lines += [f"• {escape(i['name'])} × {i['qty']} = {money(i['price'] * i['qty'])}" for i in order["items"]]
    lines.append(f"\n<b>Разом: {money(order['total'])}</b>")
    data = urllib.parse.urlencode({"chat_id": chat, "text": "\n".join(lines),
                                   "parse_mode": "HTML"}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data, timeout=6)
    except Exception as exc:  # не валимо замовлення через Telegram
        log.warning("Telegram notify failed: %s", exc)


# ------------------------------------------------------------------ cart API
def _payload() -> dict:
    return request.get_json(silent=True) or request.form.to_dict()


def _cart_response(pid: int | None = None):
    s = cart_summary()
    resp = {"success": True, "total_items": s["count"], "total_price": s["total"],
            "total_price_fmt": money(s["total"])}
    if pid is not None:
        qty = get_cart().get(str(pid), 0)
        resp.update(product_id=pid, quantity=qty,
                    subtotal_fmt=money(PRODUCTS[pid]["price"] * qty))
    return jsonify(resp)


def _pid_from(data: dict) -> int | None:
    raw = str(data.get("product_id", ""))
    return int(raw) if raw.isdigit() and int(raw) in PRODUCTS else None


@app.post("/api/cart/add")
@app.post("/add_to_cart")  # сумісність зі старою версією
def api_cart_add():
    data = _payload()
    pid = _pid_from(data)
    if pid is None:
        return jsonify(success=False, message="Товар не знайдено"), 400
    try:
        qty = max(1, min(MAX_QTY, int(data.get("qty", 1))))
    except (TypeError, ValueError):
        qty = 1
    cart = get_cart()
    cart[str(pid)] = min(MAX_QTY, cart.get(str(pid), 0) + qty)
    save_cart(cart)
    return _cart_response(pid)


@app.post("/api/cart/update")
@app.post("/update_cart")
def api_cart_update():
    data = _payload()
    pid = _pid_from(data)
    if pid is None:
        return jsonify(success=False, message="Товар не знайдено"), 400
    cart, key = get_cart(), str(pid)
    action = data.get("action")
    if action == "increase":
        cart[key] = min(MAX_QTY, cart.get(key, 0) + 1)
    elif action == "decrease":
        cart[key] = cart.get(key, 0) - 1
    elif action == "remove":
        cart[key] = 0
    else:
        return jsonify(success=False, message="Невідома дія"), 400
    save_cart({k: v for k, v in cart.items() if v > 0})
    return _cart_response(pid)


@app.get("/api/cart")
def api_cart():
    return _cart_response()


# ------------------------------------------------------------------ misc
@app.route("/placeholder/<int:pid>.svg")
def placeholder(pid: int):
    """Красива SVG-заглушка для товарів без фото."""
    p = PRODUCTS.get(pid)
    if not p:
        abort(404)
    cat = CATEGORIES.get(p["category"], {})
    color = cat.get("color", "#14b8a6")
    emoji = cat.get("emoji", "🧴")
    vol = VOLUME_RE.search(p["name"])
    label = escape(f"{vol.group(1)} {vol.group(2)}" if vol else cat.get("short", "Lynks"))
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="{color}" stop-opacity=".18"/><stop offset="1" stop-color="{color}" stop-opacity=".42"/></linearGradient>
<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient></defs>
<rect width="400" height="400" fill="url(#g)"/>
<circle cx="320" cy="80" r="46" fill="{color}" opacity=".15"/><circle cx="70" cy="330" r="30" fill="{color}" opacity=".18"/>
<rect x="150" y="70" width="100" height="40" rx="12" fill="{color}" opacity=".85"/>
<rect x="120" y="105" width="160" height="230" rx="38" fill="url(#b)" stroke="{color}" stroke-opacity=".35" stroke-width="3"/>
<text x="200" y="215" font-size="64" text-anchor="middle">{emoji}</text>
<text x="200" y="285" font-family="system-ui,sans-serif" font-weight="800" font-size="26" fill="{color}" text-anchor="middle">{label}</text>
</svg>"""
    return Response(svg, mimetype="image/svg+xml",
                    headers={"Cache-Control": "public, max-age=604800"})


@app.route("/cookies")
def cookies_policy():
    return render_template("cookies.html", title="Політика cookie")


@app.route("/healthz")
def healthz():
    return {"status": "ok"}


@app.errorhandler(404)
def not_found(_e):
    picks = [product_view(pid) for pid in HIGHLIGHTS[:4] if pid in PRODUCTS]
    return render_template("404.html", title="Сторінку не знайдено", picks=picks), 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=not ON_RENDER)
