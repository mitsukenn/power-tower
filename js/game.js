'use strict';

// ============================================================
//  ユーティリティ
// ============================================================
const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));

// 大きな数字を短く表示（12345 → 12.3K, 4560000 → 4.56M）
function fmt(n) {
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e4, 'K']];
  for (const [v, s] of units) {
    if (n >= v) return (n / v).toPrecision(3).replace(/\.?0+$/, '') + s;
  }
  return String(n);
}

// ============================================================
//  セーブデータ（ブラウザの localStorage）
// ============================================================
const SAVE_KEY = 'powerTower.v2';

function loadSave() {
  let s = null, old = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* 読めなければ新規 */ }
  if (!s) {
    try { old = JSON.parse(localStorage.getItem('powerTower.v1')); } catch (e) { /* 旧データなし */ }
    s = { unlocked: (old && old.level) || 1 };
  }
  return {
    unlocked: 1, stars: {}, best: {}, coins: 0, muted: false, seen: {},
    ...s,
    up: { power: 0, undo: 0, ...(s.up || {}) },
  };
}

const save = loadSave();
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できない環境では無視 */ }
}

// ============================================================
//  ゲーム状態
// ============================================================
const state = {
  lv: 1,
  start: CONFIG.startPower,  // ショップ強化込みの開始パワー
  power: CONFIG.startPower,
  level: null,
  cells: [],
  best: 0,                   // このレベルで出せる最高パワーの目安（★評価用）
  heroFloorEl: null,
  busy: false,               // 入力を受け付けない（移動中・演出中）
  moving: false,             // ヒーローが移動・戦闘中
  over: false,
  history: [],               // 1手戻す用
  undoLeft: 0,
  evolveIdx: 0,
  justDragged: false,
  introToken: 0,
};

// ============================================================
//  画面の切り替え（title / select / shop / game）
// ============================================================
function showScreen(name) {
  ['title', 'select', 'shop'].forEach(id => $(id).classList.toggle('hidden', id !== name));
  $('app').dataset.screen = name;
  if (name === 'title') renderTitle();
}

// ============================================================
//  レベル開始
// ============================================================
function startLevel(lv) {
  state.lv = lv;
  state.start = CONFIG.startPower + save.up.power * CONFIG.shop.power.add;
  state.power = state.start;
  state.level = generateLevel(lv);
  state.cells = state.level.towers.flat();
  state.best = Math.max(bestScore(state.cells, state.start), 1);
  state.history = [];
  state.undoLeft = CONFIG.undoPerLevel + save.up.undo;
  state.busy = false;
  state.moving = false;
  state.over = false;
  state.evolveIdx = 0;

  showScreen('game');
  $('level').textContent = lv;
  $('world-name').textContent = worldOf(lv).name;
  $('overlay').classList.add('hidden');
  hideTutorial();
  hideTip();
  setBackground(lv);

  const hero = $('hero');
  hero.classList.remove('dying', 'fight');
  setHeroPose('idle');

  buildStage();
  layout();
  buildDecor(lv);
  $('home').classList.remove('cleared');
  state.heroFloorEl = $('home');
  placeHero(state.heroFloorEl, true);
  updatePower();
  updateUndo();
  buildMinimap();
  playIntro().then(ok => { if (ok) showGuides(); });
}

// 背景：ワールドの背景を順番に使う。読み込めたときだけ差し替える
function setBackground(lv) {
  const w = worldOf(lv);
  const src = IMG('backgrounds', w.backgrounds[(lv - 1) % w.backgrounds.length]);
  const probe = new Image();
  probe.onload = () => document.documentElement.style.setProperty('--bg-img', `url("${src}")`);
  probe.onerror = () => document.documentElement.style.setProperty('--bg-img', 'none');
  probe.src = src;
}

