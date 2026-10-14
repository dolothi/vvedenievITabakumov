// Общее для обеих игр: спрайты головы, пиксельный холст, звук и цикл кадров.

// Холст без сглаживания: возвращает [canvas, ctx]
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  return [c, cx];
}

// Три головы лежат в одной картинке faces.png рядом: [имя, x, ширина]; высота у всех 38.
// После загрузки режем её на отдельные холсты, FACES.ready = true.
const FACES = { ready: false };
const FACE_SHEET = [['normal', 0, 38], ['up', 38, 37], ['down', 75, 40]];
const faceSheet = new Image();
faceSheet.onload = () => {
  FACE_SHEET.forEach(([name, x, w]) => {
    const [c, cx] = makeCanvas(w, 38);
    cx.drawImage(faceSheet, x, 0, w, 38, 0, 0, w, 38);
    FACES[name] = c;
  });
  FACES.ready = true;
};
faceSheet.src = '/static/faces.png';

// Звук генерируется на лету, файлов нет. effects: { имя: (tone, t) => {...} }.
// Возвращает функцию play(имя) и подключает кнопку «Звук» (#muteBtn).
function createSound(storageKey, effects) {
  let audio = null;
  let muted = false;
  try { muted = localStorage.getItem(storageKey) === '1'; } catch (e) { /* ignore */ }

  const btn = document.getElementById('muteBtn');
  const showState = () => { if (btn) btn.textContent = muted ? 'Звук: выкл' : 'Звук: вкл'; };
  if (btn) {
    btn.addEventListener('click', () => {
      muted = !muted;
      try { localStorage.setItem(storageKey, muted ? '1' : '0'); } catch (e) { /* ignore */ }
      showState();
      btn.blur(); // иначе пробел «нажмёт» кнопку и переключит звук
    });
  }
  showState();

  function tone(freq, start, dur, type, vol, endFreq) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g);
    g.connect(audio.destination);
    o.start(start);
    o.stop(start + dur);
  }

  return function play(name) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (muted || !AC || !effects[name]) return;
    audio = audio || new AC();
    effects[name](tone, audio.currentTime);
  };
}

// Цикл кадров: dt в секундах, без скачков после сворачивания вкладки
function startLoop(update, draw) {
  if (document.fonts && document.fonts.load) document.fonts.load('10px "Press Start 2P"');
  let last = performance.now();
  function frame(now) {
    // now может оказаться чуть раньше last (первый кадр) — dt не уходит в минус
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Клетчатая финишная лента: чёрно-белые клетки размером cell
function drawChecker(cx, x, y, w, h, cell) {
  for (let j = 0; j * cell < h; j++) {
    for (let i = 0; i * cell < w; i++) {
      cx.fillStyle = (i + j) % 2 ? '#1a1a1a' : '#ffffff';
      cx.fillRect(Math.round(x + i * cell), Math.round(y + j * cell),
        Math.min(cell, w - i * cell), Math.min(cell, h - j * cell));
    }
  }
}

// Конфетти на финише: разноцветные бумажки падают сверху и кружатся
const CONFETTI_COLORS = ['#e8303c', '#f7d23c', '#3cb4e8', '#5fcf58', '#e86bd0', '#ffffff', '#fca048'];
function createConfetti(w, h) {
  let bits = [];
  return {
    burst(n) {
      for (let i = 0; i < n; i++) {
        bits.push({
          x: Math.random() * w, y: -4 - Math.random() * h * 0.6,
          vx: (Math.random() - 0.5) * 60, vy: 30 + Math.random() * 60,
          size: 2 + Math.floor(Math.random() * 3), phase: Math.random() * 6,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        });
      }
    },
    update(dt) {
      for (const b of bits) {
        b.phase += dt * 8;
        b.x += (b.vx + Math.sin(b.phase) * 20) * dt;
        b.y += b.vy * dt;
      }
      bits = bits.filter((b) => b.y < h + 6);
    },
    draw(cx) {
      for (const b of bits) {
        cx.fillStyle = b.color;
        // Ширина «мигает» — бумажка будто переворачивается в полёте
        const bw = Math.max(1, Math.round(Math.abs(Math.sin(b.phase)) * b.size));
        cx.fillRect(Math.round(b.x), Math.round(b.y), bw, b.size);
      }
    },
  };
}
