const initial = document.body.dataset.initial || '?';

const messagesEl = document.getElementById('messages');
const emptyState = document.getElementById('emptyState');
const textarea = document.getElementById('textarea');
const sendBtn = document.getElementById('sendBtn');
const chatListEl = document.getElementById('chatList');
const chatSearch = document.getElementById('chatSearch');
const newChatBtn = document.getElementById('newChatBtn');
const modelSelect = document.getElementById('modelSelect');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const attachPreview = document.getElementById('attachPreview');

const MAX_IMAGES = 3;
const MAX_SIDE = 1280;   // картинки уменьшаем до этого размера перед отправкой

// Тонкие скруглённые иконки
const icon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_COPY = icon('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>');
const ICON_CHECK = icon('<path d="M20 6 9 17l-5-5"/>');
const ICON_REGEN = icon('<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>');
const ICON_X = icon('<path d="M18 6 6 18M6 6l12 12"/>');

let chats = [];          // [{ id, title }]
let currentChatId = null;
let sending = false;
let attachments = [];    // data-URL выбранных картинок

// ---------- Вспомогательное ----------
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location = '/login';
    throw new Error('Нужен вход');
  }
  if (!res.ok || !json.success) throw new Error(json.error || 'Ошибка сервера');
  return json;
}

function updateSendBtn() {
  sendBtn.disabled = sending || (!textarea.value.trim() && attachments.length === 0);
}

function nearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showMessages(show) {
  emptyState.style.display = show ? 'none' : '';
  messagesEl.classList.toggle('active', show);
  if (!show) fitHero();
}

// Имя бывает длинным — уменьшаем заголовок, пока каждая строка влезает по ширине
function fitHero() {
  const hero = emptyState.querySelector('.hero');
  if (!hero.offsetWidth) return;
  const lines = [...hero.querySelectorAll('span')];
  let size = 120;
  hero.style.fontSize = size + 'px';
  while (size > 20 && lines.some((s) => s.scrollWidth > hero.clientWidth)) {
    size -= 4;
    hero.style.fontSize = size + 'px';
  }
}
window.addEventListener('resize', fitHero);
document.fonts.ready.then(fitHero);

// Копирует текст и на секунду показывает галочку вместо иконки
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {   // старый браузер или нет доступа к буферу — запасной способ
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const old = btn.innerHTML;
  btn.innerHTML = ICON_CHECK + (btn.classList.contains('copy-code') ? 'Скопировано' : '');
  setTimeout(() => { btn.innerHTML = old; }, 1200);
}

// ---------- Человечек над полем ввода ----------
// Появляется, когда поле ввода активно: сначала оглядывается, потом следит глазами
// за местом, где печатают. Уходит, когда курсор покидает поле.
const peeker = document.getElementById('peeker');
const eyes = peeker.querySelector('.eyes');

// Невидимая копия поля ввода — чтобы узнать, где на экране стоит курсор
const mirror = document.createElement('div');
mirror.setAttribute('aria-hidden', 'true');
Object.assign(mirror.style, {
  position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden',
  whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid',
});
document.body.appendChild(mirror);
const MIRROR_PROPS = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];

function caretPoint() {
  const cs = getComputedStyle(textarea);
  MIRROR_PROPS.forEach((p) => { mirror.style[p] = cs[p]; });
  mirror.textContent = textarea.value.slice(0, textarea.selectionEnd);
  const mark = document.createElement('span');
  mark.textContent = '​';
  mirror.appendChild(mark);
  const r = textarea.getBoundingClientRect();
  return {
    x: r.left + mark.offsetLeft - textarea.scrollLeft,
    y: r.top + mark.offsetTop - textarea.scrollTop + mark.offsetHeight / 2,
  };
}