function buildStage() {
  const box = $('enemies');
  box.innerHTML = '';
  const towers = state.level.towers;
  towers.forEach((floors, t) => {
    const tower = document.createElement('div');
    tower.className = 'tower';
    floors.forEach((cell, f) => {
      const el = document.createElement('div');
      el.className = 'floor';
      el.appendChild(makeUnit(cell));
      el.addEventListener('click', () => onTap(cell, el));
      Object.assign(cell, { el, t, f });
      tower.appendChild(el);
    });
    // ボスの塔の上には、檻に入ったお姫様
    if (t === towers.length - 1) {
      const cap = document.createElement('div');
      cap.className = 'captive';
      cap.id = 'captive';
      cap.innerHTML = `<img class="princess" src="${IMG('allies', 'princess')}" alt="">
        <img class="cage" src="${IMG('stage', 'cage')}" alt="">`;
      tower.appendChild(cap);
    }
    box.appendChild(tower);
  });
}

// 画像があれば <img>、なければ絵文字
function lookHtml(look) {
  if (!look.img) return `<span class="emoji">${look.emoji}</span>`;
  return `<img class="sprite" src="${look.img}" alt="" draggable="false"
    onerror="this.outerHTML='<span class=&quot;emoji&quot;>${look.emoji}</span>'">`;
}

function makeUnit(cell) {
  const u = document.createElement('div');
  const labels = {
    monster: () => fmt(cell.value),
    potion: () => '+' + fmt(cell.value),
    double: () => '×2',
    bomb: () => '÷2',
    poison: () => '−' + fmt(cell.value),
  };
  const kind = { potion: 'item', double: 'item', bomb: 'trap', poison: 'trap' }[cell.type] || '';
  const look = cell.type === 'monster' ? cell.look : CONFIG.items[cell.type];
  u.className = ['unit', kind, cell.boss ? 'boss' : ''].join(' ').trim();
  u.innerHTML = `${lookHtml(look)}<span class="val">${labels[cell.type]()}</span>`;
  u.style.setProperty('--bob-delay', (-Math.random() * 1.8).toFixed(2) + 's');
  cell.unit = u;
  return u;
}

// ============================================================
//  レイアウト・カメラ（横に広いステージの一部だけを画面に映す）
// ============================================================
function layout() {
  if (!state.level) return;
  const stage = $('stage');
  const avail = stage.clientHeight - 34 - 130 - 20;   // 地面・HUD＋ミニマップ・上の余白を除いた高さ
  const floorH = Math.max(44, Math.min(84, Math.floor(avail / state.level.nFloors) - 6));
  const floorW = Math.max(60, Math.min(96, Math.round(floorH * 1.15)));
  const depth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--depth')) || 0;
  const root = document.documentElement.style;
  root.setProperty('--floor-w', floorW + 'px');
  root.setProperty('--floor-h', floorH + 'px');
  root.setProperty('--tower-gap', Math.round(floorW * 0.45 + depth) + 'px');
  measureWorld();
}

// world 内での要素の中心座標
function worldPos(el) {
  const w = $('world').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - w.left + r.width / 2, y: r.top - w.top + r.height / 2, top: r.top - w.top };
}

function placeHero(floorEl, instant) {
  const hero = $('hero');
  const p = worldPos(floorEl);
  if (instant) hero.style.transition = 'none';
  hero.style.left = p.x + 'px';
  hero.style.top = p.y + 'px';
  if (instant) {
    void hero.offsetWidth; // transition を無効にしたまま位置を確定させる
    hero.style.transition = '';
  }
}

const cam = { x: 0, max: 0, viewW: 0 };

function measureWorld() {
  cam.viewW = $('stage').clientWidth;
  cam.max = Math.max(0, $('world').offsetWidth - cam.viewW);
  // 奥のレイヤーほど幅を狭くし、ゆっくり動かす
  $('bg-far').style.width = (cam.viewW + cam.max * CONFIG.parallaxFar) + 'px';
  $('bg-mid').style.width = (cam.viewW + cam.max * CONFIG.parallaxMid) + 'px';
}

