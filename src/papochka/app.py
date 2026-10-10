import hashlib
import hmac
import os
import re
import sqlite3
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, g, jsonify, redirect, render_template, request, session, url_for

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
# Ключ берётся из личного кабинета Tokenator и кладётся в .env как AI_API_KEY.
AI_API_KEY = env("AI_API_KEY")
AI_BASE_URL = env("AI_BASE_URL", "https://api.tokenator.cloud/anthropic")
# Можно указать несколько моделей через запятую: если первая перегружена
# или недоступна, чат автоматически пробует следующую.
AI_MODELS = [
    m.strip()
    # Порядок подобран по scripts/check_models.py: самые быстрые рабочие модели Tokenator
    for m in env("AI_MODEL", "deepseek-v4.1-flash,gemini-3.7-flash,gpt-4o-mini").split(",")
    if m.strip()
]
AI_MAX_TOKENS = int(env("AI_MAX_TOKENS", 1024))
AI_SYSTEM_PROMPT = env(
    "AI_SYSTEM_PROMPT",
    "Ты дружелюбный ИИ-помощник. Отвечай по-русски, кратко и по делу.",
)
HISTORY_LIMIT = 20  # сколько последних сообщений отправляем модели
MAX_MESSAGE_LEN = 4000


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
                g.db.commit()
                _mysql_schema_ready = True
        else:
            os.makedirs(app.instance_path, exist_ok=True)
            g.db = sqlite3.connect(SQLITE_PATH)
            g.db.row_factory = sqlite3.Row
            g.db.executescript(SQLITE_SCHEMA)
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


def ask_ai(history):
    """history: [{'role': 'user'|'assistant', 'content': str}, ...] -> текст ответа."""
    if not AI_API_KEY:
        return (
            "ИИ пока не подключён: в файле .env не задан AI_API_KEY. "
            "Вы написали: «%s»." % history[-1]["content"]
        )

    import anthropic

    # Tokenator принимает ключ как Bearer-токен (ANTHROPIC_AUTH_TOKEN в его инструкции)
    client = anthropic.Anthropic(
        api_key=None, auth_token=AI_API_KEY, base_url=AI_BASE_URL,
        timeout=30, max_retries=1,
    )
    # Диалог для модели должен начинаться с сообщения пользователя
    while history and history[0]["role"] != "user":
        history = history[1:]

    last_error = None
    for model in AI_MODELS:
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=AI_MAX_TOKENS,
                system=AI_SYSTEM_PROMPT,
                messages=history,
            )
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
            raise  # неверный ключ — другие модели не помогут
        except anthropic.APIStatusError as exc:
            # Перегрузка, лимит, модель не найдена и т.п. — пробуем следующую
            app.logger.warning("Модель %s недоступна (%s), пробую следующую", model, exc.status_code)
            last_error = exc
            continue
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        if text:
            return text
        # Некоторые модели иногда возвращают пустой текст — пробуем следующую
        app.logger.warning("Модель %s вернула пустой ответ, пробую следующую", model)
    if last_error:
        raise last_error
    return "Не получилось получить ответ, попробуйте ещё раз."


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
        "SELECT role, content FROM `messages` WHERE `chat_id` = %s ORDER BY `id`",
        (chat_id,),
        many=True,
    )
    return jsonify({"success": True, "messages": messages})


@app.route("/api/chats/<int:chat_id>", methods=["DELETE"])
@api_login_required
def api_chat_delete(chat_id):
    if not own_chat(chat_id):
        return json_error("Чат не найден", 404)
    run("DELETE FROM `messages` WHERE `chat_id` = %s", (chat_id,))
    run("DELETE FROM `chats` WHERE `id` = %s", (chat_id,), commit=True)
    return jsonify({"success": True})


@app.route("/api/chats/<int:chat_id>/messages", methods=["POST"])
@api_login_required
def api_chat_send(chat_id):
    chat = own_chat(chat_id)
    if not chat:
        return json_error("Чат не найден", 404)

    text = str((request.get_json(silent=True) or {}).get("text", "")).strip()
    if not text:
        return json_error("Пустое сообщение", 400)
    if len(text) > MAX_MESSAGE_LEN:
        return json_error("Сообщение слишком длинное (максимум %d символов)" % MAX_MESSAGE_LEN, 400)

    run(
        "INSERT INTO `messages`(`chat_id`, `role`, `content`) VALUES (%s, 'user', %s)",
        (chat_id, text),
    )
    if chat["title"] == "Новый чат":
        chat["title"] = text[:40]
        run("UPDATE `chats` SET `title` = %s WHERE `id` = %s", (chat["title"], chat_id))
    get_db().commit()  # фиксируем сообщение до обращения к ИИ

    rows = run(
        "SELECT role, content FROM `messages` WHERE `chat_id` = %s ORDER BY `id` DESC LIMIT %s",
        (chat_id, HISTORY_LIMIT),
        many=True,
    )
    history = list(reversed(rows))

    try:
        reply = ask_ai(history)
    except Exception:
        app.logger.exception("Ошибка запроса к ИИ")
        return json_error("ИИ сейчас недоступен, попробуйте ещё раз", 502)

    run(
        "INSERT INTO `messages`(`chat_id`, `role`, `content`) VALUES (%s, 'assistant', %s)",
        (chat_id, reply),
        commit=True,
    )
    return jsonify({"success": True, "reply": reply, "title": chat["title"]})


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
    return render_template("dashboard.html", user=user)


@app.route("/games")
@login_required
def games():
    return render_template("games.html")


@app.route("/game")
@login_required
def game():
    return render_template("game.html")


@app.route("/dino")
@login_required
def dino():
    return render_template("dino.html")


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
