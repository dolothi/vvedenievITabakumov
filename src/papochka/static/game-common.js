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