// Взгляд вниз на поле: левый край поля — глаза влево, правый — вправо
function trackCaret() {
  if (!peeker.classList.contains('on') || peeker.classList.contains('scan')) return;
  const { x } = caretPoint();
  const box = textarea.getBoundingClientRect();
  const nx = Math.max(-1, Math.min(1, ((x - box.left) / box.width) * 2 - 1));
  eyes.style.translate = `${nx * 10}px 6px`;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
textarea.addEventListener('focus', () => {
  eyes.style.translate = '';
  peeker.classList.add('on');
  if (reducedMotion) trackCaret();
  else peeker.classList.add('scan');    // scan — сначала оглядывается по сторонам
});
textarea.addEventListener('blur', () => {
  peeker.classList.remove('on', 'scan');
  eyes.style.translate = '';
});
eyes.addEventListener('animationend', (e) => {
  if (e.target !== eyes) return;
  peeker.classList.remove('scan');
  trackCaret();
});
['click', 'keyup', 'scroll'].forEach((ev) => textarea.addEventListener(ev, trackCaret));
document.addEventListener('selectionchange', () => {
  if (document.activeElement === textarea) trackCaret();
});
window.addEventListener('resize', trackCaret);
// Клик по «Отправить» и по человечку не забирает фокус у поля — человечек не прячется
sendBtn.addEventListener('mousedown', (e) => e.preventDefault());
peeker.addEventListener('mousedown', (e) => e.preventDefault());

// Щелбан: клик по человечку
peeker.addEventListener('click', () => {
  peeker.classList.remove('flick');
  void peeker.getBoundingClientRect();   // чтобы повторный щелбан запускал анимацию заново
  peeker.classList.add('flick');
});
peeker.querySelector('.peek').addEventListener('animationend', (e) => {
  if (e.animationName === 'flick') peeker.classList.remove('flick');
});

// ---------- Markdown ----------
// Если библиотеки не загрузились (нет интернета) — показываем обычный текст.
function renderMarkdown(el, text) {
  if (window.marked && window.DOMPurify) {
    el.innerHTML = DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }), { FORBID_TAGS: ['img', 'style'] });
  } else {
    el.textContent = text;
    el.style.whiteSpace = 'pre-wrap';
  }
}

// После окончания ответа: подсветка кода и кнопка «Копировать» у каждого блока
function finishMarkdown(el) {
  el.querySelectorAll('pre code').forEach((code) => {
    if (window.hljs) hljs.highlightElement(code);
    const btn = document.createElement('button');
    btn.className = 'copy-code';
    btn.innerHTML = ICON_COPY + 'Копировать';
    btn.onclick = () => copyText(code.textContent, btn);
    code.parentElement.appendChild(btn);
  });
  el.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
}

// ---------- Ввод ----------
textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  updateSendBtn();
  trackCaret();
});

textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

// ---------- Боковое меню: скрыть/показать, состояние запоминается ----------
const sidebarToggle = document.getElementById('sidebarToggle');
function setSidebar(hidden) {
  document.body.classList.toggle('sidebar-hidden', hidden);
  setTimeout(fitHero, 300);   // после анимации меню ширина чата другая
  try { localStorage.setItem('sidebarHidden', hidden ? '1' : '0'); } catch (e) { /* ignore */ }
}
function toggleSidebar() {
  setSidebar(!document.body.classList.contains('sidebar-hidden'));
}
let savedSidebar = null;
try { savedSidebar = localStorage.getItem('sidebarHidden'); } catch (e) { /* ignore */ }
// По умолчанию на телефоне меню скрыто, на компьютере — открыто
setSidebar(savedSidebar === null ? window.innerWidth <= 720 : savedSidebar === '1');
sidebarToggle.addEventListener('click', toggleSidebar);

// ---------- Горячие клавиши: Ctrl/Cmd+K — новый чат, Esc — меню ----------
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {   // code, а не key — работает и на русской раскладке
    e.preventDefault();
    newChat();
  } else if (e.key === 'Escape') {
    toggleSidebar();
  }
});

// ---------- Выбор модели ----------
try {
  const saved = localStorage.getItem('chatModel');
  if ([...modelSelect.options].some((o) => o.value === saved)) modelSelect.value = saved;
} catch (e) { /* localStorage недоступен — не страшно */ }
modelSelect.addEventListener('change', () => {
  try { localStorage.setItem('chatModel', modelSelect.value); } catch (e) { /* ignore */ }
});

// ---------- Картинки ----------
// Уменьшаем и превращаем в JPEG, чтобы быстро отправлять и экономить токены.
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // у PNG с прозрачностью фон иначе станет чёрным
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть ' + file.name)); };
    img.src = url;
  });
}

