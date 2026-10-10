// Общая логика форм входа и регистрации (без jQuery).
async function submitForm(form, url, buildPayload, onSuccess) {
  const msg = form.querySelector('.msg');
  const btn = form.querySelector('button[type="submit"]');

  const show = (text, kind) => {
    msg.textContent = text;
    msg.className = 'msg ' + kind;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    show('', '');

    let payload;
    try {
      payload = buildPayload();
    } catch (err) {
      show(err.message, 'err');
      return;
    }

    btn.disabled = true;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));

      if (res.ok && json.success) {
        show(onSuccess.message, 'ok');
        setTimeout(() => { window.location = onSuccess.redirect; }, 600);
      } else {
        show(json.error || 'Ошибка сервера', 'err');
        btn.disabled = false;
      }
    } catch (err) {
      show('Ошибка сети', 'err');
      btn.disabled = false;
    }
  });
}

const value = (id) => document.getElementById(id).value;

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  submitForm(
    loginForm,
    '/user_login',
    () => ({ email: value('email').trim(), password: value('password') }),
    { message: 'Успешно! Перенаправляем…', redirect: '/dashboard' }
  );
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
  submitForm(
    registerForm,
    '/user_register',
    () => {
      const name = value('fullname').trim();
      const surname = value('surname').trim();
      const email = value('email').trim();
      const password = value('password');

      if (!name) throw new Error('Введите имя');
      if (!surname) throw new Error('Введите фамилию');
      if (password.length < 6) throw new Error('Пароль должен быть минимум 6 символов');
      if (password !== value('confirm_password')) throw new Error('Пароли не совпадают');

      return { name, surname, email, password };
    },
    { message: 'Регистрация успешна! Перенаправляем…', redirect: '/login' }
  );
}