function setCamera(x, ms = 0) {
  cam.x = Math.max(0, Math.min(cam.max, x));
  const t = ms ? `transform ${ms}ms cubic-bezier(.25,.8,.3,1)` : 'none';
  [['world', 1], ['bg-mid', CONFIG.parallaxMid], ['bg-far', CONFIG.parallaxFar]].forEach(([id, k]) => {
    const el = $(id);
    el.style.transition = t;
    el.style.transform = `translateX(${-cam.x * k}px)`;
  });
  updateArrows();
  updateMinimapView(ms);
}

// 指定したマスが画面の左寄り（cameraLead）に来るようにカメラを動かす
function followFloor(floorEl, ms) {
  setCamera(worldPos(floorEl).x - cam.viewW * CONFIG.cameraLead, ms);
}

// 画面の外に残っている敵の方向に矢印を出す
function updateArrows() {
  if (!state.level) return;
  let left = false, right = false;
  state.cells.forEach(c => {
    if (c.cleared || !c.el) return;
    const x = worldPos(c.el).x;
    if (x < cam.x + 20) left = true;
    if (x > cam.x + cam.viewW - 20) right = true;
  });
  $('arrow-left').classList.toggle('hidden', !left);
  $('arrow-right').classList.toggle('hidden', !right);
}

// 中景の飾り（ワールドごとに雲・木・岩・たいまつなど）
function buildDecor(lv) {
  const box = $('bg-mid');
  box.innerHTML = '';
  const rnd = makeRng(lv * 31 + 7);
  const decor = worldOf(lv).decor;
  const width = parseFloat(box.style.width) || cam.viewW;
  for (let x = -40; x < width; x += 90 + rnd() * 110) {
    const kind = decor[Math.floor(rnd() * decor.length)];
    const img = document.createElement('img');
    img.className = 'decor ' + kind.name;
    img.src = IMG('stage', kind.name);
    img.alt = '';
    img.onerror = () => img.remove();
    img.style.width = between(rnd, kind.size) + 'px';
    img.style.left = x + 'px';
    if (kind.sky) img.style.top = (120 + rnd() * 120) + 'px';
    else img.style.bottom = (26 + rnd() * 10) + 'px';
    box.appendChild(img);
  }
}

// レベル開始演出：まずボスの塔（お姫様）を見せてから、ヒーローのところへカメラが戻る
async function playIntro() {
  const token = ++state.introToken;
  if (cam.max <= 0) { setCamera(0); return true; }
  state.busy = true;
  setCamera(cam.max, 0);
  await wait(800);
  if (token !== state.introToken) return false;
  followFloor($('home'), CONFIG.introMs);
  await wait(CONFIG.introMs);
  if (token !== state.introToken) return false;
  state.busy = false;
  return true;
}

// スワイプ・マウスドラッグ・ホイールでステージを見渡す
function setupCameraControls() {
  const st = $('stage');
  let down = false, dragging = false, sx = 0, sc = 0;
  st.addEventListener('pointerdown', e => {
    down = true; dragging = false; sx = e.clientX; sc = cam.x;
  });
  window.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - sx;
    if (!dragging && Math.abs(dx) > 8) { dragging = true; st.classList.add('dragging'); }
    if (dragging) setCamera(sc - dx, 0);
  });
  window.addEventListener('pointerup', () => {
    if (!down) return;
    down = false;
    st.classList.remove('dragging');
    if (dragging) {
      // ドラッグの直後に発生するクリックを「マスをタップした」と扱わない
      state.justDragged = true;
      setTimeout(() => { state.justDragged = false; }, 60);
    }
  });
  st.addEventListener('wheel', e => {
    setCamera(cam.x + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY), 0);
    e.preventDefault();
  }, { passive: false });
  $('arrow-left').addEventListener('click', () => setCamera(cam.x - cam.viewW * 0.75, 450));
  $('arrow-right').addEventListener('click', () => setCamera(cam.x + cam.viewW * 0.75, 450));
}

