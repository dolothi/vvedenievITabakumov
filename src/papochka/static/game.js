// Flappy Sasha — пиксельный Flappy Bird, где вместо птицы летает голова друга.
// Всё рисуется в низком разрешении 216×384 и растягивается CSS без сглаживания.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;   // 216
const H = canvas.height;  // 384
ctx.imageSmoothingEnabled = false;

// ---------- Палитра (классическая, отдельно от дизайна сайта) ----------
const C = {
  sky: '#4ec0ca',
  cloud: '#eafbd6', cloudShade: '#d4f1c0',
  city: '#a3dbbf', cityDark: '#8acaa8', window: '#cbefd8',
  bush: '#5fcf58', bushDark: '#49b145',
  pipe: '#73bf2e', pipeLight: '#9ce659', pipeShade: '#5fa832', pipeDark: '#558022',
  outline: '#543847',
  grass: '#73bf2e', grassLight: '#9ce659', grassDark: '#558022',
  sand: '#ded895', sandDark: '#d0c874',
  white: '#ffffff', orange: '#e86101', gameOver: '#fca048',
  panel: '#ded895', panelEdge: '#d0c874',
};

// ---------- Настройки (игровые пиксели и секунды) ----------
const GROUND_H = 56;
const GROUND_Y = H - GROUND_H;
const GRAVITY = 900;
const FLAP_SPEED = -275;
const PIPE_SPEED = 80;
const PIPE_W = 40;
const PIPE_GAP = 102;
const PIPE_SPACING = 125;
const CAP_H = 12;
const BIRD_X = 62;
const HIT_R = 12;
const REST_AT = 50;           // после 50-й трубы — платформа для отдыха
const FINISH_AT = 100;        // после 100-й — финиш
const LEDGE_W = 120;
const LEDGE_Y = 196;          // верх платформы

// ---------- Пиксельные крылья (3 кадра) ----------
const WING_FRAMES = [
  [ // вверх
    'oo..............',
    'owoo............',
    'owwwoo..........',
    '.owwwwoo........',
    '.owwwwwwoo......',
    '..owwwwwwwoo....',
    '..owwwwwwwwwo...',
    '...osswwwwwwo...',
    '....ossssswo....',
    '.....oooooo.....',
    '................',
  ],
  [ // середина
    '................',
    '................',
    '...oooooooo.....',
    '..owwwwwwwwoo...',
    '.owwwwwwwwwwwo..',
    'owwwwwwwwwwwwo..',
    'owssswwwwwwwo...',
    '.ossssssssoo....',
    '..oooooooo......',
    '................',
    '................',
  ],
  [ // вниз
    '................',
    '.....oooooo.....',
    '....owwwwwwo....',
    '...owwwwwwwwo...',
    '..owwwwwwwso....',
    '..owwwwwsoo.....',
    '.owwwwsoo.......',
    '.owwsoo.........',
    'owsoo...........',
    'owo.............',
    'oo..............',
  ],
];
const WING_COLORS = { o: C.outline, w: '#ffffff', s: '#d9d9d9' };

const wingSprites = WING_FRAMES.map((rows) => {
  const [c, cx] = makeCanvas(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (WING_COLORS[ch]) {
        cx.fillStyle = WING_COLORS[ch];
        cx.fillRect(x, y, 1, 1);
      }
    });
  });
  return c;
});

// ---------- Фон: заранее рисуем повторяющиеся слои ----------
function rng(seed) { // детерминированный генератор, чтобы фон был всегда одинаковым
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

function blob(cx, x, y, r, color) { // «пиксельный» круг без сглаживания
  cx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt(r * r - dy * dy));
    cx.fillRect(Math.round(x - hw), Math.round(y + dy), hw * 2 + 1, 1);
  }
}

function wrapped(fn, x) { // рисуем элемент так, чтобы слой бесшовно повторялся
  fn(x);
  fn(x - W);
  fn(x + W);
}