function renderAttachments() {
  attachPreview.innerHTML = '';
  attachPreview.classList.toggle('active', attachments.length > 0);
  attachments.forEach((src, i) => {
    const item = document.createElement('div');
    item.className = 'attach-item';
    const img = document.createElement('img');
    img.src = src;
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.onclick = () => { attachments.splice(i, 1); renderAttachments(); };
    item.append(img, rm);
    attachPreview.appendChild(item);
  });
  updateSendBtn();
}

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files].slice(0, MAX_IMAGES - attachments.length);
  fileInput.value = '';
  try {
    for (const file of files) attachments.push(await shrinkImage(file));
  } catch (err) {
    alert(err.message);
  }
  renderAttachments();
});

// ---------- Сообщения ----------
function addMessage(role) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? initial : 'AI';

  const body = document.createElement('div');
  body.className = 'msg-body';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  body.appendChild(bubble);

  div.append(avatar, body);
  messagesEl.appendChild(div);
  return { div, body, bubble };
}

function renderUserMessage(text, images = []) {
  const { bubble } = addMessage('user');
  bubble.textContent = text;
  images.forEach((src) => {
    const img = document.createElement('img');
    img.src = src;
    bubble.appendChild(img);
  });
  scrollToBottom();
}

// Ответ ИИ с кнопками «Копировать» и «Переспросить»
function renderBotMessage(text, isError = false) {
  const { body, bubble } = addMessage('assistant');
  let raw = text;

  const actions = document.createElement('div');
  actions.className = 'actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn';
  copyBtn.title = 'Копировать';
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.onclick = () => copyText(raw, copyBtn);
  const regenBtn = document.createElement('button');
  regenBtn.className = 'icon-btn regen';
  regenBtn.title = 'Переспросить (можно выбрать другую модель)';
  regenBtn.innerHTML = ICON_REGEN;
  regenBtn.onclick = regenerate;
  actions.append(copyBtn, regenBtn);
  body.appendChild(actions);

  const msg = {
    // Во время печати перерисовываем не чаще раза за кадр
    update(value) {
      raw = value;
      if (msg.pending) return;
      msg.pending = requestAnimationFrame(() => {
        msg.pending = 0;
        const stick = nearBottom();
        bubble.classList.remove('typing');
        bubble.classList.add('md');
        renderMarkdown(bubble, raw);
        if (stick) scrollToBottom();
      });
    },
    finish(value) {
      cancelAnimationFrame(msg.pending);
      msg.pending = 0;
      raw = value;
      bubble.className = 'bubble md';
      renderMarkdown(bubble, raw);
      finishMarkdown(bubble);
      copyBtn.style.display = '';
    },
    fail(error) {
      cancelAnimationFrame(msg.pending);
      msg.pending = 0;
      bubble.className = 'bubble error';
      bubble.textContent = error;
      copyBtn.style.display = 'none';
    },
  };

  if (isError) msg.fail(text);
  else if (text === null) {
    bubble.classList.add('typing');
    bubble.textContent = 'Печатает';
    copyBtn.style.display = 'none';
  } else msg.finish(text);
  scrollToBottom();
  return msg;
}

// ---------- Список чатов ----------
function renderChatList() {
  chatListEl.innerHTML = '';
  const query = chatSearch.value.trim().toLowerCase();
  const shown = chats.filter((c) => c.title.toLowerCase().includes(query));
  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = query ? 'Ничего не найдено' : 'Пока нет чатов';
    chatListEl.appendChild(empty);
    return;
  }
  shown.forEach((chat) => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');
    item.dataset.id = chat.id;

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = chat.title;
    title.ondblclick = (e) => { e.stopPropagation(); startRename(chat, item, title); };

    const del = document.createElement('button');
    del.className = 'del';
    del.innerHTML = ICON_X;
    del.title = 'Удалить чат';
    del.onclick = (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    };

    item.append(title, del);
    item.onclick = () => openChat(chat.id);
    chatListEl.appendChild(item);
  });
}

// Подсветка выбранного чата без перерисовки списка (иначе ломается двойной клик)
function markActive() {
  chatListEl.querySelectorAll('.chat-item').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.id) === currentChatId);
  });
}

chatSearch.addEventListener('input', renderChatList);
chatSearch.addEventListener('keydown', (e) => e.stopPropagation());   // Esc в поиске не прячет меню