// ============================================================
//  ミニマップ（ステージ全体の塔と残りのマス、今見えている範囲）
// ============================================================
function buildMinimap() {
  const mm = $('minimap');
  mm.querySelectorAll('.mm-dot').forEach(d => d.remove());
  const worldW = $('world').offsetWidth || 1;
  const scale = mm.clientWidth / worldW;
  const h = mm.clientHeight;
  const nF = state.level.nFloors;
  state.cells.forEach(c => {
    const d = document.createElement('div');
    d.className = 'mm-dot';
    d.style.left = worldPos(c.el).x * scale + 'px';
    d.style.top = (h - 5 - (c.f + 1) * (h - 8) / nF) + 'px';
    mm.appendChild(d);
    c.dot = d;
  });
  const hd = document.createElement('div');
  hd.className = 'mm-dot hero-dot';
  hd.id = 'mm-hero';
  mm.appendChild(hd);
  mm.dataset.scale = scale;
  updateMinimap();
  updateMinimapView(0);
}

function updateMinimap() {
  const mm = $('minimap');
  const scale = +mm.dataset.scale || 0;
  state.cells.forEach(c => {
    if (!c.dot) return;
    let kind = c.type === 'monster' ? (c.value < state.power ? 'weak' : 'strong') : c.type;
    if (c.boss) kind += ' boss';
    c.dot.className = `mm-dot ${kind}${c.cleared ? ' cleared' : ''}`;
  });
  const hd = $('mm-hero');
  if (hd && state.heroFloorEl) {
    hd.style.left = worldPos(state.heroFloorEl).x * scale + 'px';
    hd.style.top = (mm.clientHeight / 2) + 'px';
  }
}

function updateMinimapView(ms) {
  const mm = $('minimap');
  const scale = +mm.dataset.scale || 0;
  const v = $('minimap-view');
  v.style.transition = ms ? `left ${ms}ms ease-out` : 'none';
  v.style.left = cam.x * scale + 'px';
  v.style.width = Math.min(mm.clientWidth, cam.viewW * scale) + 'px';
}

// ============================================================
//  ヒーロー（見た目・進化）
// ============================================================
function evolveTier(power) {
  let idx = 0;
  CONFIG.evolve.forEach(([min], i) => { if (power >= min) idx = i; });
  return idx;
}

// pose: idle（進化段階の見た目）/ attack / victory / damage
function setHeroPose(pose) {
  const img = $('hero-sprite');
  const name = pose === 'idle' ? CONFIG.evolve[state.evolveIdx][1] : pose;
  if (img) img.src = CONFIG.hero(name);
}

async function checkEvolve() {
  const idx = evolveTier(state.power);
  if (idx > state.evolveIdx) {
    state.evolveIdx = idx;
    fxBurst(CONFIG.fx.evolve, state.heroFloorEl, 1.8);
    popText('EVOLVE!', state.heroFloorEl);
    Sound.sfx.evolve();
  } else {
    state.evolveIdx = idx;   // 💣などで弱くなったら見た目も戻る
  }
  setHeroPose('idle');
}

// パワー表示と、数字の色（勝てる=緑 / 勝てない=赤、毒で力尽きる=赤）を更新
function updatePower() {
  $('hero-power').textContent = fmt(state.power);
  state.cells.forEach(cell => {
    if (cell.type === 'monster') cell.unit.classList.toggle('weak', cell.value < state.power);
    if (cell.type === 'poison') cell.unit.classList.toggle('deadly', cell.value >= state.power);
  });
  updateMinimap();
}