const [cloudLayer, cl] = makeCanvas(W, H);
(() => {
  const r = rng(7);
  const base = GROUND_Y - 58;
  for (let x = 0; x < W; x += 16) {
    const rad = 12 + Math.floor(r() * 10);
    wrapped((xx) => blob(cl, xx, base + 4, rad + 2, C.cloudShade), x);
    wrapped((xx) => blob(cl, xx, base, rad, C.cloud), x);
  }
  cl.fillStyle = C.cloud;
  cl.fillRect(0, base, W, GROUND_Y - base);
})();

const [cityLayer, ct] = makeCanvas(W, H);
(() => {
  const r = rng(42);
  const base = GROUND_Y - 6;
  let x = 0;
  while (x < W) {
    const bw = 12 + Math.floor(r() * 14);
    const bh = 18 + Math.floor(r() * 40);
    const color = r() > 0.5 ? C.city : C.cityDark;
    const bx = x;
    wrapped((xx) => {
      ct.fillStyle = color;
      ct.fillRect(xx, base - bh, bw, bh);
      ct.fillStyle = C.window;
      for (let wy = base - bh + 3; wy < base - 4; wy += 4) {
        for (let wx = xx + 2; wx < xx + bw - 2; wx += 3) ct.fillRect(wx, wy, 1, 2);
      }
    }, bx);
    x += bw - 2;
  }
})();

const [bushLayer, bl] = makeCanvas(W, H);
(() => {
  const r = rng(99);
  const base = GROUND_Y + 2;
  for (let x = 0; x < W; x += 13) {
    const rad = 9 + Math.floor(r() * 7);
    wrapped((xx) => blob(bl, xx, base, rad + 1, C.bushDark), x);
    wrapped((xx) => blob(bl, xx, base + 1, rad, C.bush), x);
  }
})();

// Трубы: столбец с затенением слева направо, как в оригинале
function pipeColor(x, w) {
  if (x === 0 || x === w - 1) return C.outline;
  if (x <= 1) return C.pipe;
  if (x <= 5) return C.pipeLight;
  if (x >= w - 3) return C.pipeDark;
  if (x >= w - 8) return C.pipeShade;
  return C.pipe;
}

function drawPipeBody(x, top, bottom) {
  for (let i = 0; i < PIPE_W; i++) {
    ctx.fillStyle = pipeColor(i, PIPE_W);
    ctx.fillRect(x + i, top, 1, bottom - top);
  }
}

function drawPipeCap(x, y) {
  const cw = PIPE_W + 6;
  const cx = x - 3;
  for (let i = 0; i < cw; i++) {
    ctx.fillStyle = pipeColor(i, cw);
    ctx.fillRect(cx + i, y, 1, CAP_H);
  }
  ctx.fillStyle = C.outline;
  ctx.fillRect(cx, y, cw, 1);
  ctx.fillRect(cx, y + CAP_H - 1, cw, 1);
}

// ---------- Звук ----------
const sound = createSound('flappyMuted', {
  flap: (tone, t) => tone(480, t, 0.09, 'square', 0.05, 900),
  score: (tone, t) => {
    tone(880, t, 0.08, 'triangle', 0.12);
    tone(1320, t + 0.08, 0.14, 'triangle', 0.12);
  },
  hit: (tone, t) => tone(220, t, 0.25, 'sawtooth', 0.12, 50),
  die: (tone, t) => tone(500, t + 0.15, 0.4, 'square', 0.05, 90),
  land: (tone, t) => tone(180, t, 0.08, 'triangle', 0.1, 120),
  win: (tone, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.12, 0.18, 'square', 0.06));
    tone(1047, t + 0.5, 0.5, 'triangle', 0.1);
  },
});

// ---------- Состояние ----------
let state = 'ready';          // ready | playing | dying | over | win
let bird, pipes, particles, score, best, isNewBest;
let ledge, goal, spawned;     // платформа отдыха, финиш, сколько труб уже выпущено
let restDone = false;         // платформа уже была
let resting = false;          // стоит на платформе — мир на паузе
let winBurst = 0;
const confetti = createConfetti(W, H);
let scroll = 0;               // общий сдвиг мира для параллакса
let flapTimer = 0;            // сколько ещё показывать «взмах»
let wingTime = 0;
let flash = 0, shake = 0, overTime = 0;

