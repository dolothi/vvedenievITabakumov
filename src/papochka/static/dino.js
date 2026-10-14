// Sasha Run — как динозаврик Chrome без интернета, только бежит голова друга.
// Рисуем в 600×150 и растягиваем CSS без сглаживания.
const canvas = document.getElementById('dino');
const ctx = canvas.getContext('2d');
const W = canvas.width;   // 600
const H = canvas.height;  // 150
ctx.imageSmoothingEnabled = false;

const C = {
  bg: '#f7f7f7',
  ink: '#535353',
  cloud: '#e4e4e4',
};

// ---------- Настройки (игровые пиксели и секунды) ----------
const GROUND_Y = 132;
const RUN_X = 40;
const LEG_H = 9;
const HEAD = 38;              // размер спрайта головы
const GRAVITY = 2400;
const JUMP_SPEED = -640;
const FAST_FALL = 3;          // во сколько раз быстрее падаем, если зажать ↓ в прыжке
const START_SPEED = 360;
const MAX_SPEED = 780;
const ACCEL = 10;             // прибавка скорости в секунду
const FINISH_AT = 6767;       // на этом счёте — финиш
const POINT = 40;             // пикселей пути на одно очко

// ---------- Спрайты ----------
function spriteFrom(rows, color) {
  const [c, cx] = makeCanvas(rows[0].length, rows.length);
  cx.fillStyle = color;
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => { if (ch === 'o') cx.fillRect(x, y, 1, 1); });
  });
  return c;
}

const BIRD = [
  spriteFrom([
    '......o...........',
    '......oo..........',
    '.oo...ooo.........',
    'oooo..oooo........',
    '.ooooooooooooooo..',
    '...oooooooooooooo.',
    '.....oooooooo.....',
    '..................',
    '..................',
    '..................',
  ], C.ink),
  spriteFrom([
    '..................',
    '..................',
    '.oo...............',
    'oooo..............',
    '.ooooooooooooooo..',
    '...oooooooooooooo.',
    '.....ooooooooo....',
    '......oooo........',
    '......ooo.........',
    '......oo..........',
  ], C.ink),
];

const CLOUD = spriteFrom([
  '..........oooooo........',
  '.......oooooooooooo.....',
  '.....oooooooooooooooo...',
  '..oooooooooooooooooooooo',
  'oooooooooooooooooooooooo',
  '.oooooooooooooooooooooo.',
], C.cloud);

// ---------- Звук ----------
const sound = createSound('dinoMuted', {
  jump: (tone, t) => tone(600, t, 0.08, 'square', 0.05, 1000),
  point: (tone, t) => {
    tone(990, t, 0.07, 'square', 0.05);
    tone(1320, t + 0.08, 0.12, 'square', 0.05);
  },
  die: (tone, t) => tone(300, t, 0.3, 'sawtooth', 0.1, 60),
  win: (tone, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.12, 0.18, 'square', 0.05));
    tone(1047, t + 0.5, 0.5, 'triangle', 0.1);
  },
});

// ---------- Земля и облака ----------
const PEBBLES = [];
for (let x = 0; x < W * 2; x += 6 + Math.floor(Math.random() * 18)) {
  PEBBLES.push({ x, y: GROUND_Y + 3 + Math.floor(Math.random() * 8), w: 1 + Math.floor(Math.random() * 3) });
}

// ---------- Состояние ----------
let state = 'ready';      // ready | playing | over | win
let runner, obstacles, clouds, speed, distance, score, hiScore, nextGap;
let goal = null;          // финишная лента, когда до неё рукой подать
let winBurst = 0;
const confetti = createConfetti(W, H);
let ducking = false;
let legTime = 0, overTime = 0, blinkTime = 0;
let groundOffset = 0;

try { hiScore = parseInt(localStorage.getItem('dinoBest'), 10) || 0; } catch (e) { hiScore = 0; }

function reset() {
  runner = { y: 0, vy: 0 };   // y — высота над землёй (вверх отрицательно)
  obstacles = [];
  clouds = [{ x: 120, y: 30 }, { x: 380, y: 50 }];
  speed = START_SPEED;
  distance = 0;
  score = 0;
  nextGap = 300;
  goal = null;
  blinkTime = 0;
  state = 'ready';
}

function onGround() {
  return runner.y >= 0;
}

function jump() {
  if (state === 'ready') state = 'playing';
  if (state === 'over' || state === 'win') {
    if (overTime > (state === 'win' ? 1 : 0.5)) reset();
    return;
  }
  if (state === 'playing' && onGround() && !ducking) {
    runner.vy = JUMP_SPEED;
    sound('jump');
  }
}