// ============================================================
//  演出
// ============================================================
function fxBurst(src, floorEl, scale = 1) {
  if (!src || !floorEl) return;
  const p = worldPos(floorEl);
  const el = document.createElement('img');
  el.className = 'fx';
  el.src = src;
  el.alt = '';
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  el.style.setProperty('--fx-scale', scale);
  el.onerror = () => el.remove();
  $('world').appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function popText(text, floorEl, bad) {
  const p = worldPos(floorEl);
  const el = document.createElement('div');
  el.className = 'pop' + (bad ? ' bad' : '');
  el.textContent = text;
  el.style.left = p.x + 'px';
  el.style.top = p.top + 'px';
  $('world').appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function shakeStage() {
  const st = $('stage');
  st.classList.remove('shake');
  void st.offsetWidth;
  st.classList.add('shake');
}

function confetti() {
  const box = $('confetti');
  const colors = ['#ff5a5a', '#ffd23f', '#4fd46a', '#5b9bff', '#c86bff', '#ff9ad5'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.4 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.setProperty('--drift', (Math.random() * 120 - 60) + 'px');
    box.appendChild(c);
    setTimeout(() => c.remove(), 3500);
  }
}

// 数字をカウントアップ表示
function countUp(el, to, ms) {
  const t0 = performance.now();
  const tick = now => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ============================================================
//  タップ処理
// ============================================================
async function onTap(cell, floorEl) {
  if (state.busy || state.over || cell.cleared || state.justDragged) return;
  hideTutorial();
  state.busy = true;
  state.moving = true;
  state.history.push({ power: state.power, heroFloorEl: state.heroFloorEl, cellId: cell.id, evolveIdx: state.evolveIdx });

  // 遠くのマスほど移動に時間をかけ、カメラも一緒に追いかける
  const hero = $('hero');
  const from = worldPos(state.heroFloorEl), to = worldPos(floorEl);
  const moveMs = Math.round(Math.min(900, Math.max(CONFIG.moveMs, Math.hypot(to.x - from.x, to.y - from.y) * 1.1)));
  hero.style.setProperty('--move-ms', moveMs + 'ms');
  hero.classList.add('jump');
  placeHero(floorEl, false);
  followFloor(floorEl, moveMs);
  Sound.sfx.jump();
  await wait(moveMs);
  hero.classList.remove('jump');

  const after = applyCell(state.power, cell);

  if (cell.type === 'monster') {
    hero.classList.add('fight');
    setHeroPose('attack');
    await wait(CONFIG.fightMs / 2);
    hero.classList.remove('fight');
    if (after === null) return lose(cell);
    cell.unit.classList.add('dying');
    fxBurst(CONFIG.fx.kill, floorEl);
    popText('+' + fmt(cell.value), floorEl);
    Sound.sfx.hit();
  } else if (cell.type === 'poison') {
    fxBurst(CONFIG.fx.poison, floorEl);
    if (after === null) return lose(cell);
    cell.unit.classList.add('dying');
    popText('−' + fmt(cell.value), floorEl, true);
    Sound.sfx.poison();
  } else {
    cell.unit.classList.add('dying');
    const fx = { potion: ['+' + fmt(cell.value || 0), 'potion'], double: ['×2!', 'double'], bomb: ['÷2…', 'bomb'] }[cell.type];
    fxBurst(CONFIG.fx[fx[1]], floorEl, cell.type === 'bomb' ? 1.5 : 1);
    popText(fx[0], floorEl, cell.type === 'bomb');
    Sound.sfx[cell.type]();
    if (cell.type === 'bomb') shakeStage();
  }

  state.power = after;
  hero.classList.remove('grow');
  void hero.offsetWidth;
  hero.classList.add('grow');
  await wait(CONFIG.fightMs / 2);
  cell.cleared = true;
  floorEl.classList.add('cleared');
  $('home').classList.add('cleared');
  state.heroFloorEl = floorEl;
  updatePower();
  await checkEvolve();
  updateArrows();
  state.moving = false;
  updateUndo();

  if (state.cells.every(c => c.cleared)) return win();
  state.busy = false;
}

// ============================================================
//  1手戻す
// ============================================================
function updateUndo() {
  $('undo-count').textContent = state.undoLeft;
  $('undo-btn').disabled = state.undoLeft <= 0 || !state.history.length || state.moving;
}

function undo() {
  if (state.moving || !state.history.length || state.undoLeft <= 0) return;
  const h = state.history.pop();
  state.undoLeft--;
  const cell = state.cells.find(c => c.id === h.cellId);
  if (cell.cleared) {
    cell.cleared = false;
    cell.el.classList.remove('cleared');
    cell.unit.classList.remove('dying');
  }
  state.power = h.power;
  state.heroFloorEl = h.heroFloorEl;
  state.evolveIdx = h.evolveIdx;
  if (state.heroFloorEl === $('home')) $('home').classList.remove('cleared');
  const hero = $('hero');
  hero.classList.remove('dying', 'fight', 'jump');
  placeHero(state.heroFloorEl, true);
  followFloor(state.heroFloorEl, 300);
  state.over = false;
  state.busy = false;
  $('overlay').classList.add('hidden');
  setHeroPose('idle');
  updatePower();
  updateUndo();
  Sound.sfx.undo();
}

// ============================================================
//  クリア / 負け
// ============================================================
function showOverlay({ title, stars = 0, body, buttons }) {
  $('overlay-title').textContent = title;
  $('overlay-body').innerHTML = body;
  const starBox = $('overlay-stars');
  starBox.classList.toggle('hidden', !stars);
  [...starBox.children].forEach((img, i) => {
    img.src = IMG('ui', 'star_empty');
    img.classList.remove('got');
    if (i < stars) setTimeout(() => { img.src = IMG('ui', 'star_gold'); img.classList.add('got'); Sound.sfx.click(); }, 500 + i * 350);
  });
  const btns = $('overlay-btns');
  btns.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = 'panel-btn ' + (b.cls || '');
    el.textContent = b.text;
    el.disabled = !!b.disabled;
    el.onclick = () => { Sound.sfx.click(); b.onClick(); };
    btns.appendChild(el);
  });
  $('overlay').classList.remove('hidden');
}

async function win() {
  state.over = true;
  state.busy = true;
  setHeroPose('victory');
  // お姫様救出
  const cap = $('captive');
  if (cap) {
    followFloor(state.cells[state.cells.length - 1].el, 400);
    cap.classList.add('freed');
    fxBurst(CONFIG.fx.heart, state.cells[state.cells.length - 1].el, 1.6);
  }
  Sound.sfx.win();
  confetti();
  await wait(1100);

  const lv = state.lv;
  const stars = starsFor(state.power, state.best);
  const first = !save.stars[lv];
  const coins = first ? CONFIG.coins(lv, stars) : Math.ceil(CONFIG.coins(lv, stars) / 3);
  save.stars[lv] = Math.max(save.stars[lv] || 0, stars);
  save.best[lv] = Math.max(save.best[lv] || 0, state.power);
  save.unlocked = Math.max(save.unlocked, lv + 1);
  save.coins += coins;
  persist();

  showOverlay({
    title: 'CLEAR!',
    stars,
    body: `最終パワー <b id="final-power">0</b>
      <div class="sub-line">★3の目安 ${fmt(Math.ceil(state.best * CONFIG.star3))}</div>
      <div class="coin-line"><img src="${IMG('items', 'coins')}" alt="">+${coins}</div>`,
    buttons: [
      { text: '次のレベルへ ▶', onClick: () => startLevel(lv + 1) },
      { text: stars < 3 ? 'もう一度（★3を目指す）' : 'もう一度', cls: 'sub', onClick: () => startLevel(lv) },
    ],
  });
  countUp($('final-power'), state.power, 900);
}

async function lose(cell) {
  const hero = $('hero');
  setHeroPose('damage');
  hero.classList.add('dying');
  popText('LOSE', cell.el, true);
  Sound.sfx.lose();
  state.over = true;
  state.moving = false;
  updateUndo();
  await wait(700);

  const body = cell.type === 'poison'
    ? '毒で力尽きた…<br><span class="sub-line">☠ は強くなってから取ろう</span>'
    : `あと <b class="need">${fmt(cell.value - state.power + 1)}</b> パワーで勝てた！<br>
       <span class="sub-line">数字が<span class="weak-text">緑</span>の敵から倒そう。順番がカギ！</span>`;
  showOverlay({
    title: 'おしい！',
    body,
    buttons: [
      { text: `↶ 1手戻す（あと${state.undoLeft}回）`, disabled: state.undoLeft <= 0, onClick: undo },
      { text: '最初から', cls: 'sub', onClick: () => startLevel(state.lv) },
    ],
  });
}

// ============================================================
//  チュートリアル・ヒント
// ============================================================
function showTip(text, ms = 4500) {
  const tip = $('tip');
  tip.innerHTML = text;
  tip.classList.remove('hidden');
  clearTimeout(showTip.timer);
  if (ms) showTip.timer = setTimeout(hideTip, ms);
}
function hideTip() { $('tip').classList.add('hidden'); }

function hideTutorial() {
  const hand = $('tutorial-hand');
  if (!hand.classList.contains('hidden')) hideTip();   // 指さし中のヒントも一緒に消す
  hand.classList.add('hidden');
}

// レベル開始時：初めて出てくる仕掛けの説明、Lv1 は指さしチュートリアル
function showGuides() {
  if (state.lv === 1 && !save.seen.tutorial) {
    const target = state.cells.filter(c => c.type === 'monster' && c.value < state.power)
      .sort((a, b) => a.value - b.value)[0];
    if (target) {
      const hand = $('tutorial-hand');
      $('world').appendChild(hand);
      const p = worldPos(target.el);
      hand.style.left = p.x + 'px';
      hand.style.top = p.y + 'px';
      hand.classList.remove('hidden');
      showTip('自分より<b class="weak-text">弱い敵（緑の数字）</b>をタップして吸収しよう！', 0);
      save.seen.tutorial = true;
      persist();
      return;
    }
  }
  const tips = {
    double: '✨ <b>×2</b> はパワーが2倍！ <b>大きくなってから</b>取るほどお得',
    bomb: '💣 <b>爆弾</b>はパワーが半分に…<b>弱いうちに</b>取れば被害が小さい',
    poison: '☠ <b>毒</b>はパワーが減る。弱いうちに取ると<b>力尽きる</b>ので注意！',
  };
  const fresh = Object.keys(tips).filter(type => !save.seen[type] && state.cells.some(c => c.type === type));
  if (fresh.length) {
    fresh.forEach(type => { save.seen[type] = true; });
    persist();
    showTip(fresh.map(type => tips[type]).join('<br>'), 5000 + fresh.length * 2500);
    return;
  }
  if (state.lv === 2 && !save.seen.stars) {
    save.seen.stars = true;
    persist();
    showTip('最後のパワーが大きいほど <b>★3</b>！ 取る順番を工夫しよう', 5000);
  }
}

// ============================================================
//  タイトル・ステージ選択・ショップ
// ============================================================
function renderTitle() {
  $('start-btn').textContent = `▶ つづきから Lv ${save.unlocked}`;
  $('title-coins').textContent = fmt(save.coins);
}

function renderSelect() {
  const list = $('select-list');
  list.innerHTML = '';
  const maxLv = Math.max(WORLDS.length * LEVELS_PER_WORLD, Math.ceil(save.unlocked / LEVELS_PER_WORLD) * LEVELS_PER_WORLD);
  for (let from = 1; from <= maxLv; from += LEVELS_PER_WORLD) {
    const w = worldOf(from);
    const sec = document.createElement('div');
    sec.className = 'world-sec';
    sec.style.setProperty('--wbg', `url("${IMG('backgrounds', w.backgrounds[0])}")`);
    sec.innerHTML = `<h3>${w.name}<small>Lv ${from}〜${from + LEVELS_PER_WORLD - 1}</small></h3><div class="lv-grid"></div>`;
    const grid = sec.querySelector('.lv-grid');
    for (let lv = from; lv < from + LEVELS_PER_WORLD; lv++) {
      const b = document.createElement('button');
      const locked = lv > save.unlocked;
      const st = save.stars[lv] || 0;
      b.className = 'lv-btn' + (locked ? ' locked' : '') + (lv === save.unlocked ? ' current' : '');
      b.innerHTML = locked ? '🔒' : `${lv}<span class="lv-stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>`;
      b.disabled = locked;
      b.onclick = () => { Sound.sfx.click(); startLevel(lv); };
      grid.appendChild(b);
    }
    list.appendChild(sec);
  }
  ['title', 'shop'].forEach(id => $(id).classList.add('hidden'));
  $('select').classList.remove('hidden');
  $('app').dataset.screen = 'select';
  const cur = list.querySelector('.current');
  if (cur) cur.scrollIntoView({ block: 'center' });
}

function renderShop() {
  $('shop-coins').textContent = fmt(save.coins);
  const items = [
    {
      key: 'power', icon: IMG('hero', 'aura_gold'), name: 'スタートパワー強化',
      desc: n => `開始パワー ${CONFIG.startPower + n * CONFIG.shop.power.add} → ${CONFIG.startPower + (n + 1) * CONFIG.shop.power.add}`,
    },
    {
      key: 'undo', icon: IMG('items', 'hourglass'), name: '1手戻す回数アップ',
      desc: n => `1レベルで ${CONFIG.undoPerLevel + n} → ${CONFIG.undoPerLevel + n + 1} 回`,
    },
  ];
  const list = $('shop-list');
  list.innerHTML = '';
  items.forEach(it => {
    const def = CONFIG.shop[it.key];
    const n = save.up[it.key];
    const maxed = n >= def.max;
    const cost = def.cost(n);
    const card = document.createElement('div');
    card.className = 'shop-card';
    card.innerHTML = `<img src="${it.icon}" alt="">
      <div class="shop-info"><b>${it.name}</b><span>Lv ${n} / ${def.max}</span>
      <small>${maxed ? '最大まで強化済み' : it.desc(n)}</small></div>`;
    const btn = document.createElement('button');
    btn.className = 'buy-btn';
    btn.innerHTML = maxed ? 'MAX' : `<img src="${IMG('items', 'coins')}" alt="">${fmt(cost)}`;
    btn.disabled = maxed || save.coins < cost;
    btn.onclick = () => {
      save.coins -= cost;
      save.up[it.key]++;
      persist();
      Sound.sfx.evolve();
      renderShop();
    };
    card.appendChild(btn);
    list.appendChild(card);
  });
  ['title', 'select'].forEach(id => $(id).classList.add('hidden'));
  $('shop').classList.remove('hidden');
  $('app').dataset.screen = 'shop';
}

function setMuted(m) {
  save.muted = m;
  persist();
  Sound.setMuted(m);
  $('mute-btn').textContent = m ? '🔇' : '🔊';
}

// ============================================================
//  起動
// ============================================================
function init() {
  setupCameraControls();
  setMuted(save.muted);

  // 最初のタップで BGM を開始（ブラウザの自動再生制限のため）
  window.addEventListener('pointerdown', () => Sound.startBgm(), { once: true });

  $('start-btn').onclick = () => { Sound.sfx.click(); startLevel(save.unlocked); };
  $('select-btn').onclick = () => { Sound.sfx.click(); renderSelect(); };
  $('shop-btn').onclick = () => { Sound.sfx.click(); renderShop(); };
  document.querySelectorAll('.back-btn').forEach(b => { b.onclick = () => { Sound.sfx.click(); showScreen('title'); }; });
  $('home-btn').onclick = () => { if (!state.moving) { state.introToken++; showScreen('title'); } };
  $('retry-btn').onclick = () => { if (!state.moving) startLevel(state.lv); };
  $('undo-btn').onclick = undo;
  $('mute-btn').onclick = () => setMuted(!save.muted);
  $('tip').onclick = hideTip;
  $('minimap').addEventListener('click', e => {
    const mm = $('minimap');
    const x = (e.clientX - mm.getBoundingClientRect().left) / (+mm.dataset.scale || 1);
    setCamera(x - cam.viewW / 2, 350);
  });

  window.addEventListener('resize', () => {
    if ($('app').dataset.screen !== 'game' || !state.level) return;
    layout();
    placeHero(state.heroFloorEl, true);
    followFloor(state.heroFloorEl, 0);
    buildMinimap();
  });

  // スマホのホーム画面に追加できるように（オフラインでも遊べる）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 使えなくてもゲームは動く */ });
  }

  // ?lv=5 のように URL で指定するとタイトルを飛ばしてそのレベルから（テスト用）
  const param = parseInt(new URLSearchParams(location.search).get('lv'), 10);
  if (param > 0) startLevel(param);
  else showScreen('title');
}

init();