try { best = parseInt(localStorage.getItem('flappyBest'), 10) || 0; } catch (e) { best = 0; }

function reset() {
  bird = { y: GROUND_Y / 2 - 10, vy: 0, angle: 0 };
  pipes = [];
  particles = [];
  ledge = null;
  goal = null;
  spawned = 0;
  restDone = false;
  resting = false;
  score = 0;
  isNewBest = false;
  state = 'ready';
}

function flap() {
  if (state === 'ready') state = 'playing';
  if (state === 'playing') {
    resting = false;
    bird.vy = FLAP_SPEED;
    flapTimer = 0.18;
    wingTime = 0;
    sound('flap');
    for (let i = 0; i < 3; i++) {
      particles.push({
        x: BIRD_X - 14, y: bird.y + 6,
        vx: -30 - Math.random() * 40, vy: 10 + Math.random() * 40,
        life: 0.5,
      });
    }
  } else if ((state === 'over' && overTime > 0.6) || (state === 'win' && overTime > 1)) {
    reset();
  }
}

function crash(hitGround) {
  flash = 1;
  shake = 0.25;
  sound('hit');
  if (hitGround) {
    finish();
  } else {
    state = 'dying';
    bird.vy = Math.max(bird.vy, 0);
    sound('die');
  }
}

function win() {
  state = 'win';
  overTime = 0;
  winBurst = 0;
  sound('win');
  if (score > best) {
    best = score;
    isNewBest = true;
    try { localStorage.setItem('flappyBest', String(best)); } catch (e) { /* ignore */ }
  }
}

function finish() {
  state = 'over';
  overTime = 0;
  if (score > best) {
    best = score;
    isNewBest = true;
    try { localStorage.setItem('flappyBest', String(best)); } catch (e) { /* ignore */ }
  }
}

// ---------- Обновление ----------
function spawnPipe() {
  const margin = 40;
  const minY = margin + PIPE_GAP / 2;
  const maxY = GROUND_Y - margin - PIPE_GAP / 2;
  pipes.push({ x: W + 10, gapY: Math.round(minY + Math.random() * (maxY - minY)), passed: false });
}

// Следующее препятствие: обычно труба, но после REST_AT труб — платформа, после FINISH_AT — финиш
function spawnNext() {
  if (spawned === REST_AT && !restDone) {
    ledge = { x: W + 10 };
    restDone = true;
    return;
  }
  if (spawned === FINISH_AT) goal = { x: W + 10 };
  else spawnPipe();
  spawned++;
}

function lastObstacleX() {
  let x = -Infinity;
  if (pipes.length) x = pipes[pipes.length - 1].x;
  if (ledge) x = Math.max(x, ledge.x + LEDGE_W - PIPE_W);
  if (goal) x = Math.max(x, goal.x);
  return x;
}

function hitsPipe(p) {
  // Круг (голова) против прямоугольников труб, с учётом шапок
  const left = p.x - 3, right = p.x + PIPE_W + 3;
  const cx = Math.max(left, Math.min(BIRD_X, right));
  const top = p.gapY - PIPE_GAP / 2, bottom = p.gapY + PIPE_GAP / 2;
  if (Math.abs(cx - BIRD_X) >= HIT_R) return false;
  const dx = cx - BIRD_X;
  const reach = Math.sqrt(HIT_R * HIT_R - dx * dx);
  return bird.y - reach < top || bird.y + reach > bottom;
}

