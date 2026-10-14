import base64
import hashlib
import hmac
import json
import os
import re
import sqlite3
import uuid
from functools import wraps

from dotenv import load_dotenv
from flask import (
    Flask, Response, abort, g, jsonify, redirect, render_template, request,
    send_from_directory, session, stream_with_context, url_for,
)

load_dotenv()


def env(name, default=""):
    """Переменная окружения; пустое значение считается незаданным."""
    return os.environ.get(name) or default


app = Flask(__name__)
app.secret_key = env("SECRET_KEY", "spider123")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LEN = 6

# ---------- ИИ (Tokenator, API в формате Anthropic) ----------
AI_API_KEY = env("AI_API_KEY")  # ключ из кабинета Tokenator, кладётся в .env
AI_BASE_URL = "https://api.tokenator.cloud/anthropic"
# Роль ИИ задаётся в prompt.txt рядом с этим файлом; читается при каждом сообщении,
# поэтому правки работают без перезапуска сервера.
PROMPT_FILE = os.path.join(os.path.dirname(__file__), "prompt.txt")
AI_MAX_TOKENS = 2048
HISTORY_LIMIT = 20   # сколько последних сообщений отправляем модели
HISTORY_IMAGES = 3   # картинки показываем модели только в последних N сообщениях
MAX_MESSAGE_LEN = 4000

# Модели Tokenator, проверенные на ответы и чтение картинок. Первая — по умолчанию.
# Сначала быстрые, дальше тяжелее и умнее (они и токенов тратят больше).
MODELS = [
    ("deepseek-v4.1-flash", "DeepSeek V4.1 Flash · быстрая"),
    ("gemini-3.8-flash", "Gemini 3.8 Flash · быстрая"),
    ("gpt-6.1-sol", "GPT-6.1 Sol"),
    ("claude-sonnet-5.5", "Claude Sonnet 5.5"),
    ("grok-4.7", "Grok 4.7"),
    ("kimi-k2.8-preview", "Kimi K2.8"),
    ("qwen-3-8-max", "Qwen 3.8 Max"),
    ("claude-fable-5.1", "Claude Fable 5.1"),
    ("claude-opus-5.5", "Claude Opus 5.5 · самая умная"),
]
MODEL_IDS = [m for m, _ in MODELS]

# Картинки в чате: сохраняем в instance/uploads, формат определяем по первым байтам
UPLOAD_DIR = os.path.join(app.instance_path, "uploads")
MAX_IMAGES = 3
MAX_IMAGE_BYTES = 4 * 1024 * 1024
IMAGE_TYPES = {  # начало файла -> (расширение, media type)
    b"\xff\xd8\xff": ("jpg", "image/jpeg"),
    b"\x89PNG": ("png", "image/png"),
    b"GIF8": ("gif", "image/gif"),
    b"RIFF": ("webp", "image/webp"),
}
IMAGE_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|gif|webp)$")
DATA_URL_RE = re.compile(r"^data:image/[a-z+]+;base64,(.+)$", re.S)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024


def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


# ========== БАЗА ДАННЫХ ==========
# "sqlite" — локальная база в файле (для разработки без школьного сервера),
# "mysql"  — школьная база. Переключается переменной окружения DB_BACKEND.
DB_BACKEND = env("DB_BACKEND", "sqlite")
SQLITE_PATH = os.path.join(app.instance_path, "local.db")

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    surname TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 1000
);
CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT 'Новый чат',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    images TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