// ---------- Препятствия ----------
function spawnObstacle() {
  const r = Math.random();
  if (score >= 250 && r < 0.3) {
    // Птеродактиль: низкий (прыгать), средний (пригнуться), высокий (бежать дальше)
    const heights = [GROUND_Y - 12, GROUND_Y - 34, GROUND_Y - 62];
    obstacles.push({ type: 'bird', x: W + 10, y: heights[Math.floor(Math.random() * 3)], w: 18, h: 10 });
    return;
  }
  const big = Math.random() < 0.4;
  const count = 1 + Math.floor(Math.random() * (big ? 2 : 3));
  const cw = big ? 12 : 8;
  const ch = big ? 34 : 24;
  const parts = [];
  for (let i = 0; i < count; i++) parts.push(ch - Math.floor(Math.random() * 5));
  obstacles.push({ type: 'cactus', x: W + 10, y: GROUND_Y, w: count * (cw + 4) - 4, h: ch, cw, parts });
}

function runnerBox() {
  if (ducking && onGround()) {
    return { x: RUN_X + 4, y: GROUND_Y - 24, w: HEAD + 2, h: 22 };
  }
  const top = GROUND_Y + runner.y - LEG_H - HEAD;
  return { x: RUN_X + 7, y: top + 5, w: HEAD - 14, h: HEAD + LEG_H - 7 };
}

function obstacleBox(o) {
  if (o.type === 'bird') return { x: o.x + 2, y: o.y - o.h + 2, w: o.w - 4, h: o.h - 3 };
  return { x: o.x + 1, y: o.y - o.h + 2, w: o.w - 2, h: o.h - 2 };
}

function saveHiScore() {
  if (score > hiScore) {
    hiScore = score;
    try { localStorage.setItem('dinoBest', String(hiScore)); } catch (e) { /* ignore */ }
  }
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- Обновление ----------
function update(dt) {
  legTime += dt;
  blinkTime = Math.max(0, blinkTime - dt);
  confetti.update(dt);

  if (state === 'win') {
    overTime += dt;
    winBurst -= dt;
    if (winBurst <= 0) {
      confetti.burst(overTime < 0.1 ? 150 : 50);
      winBurst = 1.2;
    }
    // Если финишировал в прыжке — спокойно приземляется
    runner.vy += GRAVITY * dt;
    runner.y = Math.min(0, runner.y + runner.vy * dt);
    return;
  }
  if (state === 'over') {
    overTime += dt;
    return;
  }
  if (state === 'ready') return;

  speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
  const move = speed * dt;
  distance += move;
  groundOffset = (groundOffset + move) % (W * 2);

  const newScore = Math.min(FINISH_AT, Math.floor(distance / POINT));
  if (Math.floor(newScore / 100) > Math.floor(score / 100)) {
    blinkTime = 0.9;
    sound('point');
  }
  score = newScore;

  // Физика прыжка
  const g = (ducking && !onGround()) ? GRAVITY * FAST_FALL : GRAVITY;
  runner.vy += g * dt;
  runner.y += runner.vy * dt;
  if (runner.y > 0) { runner.y = 0; runner.vy = 0; }

  // Облака плывут медленно
  for (const cl of clouds) cl.x -= move * 0.2;
  clouds = clouds.filter((cl) => cl.x > -30);
  if (!clouds.length || clouds[clouds.length - 1].x < W - 150 - Math.random() * 200) {
    clouds.push({ x: W + 10, y: 15 + Math.floor(Math.random() * 50) });
  }

  // Препятствия
  for (const o of obstacles) o.x -= move * (o.type === 'bird' ? 1.08 : 1);
  obstacles = obstacles.filter((o) => o.x + o.w > -10);
  // Финишная лента появляется заранее и доезжает до бегуна ровно на счёте FINISH_AT
  if (!goal && distance >= (FINISH_AT - 20) * POINT) {
    goal = { x: RUN_X + HEAD / 2 + FINISH_AT * POINT - distance };
  }
  if (goal) {
    goal.x -= move;
    if (goal.x <= RUN_X + HEAD / 2) {
      state = 'win';
      overTime = 0;
      winBurst = 0;
      score = FINISH_AT;
      sound('win');
      saveHiScore();
      return;
    }
  }

  nextGap -= move;
  if (nextGap <= 0 && !goal) {   // перед финишем новых препятствий нет
    spawnObstacle();
    // Чем выше скорость, тем длиннее промежутки — чтобы успевать реагировать
    nextGap = speed * (0.75 + Math.random() * 0.75);
  }

  const box = runnerBox();
  if (obstacles.some((o) => overlap(box, obstacleBox(o)))) {
    state = 'over';
    overTime = 0;
    sound('die');
    saveHiScore();
  }
}

// ---------- Отрисовка ----------
function drawGround() {
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, GROUND_Y, W, 1);
  for (const p of PEBBLES) {
    let x = Math.round(p.x - groundOffset);
    if (x < -5) x += W * 2;
    if (x < W) ctx.fillRect(x, p.y, p.w, 1);
  }
}