// Переименование чата двойным кликом
function startRename(chat, item, titleEl) {
  const input = document.createElement('input');
  input.value = chat.title;
  input.maxLength = 60;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (save && value && value !== chat.title) {
      try {
        chat.title = (await api('/api/chats/' + chat.id, {
          method: 'PATCH',
          body: JSON.stringify({ title: value }),
        })).title;
      } catch (err) {
        alert(err.message);
      }
    }
    renderChatList();
  };
  input.onclick = (e) => e.stopPropagation();
  input.onblur = () => finish(true);
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };
}

async function loadChats() {
  chats = (await api('/api/chats')).chats;
  renderChatList();
}

async function openChat(chatId) {
  if (chatId === currentChatId) return;
  currentChatId = chatId;
  markActive();
  messagesEl.innerHTML = '';
  try {
    const { messages } = await api('/api/chats/' + chatId);
    if (currentChatId !== chatId) return;   // пока грузилось, открыли другой чат
    messages.forEach((m) => {
      if (m.role === 'user') renderUserMessage(m.content, m.images.map((n) => '/uploads/' + n));
      else renderBotMessage(m.content);
    });
    showMessages(messages.length > 0);
  } catch (err) {
    showMessages(true);
    renderBotMessage(err.message, true);
  }
  if (window.innerWidth <= 720) setSidebar(true);
  textarea.focus();
}

function newChat() {
  // Чат создаётся на сервере при первой отправке — пустые не копятся.
  currentChatId = null;
  messagesEl.innerHTML = '';
  showMessages(false);
  markActive();
  textarea.focus();
}

async function deleteChat(chatId) {
  if (!confirm('Удалить этот чат?')) return;
  try {
    await api('/api/chats/' + chatId, { method: 'DELETE' });
  } catch (err) {
    alert(err.message);
    return;
  }
  chats = chats.filter((c) => c.id !== chatId);
  if (chatId === currentChatId) newChat();
  renderChatList();
}

// ---------- Ответ ИИ: печатается по кускам ----------
// Сервер присылает строки JSON: {"delta": "..."} … {"done": true, "title": "..."}
async function streamReply(url, body, msg) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location = '/login';
    throw new Error('Нужен вход');
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Ошибка сервера');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let title = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      if (event.delta) { text += event.delta; msg.update(text); }
      if (event.done) title = event.title;
    }
  }
  if (title === null) throw new Error('Ответ оборвался, попробуйте ещё раз');
  return { text, title };
}

async function askAI(url, body) {
  const chatId = currentChatId;
  const msg = renderBotMessage(null);
  sending = true;
  messagesEl.classList.add('busy');
  updateSendBtn();
  try {
    const { text, title } = await streamReply(url, body, msg);
    msg.finish(text);
    const chat = chats.find((c) => c.id === chatId);
    if (chat && chat.title !== title) {
      chat.title = title;
      renderChatList();
    }
  } catch (err) {
    msg.fail(err.message);
  } finally {
    sending = false;
    messagesEl.classList.remove('busy');
    updateSendBtn();
    if (nearBottom()) scrollToBottom();
    textarea.focus();
  }
}

async function sendMessage() {
  const text = textarea.value.trim();
  const images = attachments;
  if ((!text && images.length === 0) || sending) return;

  attachments = [];
  textarea.value = '';
  textarea.style.height = 'auto';
  renderAttachments();

  showMessages(true);
  renderUserMessage(text, images);

  if (currentChatId === null) {
    try {
      const { chat } = await api('/api/chats', { method: 'POST' });
      currentChatId = chat.id;
      chats.unshift(chat);
      chatSearch.value = '';
      renderChatList();
    } catch (err) {
      renderBotMessage(err.message, true);
      return;
    }
  }
  await askAI('/api/chats/' + currentChatId + '/messages', { text, images, model: modelSelect.value });
}

// «Переспросить»: убираем последний ответ и просим заново выбранной моделью
async function regenerate() {
  if (sending || currentChatId === null) return;
  const last = messagesEl.lastElementChild;
  if (last && last.classList.contains('bot')) last.remove();
  await askAI('/api/chats/' + currentChatId + '/regenerate', { model: modelSelect.value });
}

sendBtn.addEventListener('click', sendMessage);
newChatBtn.addEventListener('click', newChat);

loadChats().catch((err) => {
  chatListEl.textContent = err.message;
});
