const initial = document.body.dataset.initial || '?';

const messagesEl = document.getElementById('messages');
const emptyState = document.getElementById('emptyState');
const textarea = document.getElementById('textarea');
const sendBtn = document.getElementById('sendBtn');
const chatListEl = document.getElementById('chatList');
const newChatBtn = document.getElementById('newChatBtn');

let chats = [];          // [{ id, title }]
let currentChatId = null;
let sending = false;

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
  sendBtn.disabled = sending || !textarea.value.trim();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showMessages(show) {
  emptyState.style.display = show ? 'none' : '';
  messagesEl.classList.toggle('active', show);
}

// ---------- Ввод ----------
textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  updateSendBtn();
});

textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

// ---------- Сообщения ----------
function renderMessage(role, text, isError) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? initial : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (isError ? ' error' : '');
  bubble.style.whiteSpace = 'pre-wrap';
  bubble.textContent = text;

  div.append(avatar, bubble);
  messagesEl.appendChild(div);
  scrollToBottom();
  return bubble;
}

// ---------- Список чатов ----------
function renderChatList() {
  chatListEl.innerHTML = '';
  if (chats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'Пока нет чатов';
    chatListEl.appendChild(empty);
    return;
  }
  chats.forEach((chat) => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = chat.title;

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
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

async function loadChats() {
  chats = (await api('/api/chats')).chats;
  renderChatList();
}

async function openChat(chatId) {
  currentChatId = chatId;
  renderChatList();
  messagesEl.innerHTML = '';
  try {
    const { messages } = await api('/api/chats/' + chatId);
    messages.forEach((m) => renderMessage(m.role, m.content));
    showMessages(messages.length > 0);
  } catch (err) {
    showMessages(true);
    renderMessage('assistant', err.message, true);
  }
  textarea.focus();
}

function newChat() {
  // Чат создаётся на сервере при первой отправке — пустые не копятся.
  currentChatId = null;
  messagesEl.innerHTML = '';
  showMessages(false);
  renderChatList();
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
  else renderChatList();
}

// ---------- Отправка ----------
async function sendMessage() {
  const text = textarea.value.trim();
  if (!text || sending) return;

  sending = true;
  textarea.value = '';
  textarea.style.height = 'auto';
  updateSendBtn();

  showMessages(true);
  renderMessage('user', text);
  const bubble = renderMessage('assistant', 'Печатает...');

  try {
    if (currentChatId === null) {
      const { chat } = await api('/api/chats', { method: 'POST' });
      currentChatId = chat.id;
      chats.unshift(chat);
    }
    const { reply, title } = await api('/api/chats/' + currentChatId + '/messages', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    bubble.textContent = reply;

    const chat = chats.find((c) => c.id === currentChatId);
    if (chat) chat.title = title;
    renderChatList();
  } catch (err) {
    bubble.textContent = err.message;
    bubble.classList.add('error');
  } finally {
    sending = false;
    updateSendBtn();
    scrollToBottom();
    textarea.focus();
  }
}

sendBtn.addEventListener('click', sendMessage);
newChatBtn.addEventListener('click', newChat);

loadChats().catch((err) => {
  chatListEl.textContent = err.message;
});