function update(dt) {
  flash = Math.max(0, flash - dt * 4);
  shake = Math.max(0, shake - dt);
  flapTimer = Math.max(0, flapTimer - dt);
  wingTime += dt;

  for (const pt of particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
  }
  particles = particles.filter((pt) => pt.life > 0);
  confetti.update(dt);

  if (state === 'ready' || (state === 'playing' && !resting)) scroll += PIPE_SPEED * dt;

  if (state === 'win') {
    // Салют из конфетти, голова довольно парит на месте
    overTime += dt;
    winBurst -= dt;
    if (winBurst <= 0) {
      confetti.burst(overTime < 0.1 ? 160 : 50);
      winBurst = 1.4;
    }
    bird.vy = 0;
    bird.angle = 0;
    bird.y += (GROUND_Y / 2 - 10 + Math.sin(performance.now() / 220) * 4 - bird.y) * Math.min(1, dt * 3);
    return;
  }

  if (state === 'ready') {
    bird.y = GROUND_Y / 2 - 10 + Math.sin(performance.now() / 220) * 4;
    bird.angle = 0;
    return;
  }

  if (state === 'over') {
    overTime += dt;
    return;
  }

  // playing и dying: гравитация (на платформе — стоим)
  if (resting) {
    bird.vy = 0;
    bird.y = LEDGE_Y - HIT_R;
    bird.angle = 0;
  } else {
    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    if (bird.vy < 0) bird.angle = -0.35;
    else bird.angle = Math.min(1.35, bird.angle + dt * (bird.vy > 180 ? 4 : 0.8));
  }

  if (bird.y - HIT_R < -20) { bird.y = HIT_R - 20; bird.vy = 0; }

  if (state === 'playing') {
    const move = resting ? 0 : PIPE_SPEED * dt;
    if (spawned <= FINISH_AT && lastObstacleX() < W - PIPE_SPACING) spawnNext();
    for (const p of pipes) {
      p.x -= move;
      if (!p.passed && p.x + PIPE_W < BIRD_X - HIT_R) {
        p.passed = true;
        score++;
        sound('score');
      }
    }
    pipes = pipes.filter((p) => p.x + PIPE_W + 6 > 0);
    if (pipes.some(hitsPipe)) crash(false);

    // Платформа: на неё можно приземлиться сверху и стоять, пока не взмахнёшь
    if (ledge) {
      ledge.x -= move;
      const over = BIRD_X + 6 > ledge.x && BIRD_X - 6 < ledge.x + LEDGE_W;
      const wasAbove = bird.y + HIT_R - bird.vy * dt <= LEDGE_Y + 2;
      if (!resting && over && bird.vy >= 0 && bird.y + HIT_R >= LEDGE_Y && wasAbove) {
        resting = true;
        bird.y = LEDGE_Y - HIT_R;
        bird.vy = 0;
        bird.angle = 0;
        sound('land');
      }
      if (ledge.x + LEDGE_W < -10) ledge = null;
    }

    // Финиш: пересёк клетчатую ленту — победа
    if (goal) {
      goal.x -= move;
      if (goal.x + 6 <= BIRD_X) { win(); return; }
    }
  }

  if (bird.y + HIT_R >= GROUND_Y) {
    bird.y = GROUND_Y - HIT_R;
    if (state === 'playing') crash(true);
    else finish();
  }
}

// ---------- Отрисовка ----------
function drawLayer(layer, speed) {
  const off = Math.floor((scroll * speed) % W);
  ctx.drawImage(layer, -off, 0);
  ctx.drawImage(layer, W - off, 0);
}

function drawGround() {
  const off = Math.floor(scroll % 12);
  ctx.fillStyle = C.outline;
  ctx.fillRect(0, GROUND_Y, W, 1);
  // Полосатая трава
  for (let x = -12; x < W + 12; x += 12) {
    ctx.fillStyle = C.grassLight;
    ctx.fillRect(x - off, GROUND_Y + 1, 6, 5);
    ctx.fillStyle = C.grass;
    ctx.fillRect(x - off + 6, GROUND_Y + 1, 6, 5);
  }
  ctx.fillStyle = C.grassDark;
  ctx.fillRect(0, GROUND_Y + 6, W, 2);
  ctx.fillStyle = C.sand;
  ctx.fillRect(0, GROUND_Y + 8, W, GROUND_H - 8);
  ctx.fillStyle = C.sandDark;
  for (let x = -12; x < W + 12; x += 12) ctx.fillRect(x - off + 3, GROUND_Y + 14, 4, 1);
}