# В школьной базе users уже есть; создаём только таблицы чатов.
MYSQL_CHAT_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS chats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT 'Новый чат',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4""",
    """CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chat_id INT NOT NULL,
        role VARCHAR(16) NOT NULL,
        content TEXT NOT NULL,
        images TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4""",
]

if DB_BACKEND == "mysql":
    import mysql.connector

    DBError = mysql.connector.Error
    IntegrityError = mysql.connector.IntegrityError
else:
    DBError = sqlite3.Error
    IntegrityError = sqlite3.IntegrityError

_mysql_schema_ready = False


def get_db():
    """Одно соединение на запрос, закрывается автоматически."""
    global _mysql_schema_ready
    if "db" not in g:
        if DB_BACKEND == "mysql":
            g.db = mysql.connector.connect(
                host=env("DB_HOST", "185.114.247.43"),
                port=int(env("DB_PORT", 3306)),
                database=env("DB_NAME", "sch688_vvedenie"),
                user=env("DB_USER", "sch688_vvedenie"),
                password=env("DB_PASSWORD", "Qwerty123"),
                connection_timeout=10,
            )
            if not _mysql_schema_ready:
                cur = g.db.cursor()
                for stmt in MYSQL_CHAT_SCHEMA:
                    cur.execute(stmt)
                cur.execute("SHOW COLUMNS FROM messages LIKE 'images'")
                if not cur.fetchall():  # база создана до появления картинок
                    cur.execute("ALTER TABLE messages ADD COLUMN images TEXT")
                g.db.commit()
                _mysql_schema_ready = True
        else:
            os.makedirs(app.instance_path, exist_ok=True)
            g.db = sqlite3.connect(SQLITE_PATH)
            g.db.row_factory = sqlite3.Row
            g.db.executescript(SQLITE_SCHEMA)
            if "images" not in [r[1] for r in g.db.execute("PRAGMA table_info(messages)")]:
                g.db.execute("ALTER TABLE messages ADD COLUMN images TEXT")  # база до картинок
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def run(sql, params=(), *, one=False, many=False, commit=False):
    """Выполняет запрос.

    one=True  -> первая строка как dict (или None)
    many=True -> список строк-словарей
    иначе     -> id вставленной записи

    В запросах используем %s; для SQLite он заменяется на ?.
    """
    db = get_db()
    if DB_BACKEND == "mysql":
        cur = db.cursor(dictionary=True)
        cur.execute(sql, params)
    else:
        cur = db.execute(sql.replace("%s", "?").replace("`", ""), params)

    if one:
        row = cur.fetchone()
        result = dict(row) if row else None
    elif many:
        result = [dict(r) for r in cur.fetchall()]
    else:
        result = cur.lastrowid
    if commit:
        db.commit()
    return result


def fetch_user(email):
    return run(
        "SELECT id, username, surname, email, password_hash, balance "
        "FROM `users` WHERE `email` = %s",
        (email,),
        one=True,
    )


def json_error(message, status):
    return jsonify({"success": False, "error": message}), status


@app.errorhandler(DBError)
def db_error(exc):
    app.logger.exception("Ошибка базы данных: %s", exc)
    if request.is_json or request.method == "POST" or request.path.startswith("/api/"):
        return json_error("База данных недоступна, попробуйте позже", 503)
    return "База данных недоступна, попробуйте позже", 503


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if "user_email" not in session:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapper


def api_login_required(view):
    """Для /api/*: вместо редиректа отдаём 401 и кладём пользователя в g.user."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        user = fetch_user(session["user_email"]) if "user_email" in session else None
        if not user:
            session.clear()
            return json_error("Войдите в аккаунт", 401)
        g.user = user
        return view(*args, **kwargs)

    return wrapper


# ========== РЕГИСТРАЦИЯ ==========
@app.route("/user_register", methods=["POST"])
def user_register():
    req = request.get_json(silent=True) or {}
    name = str(req.get("name", "")).strip()
    surname = str(req.get("surname", "")).strip()
    email = str(req.get("email", "")).strip().lower()
    password = str(req.get("password", ""))

    if not name:
        return json_error("Введите имя", 400)
    if not EMAIL_RE.match(email):
        return json_error("Введите корректный email", 400)
    if len(password) < MIN_PASSWORD_LEN:
        return json_error("Пароль должен быть минимум %d символов" % MIN_PASSWORD_LEN, 400)

    if fetch_user(email):
        return json_error("Email уже занят", 400)

    try:
        run(
            "INSERT INTO `users`(`username`, `surname`, `email`, `password_hash`) "
            "VALUES (%s, %s, %s, %s)",
            (name, surname, email, hash_password(password)),
            commit=True,
        )
    except IntegrityError:
        return json_error("Email уже занят", 400)

    return jsonify({"success": True, "message": "OK"}), 200


# ========== ВХОД ==========
@app.route("/user_login", methods=["POST"])
def user_login():
    req = request.get_json(silent=True) or {}
    email = str(req.get("email", "")).strip().lower()
    password = str(req.get("password", ""))

    user = fetch_user(email) if email and password else None
    # compare_digest — сравнение за постоянное время
    if not user or not hmac.compare_digest(user["password_hash"], hash_password(password)):
        return json_error("Неверный email или пароль", 400)

    session.clear()
    session["user_email"] = user["email"]
    return jsonify({
        "success": True,
        "message": "Успешный вход!",
        "user": {
            "username": user["username"],
            "email": user["email"],
            "balance": user["balance"],
        },
    }), 200


# ========== ЧАТ С ИИ ==========
def own_chat(chat_id):
    """Чат текущего пользователя или None (чужие чаты недоступны)."""
    return run(
        "SELECT id, title FROM `chats` WHERE `id` = %s AND `user_id` = %s",
        (chat_id, g.user["id"]),
        one=True,
    )


def save_images(data_urls):
    """Принимает data-URL картинок, сохраняет файлы, возвращает список имён."""
    names = []
    for url in data_urls[:MAX_IMAGES]:
        match = DATA_URL_RE.match(str(url))
        try:
            raw = base64.b64decode(match.group(1), validate=True) if match else b""
        except ValueError:
            raw = b""
        kind = next((v for k, v in IMAGE_TYPES.items() if raw.startswith(k)), None)
        if not kind or len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("Можно прикреплять картинки (jpg, png, webp, gif) до 4 МБ")
        name = "%s.%s" % (uuid.uuid4().hex, kind[0])
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
            f.write(raw)
        names.append(name)
    return names


def to_ai_messages(rows):
    """Строки из БД (от новых к старым) -> сообщения для API в порядке диалога.
    Картинки отправляем только из последних HISTORY_IMAGES сообщений."""
    result, image_budget = [], HISTORY_IMAGES
    for row in rows:  # от новых к старым — бюджет картинок достаётся последним
        blocks = []
        names = row["images"].split(",") if row["images"] else []
        if names and image_budget > 0:
            image_budget -= 1
            for name in names:
                try:
                    with open(os.path.join(UPLOAD_DIR, name), "rb") as f:
                        raw = f.read()
                except OSError:
                    continue  # файл удалён — просто пропускаем
                media = next(v[1] for k, v in IMAGE_TYPES.items() if raw.startswith(k))
                blocks.append({"type": "image", "source": {
                    "type": "base64", "media_type": media,
                    "data": base64.b64encode(raw).decode()}})
        blocks.append({"type": "text", "text": row["content"] or "Что на этом изображении?"})
        result.append({"role": row["role"], "content": blocks})
    result.reverse()  # теперь от старых к новым, как шёл разговор
    while result and result[0]["role"] != "user":  # диалог должен начинаться с пользователя
        result.pop(0)
    # Два сообщения одной роли подряд (например, ответ ИИ не дошёл) склеиваем в одно
    merged = []
    for msg in result:
        if merged and merged[-1]["role"] == msg["role"]:
            merged[-1]["content"] += msg["content"]
        else:
            merged.append(msg)
    return merged


def system_prompt():
    try:
        with open(PROMPT_FILE, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def stream_ai(messages, model):
    """Отдаёт ответ кусками по мере печати. Если модель недоступна ещё до первого
    куска — пробует соседние из списка."""
    if not AI_API_KEY:
        yield "ИИ пока не подключён: в файле .env не задан AI_API_KEY."
        return

    import anthropic

    # Tokenator принимает ключ как Bearer-токен
    client = anthropic.Anthropic(
        api_key=None, auth_token=AI_API_KEY, base_url=AI_BASE_URL, timeout=30, max_retries=1
    )
    prompt = system_prompt()
    extra = {"system": prompt} if prompt else {}
    chain = [model] + [m for m in MODEL_IDS if m != model][:2]
    last_error = None
    for name in chain:
        started = False
        try:
            with client.messages.stream(
                model=name, max_tokens=AI_MAX_TOKENS, messages=messages, **extra
            ) as stream:
                for piece in stream.text_stream:
                    if piece:
                        started = True
                        yield piece
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
            raise  # неверный ключ — другие модели не помогут
        except anthropic.APIError as exc:  # перегрузка, лимит, обрыв связи
            if started:
                raise  # половина ответа уже ушла — другой моделью не продолжить
            app.logger.warning("Модель %s недоступна (%s)", name, exc)
            last_error = exc
            continue
        if started:
            return
        app.logger.warning("Модель %s вернула пустой ответ", name)
    if last_error:
        raise last_error
    yield "Не получилось получить ответ, попробуйте ещё раз."


def pick_model(req):
    return req.get("model") if req.get("model") in MODEL_IDS else MODEL_IDS[0]


def reply_stream(chat_id, title, model):
    """Потоковый ответ ИИ в формате NDJSON: {"delta": ...} по кускам,
    в конце {"done": true, "title": ...} или {"error": ...}."""
    rows = run(
        "SELECT role, content, images FROM `messages` WHERE `chat_id` = %s "
        "ORDER BY `id` DESC LIMIT %s",
        (chat_id, HISTORY_LIMIT),
        many=True,
    )
    messages = to_ai_messages(rows)

    def line(obj):
        return json.dumps(obj, ensure_ascii=False) + "\n"

    def generate():
        parts = []
        try:
            for piece in stream_ai(messages, model):
                parts.append(piece)
                yield line({"delta": piece})
        except Exception:
            app.logger.exception("Ошибка запроса к ИИ")
            yield line({"error": "ИИ сейчас недоступен, попробуйте ещё раз"})
            return
        run(
            "INSERT INTO `messages`(`chat_id`, `role`, `content`) VALUES (%s, 'assistant', %s)",
            (chat_id, "".join(parts).strip()),
            commit=True,
        )
        yield line({"done": True, "title": title})

    return Response(
        stream_with_context(generate()),
        mimetype="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/chats", methods=["GET"])
@api_login_required
def api_chats():
    chats = run(
        "SELECT id, title FROM `chats` WHERE `user_id` = %s ORDER BY `id` DESC",
        (g.user["id"],),
        many=True,
    )
    return jsonify({"success": True, "chats": chats})


@app.route("/api/chats", methods=["POST"])
@api_login_required
def api_chat_create():
    chat_id = run(
        "INSERT INTO `chats`(`user_id`, `title`) VALUES (%s, %s)",
        (g.user["id"], "Новый чат"),
        commit=True,
    )
    return jsonify({"success": True, "chat": {"id": chat_id, "title": "Новый чат"}})


@app.route("/api/chats/<int:chat_id>", methods=["GET"])
@api_login_required
def api_chat_messages(chat_id):
    if not own_chat(chat_id):
        return json_error("Чат не найден", 404)
    messages = run(
        "SELECT role, content, images FROM `messages` WHERE `chat_id` = %s ORDER BY `id`",
        (chat_id,),
        many=True,
    )
    for m in messages:
        m["images"] = m["images"].split(",") if m["images"] else []
    return jsonify({"success": True, "messages": messages})


@app.route("/api/chats/<int:chat_id>", methods=["DELETE"])
@api_login_required
def api_chat_delete(chat_id):
    if not own_chat(chat_id):
        return json_error("Чат не найден", 404)
    rows = run(
        "SELECT images FROM `messages` WHERE `chat_id` = %s AND `images` IS NOT NULL",
        (chat_id,),
        many=True,
    )
    run("DELETE FROM `messages` WHERE `chat_id` = %s", (chat_id,))
    run("DELETE FROM `chats` WHERE `id` = %s", (chat_id,), commit=True)
    for row in rows:
        for name in row["images"].split(","):
            try:
                os.remove(os.path.join(UPLOAD_DIR, name))
            except OSError:
                pass
    return jsonify({"success": True})


@app.route("/api/chats/<int:chat_id>/messages", methods=["POST"])
@api_login_required
def api_chat_send(chat_id):
    chat = own_chat(chat_id)
    if not chat:
        return json_error("Чат не найден", 404)

    req = request.get_json(silent=True) or {}
    text = str(req.get("text", "")).strip()
    try:
        images = save_images(req.get("images") or [])
    except ValueError as exc:
        return json_error(str(exc), 400)
    if not text and not images:
        return json_error("Пустое сообщение", 400)
    if len(text) > MAX_MESSAGE_LEN:
        return json_error("Сообщение слишком длинное (максимум %d символов)" % MAX_MESSAGE_LEN, 400)

    run(
        "INSERT INTO `messages`(`chat_id`, `role`, `content`, `images`) VALUES (%s, 'user', %s, %s)",
        (chat_id, text, ",".join(images) or None),
    )
    if chat["title"] == "Новый чат":
        chat["title"] = text[:40] or "Изображение"
        run("UPDATE `chats` SET `title` = %s WHERE `id` = %s", (chat["title"], chat_id))
    get_db().commit()  # фиксируем сообщение до обращения к ИИ
    return reply_stream(chat_id, chat["title"], pick_model(req))


@app.route("/api/chats/<int:chat_id>/regenerate", methods=["POST"])
@api_login_required
def api_chat_regenerate(chat_id):
    """«Переспросить»: убираем последний ответ ИИ и спрашиваем заново (можно другой моделью)."""
    chat = own_chat(chat_id)
    if not chat:
        return json_error("Чат не найден", 404)
    last = run(
        "SELECT id, role FROM `messages` WHERE `chat_id` = %s ORDER BY `id` DESC LIMIT 1",
        (chat_id,),
        one=True,
    )
    if not last:
        return json_error("В чате пока нет сообщений", 400)
    if last["role"] == "assistant":
        run("DELETE FROM `messages` WHERE `id` = %s", (last["id"],), commit=True)
    return reply_stream(chat_id, chat["title"], pick_model(request.get_json(silent=True) or {}))


@app.route("/api/chats/<int:chat_id>", methods=["PATCH"])
@api_login_required
def api_chat_rename(chat_id):
    if not own_chat(chat_id):
        return json_error("Чат не найден", 404)
    title = str((request.get_json(silent=True) or {}).get("title", "")).strip()[:60]
    if not title:
        return json_error("Название не может быть пустым", 400)
    run("UPDATE `chats` SET `title` = %s WHERE `id` = %s", (title, chat_id), commit=True)
    return jsonify({"success": True, "title": title})


@app.route("/uploads/<name>")
@login_required
def upload(name):
    """Отдаёт картинку, только если она из чата текущего пользователя."""
    owner = IMAGE_NAME_RE.match(name) and run(
        "SELECT 1 AS ok FROM `messages` m JOIN `chats` c ON c.id = m.chat_id "
        "WHERE c.user_id = %s AND m.images LIKE %s",
        (fetch_user(session["user_email"])["id"], "%" + name + "%"),
        one=True,
    )
    if not owner:
        abort(404)
    return send_from_directory(UPLOAD_DIR, name)


# ========== СТРАНИЦЫ ==========
@app.route("/")
def registration():
    return render_template("registration.html")


@app.route("/login")
def login():
    return render_template("login.html")


@app.route("/dashboard")
@login_required
def dashboard():
    user = fetch_user(session["user_email"])
    if not user:
        session.clear()
        return redirect(url_for("login"))
    return render_template("dashboard.html", user=user, models=MODELS)


@app.route("/games")
@login_required
def games():
    return render_template("games.html")


# Обе игры открываются одним шаблоном game.html
GAMES = {
    "/game": {"title": "Flappy Sasha", "canvas": "game", "size": (216, 384),
              "hint": "Пробел, ↑ или тап — взмах", "script": "game.js"},
    "/dino": {"title": "Sasha Run", "canvas": "dino", "size": (600, 150),
              "hint": "Пробел, ↑ или тап — прыжок · ↓ — пригнуться", "script": "dino.js"},
}


@app.route("/game")
@app.route("/dino")
@login_required
def game():
    return render_template("game.html", **GAMES[request.path])


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


def main():
    app.run(
        debug=env("FLASK_DEBUG") == "1",
        port=int(env("PORT", 5001)),
    )


if __name__ == "__main__":
    main()
