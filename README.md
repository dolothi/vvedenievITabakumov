# papochka

Flask-приложение: регистрация, вход, чат с ИИ (история чатов сохраняется) и две мини-игры — Flappy Sasha и Sasha Run.

## Запуск на новом компьютере

1. Установить [uv](https://docs.astral.sh/uv/getting-started/installation/):
   - Windows (PowerShell): `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
   - macOS / Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
2. Скачать проект: `git clone https://github.com/dolothi/vvedenievITabakumov.git`
   (или на GitHub: Code → Download ZIP) и перейти в папку проекта.
3. Создать в папке проекта файл `.env` с ключом Tokenator (в git он не хранится):
   ```
   AI_API_KEY=ваш-ключ
   ```
4. Запустить: `uv run papochka` — uv сам скачает нужный Python и зависимости.
5. Открыть http://localhost:5001 и зарегистрироваться.

Без ключа сайт и игры работают, а чат отвечает заглушкой.

## Настройки (.env, все необязательные)

| Переменная | Что делает | По умолчанию |
|---|---|---|
| `AI_API_KEY` | ключ Tokenator для чата | — |
| `AI_MODEL` | модели через запятую, пробуются по очереди | `deepseek-v4.1-flash,gemini-3.7-flash,gpt-4o-mini` |
| `DB_BACKEND` | `sqlite` — локальная база в файле, `mysql` — школьная база | `sqlite` |
| `FLASK_DEBUG` | `1` — сервер сам перезапускается при правках кода | выкл |
| `PORT` | порт сайта | `5001` |

После правки `.env` сервер нужно перезапустить (Ctrl+C и снова `uv run papochka`).

Если какие-то модели перестали отвечать, проверить все разом: `uv run python scripts/check_models.py`

## Структура

- `src/papochka/app.py` — маршруты, база данных, запросы к ИИ
- `src/papochka/templates/` — страницы
- `src/papochka/static/` — стили, скрипты, игры и спрайты
- `scripts/check_models.py` — проверка доступности моделей Tokenator