function currentFace() {
  if (state === 'win') return FACES.up;
  if (state === 'dying' || state === 'over') return FACES.down;
  if (flapTimer > 0) return FACES.up;
  if (bird.vy > 230) return FACES.down;
  return FACES.normal;
}

function currentWing() {
  if (state === 'dying' || state === 'over') return wingSprites[1];
  // После взмаха крылья машут быстро, потом медленнее
  const fps = resting ? 3 : state === 'ready' ? 8 : (flapTimer > 0 ? 24 : 10);
  const seq = [0, 1, 2, 1];
  const i = Math.floor(Math.max(0, wingTime) * fps) % seq.length;
  return wingSprites[seq[i]];
}

function drawBird() {
  const face = currentFace();
  ctx.save();
  ctx.translate(BIRD_X, Math.round(bird.y));
  ctx.rotate(bird.angle);
  if (FACES.ready) {
    ctx.drawImage(face, -Math.floor(face.width / 2), -Math.floor(face.height / 2) - 2);
  } else {
    blob(ctx, 0, 0, HIT_R, '#f5c66b');
  }
  ctx.drawImage(currentWing(), -24, -2);
  ctx.restore();
}

function pixelText(str, x, y, size, color, align) {
  ctx.font = size + 'px "Press Start 2P", monospace';
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.outline;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 2], [1, 2]]) {
    ctx.fillText(str, x + dx, y + dy);
  }
  ctx.fillStyle = color || C.white;
  ctx.fillText(str, x, y);
}

function medalFor(s) {
  if (s >= 40) return { name: 'ПЛАТИНА', color: '#e3f4f7', dark: '#a8c9d0' };
  if (s >= 30) return { name: 'ЗОЛОТО', color: '#f7d23c', dark: '#c99b18' };
  if (s >= 20) return { name: 'СЕРЕБРО', color: '#d9d9d9', dark: '#9e9e9e' };
  if (s >= 10) return { name: 'БРОНЗА', color: '#d68b4a', dark: '#9c5a25' };
  return null;
}

function drawPanel() {
  // Панель выезжает снизу
  const t = Math.min(1, Math.max(0, (overTime - 0.25) / 0.35));
  const ease = 1 - Math.pow(1 - t, 3);
  const pw = 176, ph = 92;
  const px = Math.round((W - pw) / 2);
  const py = Math.round(H + 10 - (H + 10 - 150) * ease);

  ctx.fillStyle = C.outline;
  ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
  ctx.fillStyle = C.panelEdge;
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = C.panel;
  ctx.fillRect(px + 3, py + 3, pw - 6, ph - 6);

  pixelText('МЕДАЛЬ', px + 34, py + 10, 8, C.orange, 'center');
  const medal = medalFor(score);
  if (medal) {
    blob(ctx, px + 34, py + 50, 18, medal.dark);
    blob(ctx, px + 34, py + 49, 16, medal.color);
    blob(ctx, px + 34, py + 49, 10, medal.dark);
    blob(ctx, px + 34, py + 48, 9, medal.color);
    ctx.fillStyle = C.white;
    ctx.fillRect(px + 27, py + 41, 3, 2);
    ctx.fillRect(px + 26, py + 43, 2, 2);
  } else {
    blob(ctx, px + 34, py + 49, 16, C.panelEdge);
  }

  pixelText('СЧЁТ', px + pw - 12, py + 10, 8, C.orange, 'right');
  pixelText(String(score), px + pw - 12, py + 22, 16, C.white, 'right');
  pixelText('РЕКОРД', px + pw - 12, py + 48, 8, C.orange, 'right');
  pixelText(String(best), px + pw - 12, py + 60, 16, C.white, 'right');
  if (isNewBest && t >= 1) {
    ctx.fillStyle = '#e8303c';
    ctx.fillRect(px + 68, py + 61, 28, 12);
    pixelText('NEW', px + 82, py + 63, 8, C.white, 'center');
  }
}