function drawCactus(o) {
  ctx.fillStyle = C.ink;
  o.parts.forEach((h, i) => {
    const x = Math.round(o.x) + i * (o.cw + 4);
    const top = GROUND_Y - h;
    const trunk = Math.max(4, o.cw - 4);
    const tx = x + Math.floor((o.cw - trunk) / 2);
    ctx.fillRect(tx, top, trunk, h);              // ствол
    ctx.fillRect(x, top + 8, 2, 8);               // левая ветка
    ctx.fillRect(x, top + 14, tx - x, 2);
    ctx.fillRect(x + o.cw - 2, top + 5, 2, 8);    // правая ветка
    ctx.fillRect(tx + trunk, top + 11, x + o.cw - tx - trunk, 2);
  });
}

function drawBird(o) {
  const frame = BIRD[Math.floor(legTime * 6) % 2];
  ctx.drawImage(frame, Math.round(o.x), Math.round(o.y - o.h));
}

function drawLegs(baseY, frame) {
  ctx.fillStyle = C.ink;
  const left = RUN_X + 12, right = RUN_X + 22;
  const lift = [[0, 3], [3, 0]][frame];
  // Ноги: если лапа поднята — она короче
  ctx.fillRect(left, baseY - LEG_H, 3, LEG_H - lift[0]);
  ctx.fillRect(left, baseY - lift[0] - 2, 5, 2);
  ctx.fillRect(right, baseY - LEG_H, 3, LEG_H - lift[1]);
  ctx.fillRect(right, baseY - lift[1] - 2, 5, 2);
}

function drawRunner() {
  const baseY = GROUND_Y + Math.round(runner.y);

  if (state === 'over') {
    if (FACES.ready) ctx.drawImage(FACES.down, RUN_X, baseY - LEG_H - HEAD);
    drawLegs(baseY, 0);
    return;
  }

  if (ducking && onGround()) {
    // Пригнулся: голову сплющивает — смешно и ниже птиц
    if (FACES.ready) ctx.drawImage(FACES.down, RUN_X, GROUND_Y - 26, HEAD + 6, 26);
    return;
  }

  const face = (!onGround() || state === 'win') ? FACES.up : FACES.normal;
  if (FACES.ready) ctx.drawImage(face, RUN_X, baseY - LEG_H - HEAD);
  const frame = (state === 'playing' && onGround()) ? Math.floor(legTime * 12) % 2 : 0;
  drawLegs(baseY, frame);
}

// Финиш: столб с клетчатым флагом и надписью
function drawGoal(g) {
  const x = Math.round(g.x);
  ctx.fillStyle = C.ink;
  ctx.fillRect(x - 1, GROUND_Y - 70, 3, 70);               // столб
  ctx.fillRect(x + 1, GROUND_Y - 71, 38, 22);              // рамка флага
  drawChecker(ctx, x + 2, GROUND_Y - 70, 36, 20, 6);
  drawChecker(ctx, x - 1, GROUND_Y - 4, 3, 4, 2);
  pixelText('ФИНИШ', x + 20, GROUND_Y - 84, 8, 'center');
}

function pixelText(str, x, y, size, align) {
  ctx.font = size + 'px "Press Start 2P", monospace';
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.ink;
  ctx.fillText(str, x, y);
}

const pad = (n) => String(n).padStart(5, '0');

function draw() {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  for (const cl of clouds) ctx.drawImage(CLOUD, Math.round(cl.x), cl.y);
  drawGround();
  for (const o of obstacles) (o.type === 'bird' ? drawBird : drawCactus)(o);
  if (goal) drawGoal(goal);
  drawRunner();

  // Счёт: мигает каждые 100 очков
  const showScore = blinkTime === 0 || Math.floor(blinkTime * 8) % 2 === 0;
  const hi = hiScore > 0 ? 'HI ' + pad(hiScore) + '  ' : '';
  if (showScore) pixelText(hi + pad(score), W - 10, 10, 10, 'right');
  else if (hi) pixelText(hi + '     ', W - 10, 10, 10, 'right');

  if (state === 'ready') {
    pixelText('ПРОБЕЛ ИЛИ ТАП — СТАРТ', W / 2, 60, 10, 'center');
    pixelText('↓ — ПРИГНУТЬСЯ', W / 2, 78, 8, 'center');
  } else if (state === 'win') {
    pixelText('ФИНИШ! ' + FINISH_AT, W / 2, 46, 14, 'center');
    if (overTime > 1) pixelText('ПРОБЕЛ ИЛИ ТАП — ЕЩЁ РАЗ', W / 2, 72, 8, 'center');
  } else if (state === 'over') {
    pixelText('G A M E   O V E R', W / 2, 50, 12, 'center');
    if (overTime > 0.5) pixelText('ПРОБЕЛ ИЛИ ТАП — ЕЩЁ РАЗ', W / 2, 74, 8, 'center');
  }
  confetti.draw(ctx);
}

// ---------- Управление ----------
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) jump();
  } else if (e.code === 'ArrowDown') {
    e.preventDefault();
    ducking = true;
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowDown') ducking = false;
});
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jump();
});

reset();
startLoop(update, draw);
