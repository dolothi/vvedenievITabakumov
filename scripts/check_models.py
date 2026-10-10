"""Проверка, какие модели Tokenator сейчас отвечают.

Запуск из папки проекта:  uv run python scripts/check_models.py
Ключ берётся из .env (AI_API_KEY) и на экран не выводится.
"""
import os
import time

import anthropic
from dotenv import load_dotenv

load_dotenv()

MODELS = [
    # быстрые / дешёвые
    "claude-haiku-5-5", "claude-haiku-4-5",
    "gemini-3.8-flash", "gemini-3.7-flash", "glm-5.3-flash", "qwen-3.8-flash",
    "deepseek-v4.1-flash", "mimo-v2.6-flash", "minimax-m3.1-flash", "gpt-4o-mini",
    # бесплатные
    "free-gemini-3.8-flash", "free-glm-5.3-flash", "free-gpt-6-astra",
    "free-minimax-m3.1-flash", "free-claude-opus-5.5",
    # посильнее
    "claude-sonnet-5-5", "claude-sonnet-4-6",
]

key = os.environ.get("AI_API_KEY")
if not key:
    raise SystemExit("В .env нет AI_API_KEY")

client = anthropic.Anthropic(
    api_key=None,
    auth_token=key,
    base_url=os.environ.get("AI_BASE_URL") or "https://api.tokenator.cloud/anthropic",
    timeout=30,
    max_retries=0,
)

working = []
for model in MODELS:
    start = time.time()
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=10,
            messages=[{"role": "user", "content": "Скажи одно слово: привет"}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        secs = time.time() - start
        if not text:
            print("EMPTY %-26s %.1f с  пустой ответ — для чата не подходит" % (model, secs))
            continue
        working.append((secs, model))
        print("OK    %-26s %.1f с  -> %s" % (model, secs, text[:30]))
    except anthropic.APIStatusError as exc:
        print("FAIL  %-26s ошибка %s" % (model, exc.status_code))
    except anthropic.APIConnectionError:
        print("FAIL  %-26s нет соединения" % model)

print()
if working:
    working.sort()
    print("Работают (от быстрой к медленной):", ", ".join(m for _, m in working))
    print("Строка для .env:  AI_MODEL=" + ",".join(m for _, m in working[:3]))
else:
    print("Ни одна модель не ответила — похоже, проблема на стороне Tokenator.")