// Парящая платформа с травой и табличкой «ОТДЫХ»
function drawLedge(l) {
  const x = Math.round(l.x), y = LEDGE_Y;
  ctx.fillStyle = C.outline;
  ctx.fillRect(x - 1, y - 1, LEDGE_W + 2, 15);
  ctx.fillStyle = C.grassLight;
  ctx.fillRect(x, y, LEDGE_W, 3);
  ctx.fillStyle = C.grass;
  ctx.fillRect(x, y + 3, LEDGE_W, 2);
  ctx.fillStyle = C.sand;
  ctx.fillRect(x, y + 5, LEDGE_W, 8);
  ctx.fillStyle = C.sandDark;
  for (let i = 4; i < LEDGE_W - 4; i += 10) ctx.fillRect(x + i, y + 8, 4, 1);
  pixelText('ОТДЫХ', x + LEDGE_W - 30, y - 22, 8, '#fff6d5');   // правее — голова встаёт у левого края
}

// Финиш: клетчатая лента во всю высоту и красный баннер сверху
function drawGoal(g) {
  const x = Math.round(g.x);
  ctx.fillStyle = C.outline;
  ctx.fillRect(x - 1, 0, 14, GROUND_Y);
  drawChecker(ctx, x, 0, 12, GROUND_Y, 6);
  ctx.fillStyle = C.outline;
  ctx.fillRect(x - 34, 30, 80, 20);
  ctx.fillStyle = '#e8303c';
  ctx.fillRect(x - 33, 31, 78, 18);
  pixelText('ФИНИШ', x + 6, 36, 8, C.white);
}

function draw() {
  ctx.save();
  if (shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 4));

  ctx.fillStyle = C.sky;
  ctx.fillRect(-4, -4, W + 8, H + 8);
  drawLayer(cloudLayer, 0.1);
  drawLayer(cityLayer, 0.25);
  drawLayer(bushLayer, 0.5);

  for (const p of pipes) {
    const x = Math.round(p.x);
    const top = p.gapY - PIPE_GAP / 2;
    const bottom = p.gapY + PIPE_GAP / 2;
    drawPipeBody(x, -4, top - CAP_H);
    drawPipeCap(x, top - CAP_H);
    drawPipeCap(x, bottom);
    drawPipeBody(x, bottom + CAP_H, GROUND_Y);
  }
  if (ledge) drawLedge(ledge);
  if (goal) drawGoal(goal);

  drawGround();

  ctx.fillStyle = C.white;
  for (const pt of particles) ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 2, 2);

  drawBird();
  ctx.restore();

  if (state === 'playing' || state === 'dying') {
    pixelText(String(score), W / 2, 28, 24);
    if (resting) pixelText('ПРОБЕЛ — ЛЕТИМ ДАЛЬШЕ', W / 2, 62, 8);
  } else if (state === 'win') {
    pixelText('ФИНИШ!', W / 2, 96, 24, '#f8d84a');
    drawPanel();
    if (overTime > 1 && Math.floor(overTime * 2) % 2 === 0) pixelText('ТАП — ЕЩЁ РАЗ', W / 2, 262, 8);
  } else if (state === 'ready') {
    pixelText('FLAPPY', W / 2, 52, 24, '#f8d84a');
    pixelText('SASHA', W / 2, 82, 24, '#f8d84a');
    pixelText('ТАП ИЛИ ПРОБЕЛ', W / 2, GROUND_Y - 70, 8);
    if (best > 0) pixelText('РЕКОРД: ' + best, W / 2, GROUND_Y - 54, 8);
  } else if (state === 'over') {
    pixelText('GAME OVER', W / 2, 96, 20, C.gameOver);
    drawPanel();
    if (overTime > 0.6 && Math.floor(overTime * 2) % 2 === 0) {
      pixelText('ТАП — ЕЩЁ РАЗ', W / 2, 262, 8);
    }
  }

  confetti.draw(ctx);

  if (flash > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, ' + flash.toFixed(2) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------- Управление ----------
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) flap();
  }
});
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  flap();
});

reset();
startLoop(update, draw);
