# Lynks — інтернет-магазин миючих засобів

Flask-сайт: каталог з категоріями, пошук, сторінки товарів, кошик (у сесії) і оформлення замовлення.

## Структура
```
app.py              # Flask-додаток (маршрути, кошик, API, оформлення)
products.py         # каталог товарів і категорій — редагуйте тут
templates/          # base, index, catalog, product, cart, order_success, 404, macros
static/css/main.css # стилі (світла + темна тема)
static/js/main.js   # кошик без перезавантаження, фільтри, анімації
static/images/      # фото товарів (назва файлу = поле "img" у products.py)
render.yaml         # конфіг для Render
```
Якщо фото товару немає в `static/images/`, автоматично показується згенерована SVG-заглушка.

## Запуск локально
```bash
pip install -r requirements.txt
python app.py        # http://localhost:5000
```

## Деплой на Render
**Варіант 1 — Blueprint (найпростіше):** Render → New → Blueprint → виберіть цей репозиторій → Apply. Усе візьметься з `render.yaml`.

**Варіант 2 — вручну:** New → Web Service → репозиторій, далі:
- Runtime: **Python 3**
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 60`
- Environment: `SECRET_KEY` = будь-який довгий випадковий рядок

### Замовлення в Telegram (необов'язково)
Додайте змінні середовища `TELEGRAM_BOT_TOKEN` (від @BotFather) і `TELEGRAM_CHAT_ID` — кожне нове замовлення прийде повідомленням. Без них замовлення лише пишуться в логи Render.
