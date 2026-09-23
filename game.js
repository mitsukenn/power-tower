'use strict';

// ============================================================
//  調整用パラメータ（ブラッシュアップはまずここから）
//  lv は 1 から始まるレベル番号
// ============================================================
const CONFIG = {
  startPower: 10,          // 各レベル開始時のヒーローのパワー
  moveMs: 320,             // ヒーローの移動時間(ms)
  fightMs: 380,            // 戦闘演出の時間(ms)

  // 敵の塔の数と、1本あたりの階数。ステージは横に広く、カメラで追いかけるので塔は多めでOK
  towers: lv => Math.min(2 + Math.floor(lv / 2), 8),
  floorsPerTower: lv => Math.min(2 + Math.floor(lv / 3), 5),

  // カメラ
  cameraLead: 0.38,        // ヒーローを画面の左から何割の位置に映すか
  parallaxFar: 0.15,       // 遠景（背景画像）の動く速さ（1 = ステージと同じ）
  parallaxMid: 0.5,        // 中景（雲・木など）の動く速さ
  introMs: 1400,           // レベル開始時、ボスからヒーローへカメラが戻る時間

  // 敵の強さ = その時点で到達しうるパワー × [下限, 上限] の割合
  // 上限が 1 に近いほどギリギリの戦いになる
  enemyRatio: lv => {
    const hi = Math.min(0.6 + lv * 0.03, 0.95);
    return [Math.max(0.15, hi - 0.5), hi];
  },

  potionRate: 0.12,              // 回復薬（+N）が出る確率
  potionRatio: [0.2, 0.5],       // 回復薬の量（パワーに対する割合）
  doubleRate: lv => (lv >= 3 ? 0.08 : 0), // ×2 アイテムが出る確率

  // 見た目。画像パスがあれば画像、なければ絵文字で表示する
  // 敵は「弱い → 強い」の順。数字が大きい敵ほど後ろのグループから選ばれる
  monsters: [
    ['slime', '👾'], ['bat', '🦇'], ['mushroom', '🍄'], ['frog', '🐸'], ['pumpkin', '🎃'],
    ['snake', '🐍'], ['cactus', '🌵'], ['goblin', '👺'], ['ghost', '👻'], ['skeleton', '💀'],
    ['zombie', '🧟'], ['snowman', '⛄'], ['wolf', '🐺'], ['spider', '🕷️'], ['mummy', '🧟'],
    ['mimic', '📦'], ['scorpion', '🦂'], ['poison_slime', '👾'], ['imp', '😈'], ['harpy', '🦅'],
    ['gold_bat', '🦇'], ['zombie_dog', '🐕'], ['pirate', '🏴‍☠️'], ['ninja', '🥷'], ['bear', '🐻'],
    ['poison_mushroom', '🍄'], ['oni', '👹'], ['witch', '🧙'], ['orc', '👹'], ['skeleton_mage', '💀'],
    ['shark_man', '🦈'], ['ice_wolf', '🐺'], ['troll', '👹'], ['goblin_king', '👑'], ['gold_scorpion', '🦂'],
    ['fire_spirit', '🔥'], ['thunder_bird', '⚡'], ['blue_oni', '👹'], ['gargoyle', '🗿'], ['yeti', '❄️'],
    ['skeleton_general', '💀'], ['golem', '🗿'], ['robot', '🤖'], ['baby_dragon', '🐲'], ['black_knight', '⚔️'],
  ].map(([name, emoji]) => ({ img: `assets/enemies/${name}.png`, emoji })),
  bosses: ['dragon', 'demon_king', 'giant_golem', 'kraken']
    .map(name => ({ img: `assets/bosses/${name}.png`, emoji: '🐉' })),
  // 背景（レベルごとに順番に切り替わる）。assets/backgrounds に置いたファイル名を並べる
  backgrounds: [
    'meadow_castle', 'sunset_castle', 'night_castle', 'forest', 'desert', 'snow',
    'volcano', 'beach', 'sky', 'cave', 'demon_castle',
  ].map(name => `assets/backgrounds/${name}.jpg`),
  // 中景の飾り（assets/stage のファイル名、大きさ[最小,最大]、空に浮かぶか）
  decor: [
    { name: 'cloud', size: [90, 150], sky: true },
    { name: 'cloud', size: [70, 120], sky: true },
    { name: 'tree', size: [80, 130] },
    { name: 'rock', size: [50, 80] },
    { name: 'torch', size: [30, 44] },
    { name: 'fence', size: [70, 100] },
  ],
  // 演出用エフェクト画像
  fx: {
    kill: 'assets/effects/explosion.png',
    potion: 'assets/effects/heal.png',
    double: 'assets/effects/level_up.png',
  },
  potion: { img: 'assets/items/potion_red.png', emoji: '🧪' },
  double: { img: 'assets/items/star.png', emoji: '✨' },
  hero: {
    idle: 'assets/hero/idle.png',
    attack: 'assets/hero/attack.png',
    victory: 'assets/hero/victory.png',
    damage: 'assets/hero/damage.png',
    emoji: '🦸',
  },
};

const SAVE_KEY = 'powerTower.v1';

// ============================================================
//  ユーティリティ
// ============================================================
const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));

// レベル番号をシードにした乱数（同じレベルは毎回同じ配置になる）
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* 保存できない環境では無視 */ }
}

// ============================================================
//  サウンド（WebAudio の短いビープ音）
// ============================================================
let audioCtx = null;
function beep(freq, ms = 90, type = 'square', vol = 0.05) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000);
  } catch (e) { /* 音が出せない環境では無視 */ }
}

// ============================================================
//  レベル生成
//  「正解の順番」を先に作ってから塔にシャッフル配置するので、必ずクリア可能
// ============================================================
function generateLevel(lv) {
  const rnd = makeRng(lv * 9973 + 17);
  const nTowers = CONFIG.towers(lv);
  const nFloors = CONFIG.floorsPerTower(lv);
  const total = nTowers * nFloors;
  const [lo, hi] = CONFIG.enemyRatio(lv);
  const dRate = CONFIG.doubleRate(lv);

  let p = CONFIG.startPower;
  const seq = [];
  for (let i = 0; i < total; i++) {
    const x = rnd();
    const isLast = i === total - 1;
    if (i > 0 && !isLast && x < dRate) {
      seq.push({ type: 'double' });
      p *= 2;
    } else if (!isLast && x < dRate + CONFIG.potionRate) {
      const [a, b] = CONFIG.potionRatio;
      const v = Math.max(1, Math.round(p * (a + rnd() * (b - a))));
      seq.push({ type: 'potion', value: v });
      p += v;
    } else {
      let v = Math.round(p * (lo + rnd() * (hi - lo)));
      v = Math.max(1, Math.min(p - 1, v));
      seq.push({ type: 'monster', value: v });
      p += v;
    }
  }

  // 敵の見た目：数字の大きさ（log スケール）で弱い〜強いモンスターを割り当てる
  const logMax = Math.log(p);
  const list = CONFIG.monsters;
  seq.forEach(cell => {
    if (cell.type !== 'monster') return;
    const t = Math.log(Math.max(1, cell.value)) / logMax;               // 0〜1
    const band = Math.min(list.length - 1, Math.floor(t * list.length));
    const jitter = Math.floor(rnd() * 3) - 1;                             // 同じ強さでも少しバラける
    cell.look = list[Math.max(0, Math.min(list.length - 1, band + jitter))];
  });

  // 最後の敵はボスとして最後の塔のてっぺんに置く
  const boss = seq.pop();
  boss.boss = true;
  boss.look = CONFIG.bosses[(lv - 1) % CONFIG.bosses.length];
  shuffle(seq, rnd);

  const towers = [];
  let k = 0;
  for (let t = 0; t < nTowers; t++) {
    const floors = [];
    for (let f = 0; f < nFloors; f++) {
      const isBossSlot = t === nTowers - 1 && f === nFloors - 1;
      floors.push({ ...(isBossSlot ? boss : seq[k++]), cleared: false });
    }
    towers.push(floors);
  }
  return { towers, nFloors, maxPower: p };
}

// ============================================================
//  ゲーム状態
// ============================================================
const state = {
  lv: 1,
  power: CONFIG.startPower,
  level: null,
  heroFloorEl: null,
  busy: false,
  over: false,
};

function startLevel(lv) {
  state.lv = lv;
  state.power = CONFIG.startPower;
  state.level = generateLevel(lv);
  state.busy = false;
  state.moving = false;
  state.over = false;

  $('level').textContent = lv;
  setBackground(lv);
  $('overlay').classList.add('hidden');
  const hero = $('hero');
  hero.classList.remove('dying', 'fight');
  setHeroPose('idle');
  hero.style.setProperty('--move-ms', CONFIG.moveMs + 'ms');

  buildStage();
  layout();
  buildDecor(lv);
  $('home').classList.remove('cleared');
  state.heroFloorEl = $('home');
  placeHero(state.heroFloorEl, true);
  updatePower();
  playIntro();
}

// レベル開始演出：まずボスの塔を見せてから、ヒーローのところへカメラが戻る
async function playIntro() {
  const token = state.introToken = (state.introToken || 0) + 1;
  if (cam.max <= 0) { setCamera(0); return; }
  state.busy = true;
  setCamera(cam.max, 0);
  await wait(700);
  if (token !== state.introToken) return;
  followFloor($('home'), CONFIG.introMs);
  await wait(CONFIG.introMs);
  if (token !== state.introToken) return;
  state.busy = false;
}

// 背景画像を読み込めたときだけ差し替える（無ければ空のグラデーションのまま）
function setBackground(lv) {
  const list = CONFIG.backgrounds;
  const src = list[(lv - 1) % list.length];
  const probe = new Image();
  probe.onload = () => document.documentElement.style.setProperty('--bg-img', `url("${src}")`);
  probe.onerror = () => document.documentElement.style.setProperty('--bg-img', 'none');
  probe.src = src;
}

function buildStage() {
  const box = $('enemies');
  box.innerHTML = '';
  state.level.towers.forEach(floors => {
    const tower = document.createElement('div');
    tower.className = 'tower';
    floors.forEach(cell => {
      const el = document.createElement('div');
      el.className = 'floor';
      el.appendChild(makeUnit(cell));
      el.addEventListener('click', () => onTap(cell, el));
      cell.el = el;
      tower.appendChild(el);
    });
    box.appendChild(tower);
  });
}

// 画像があれば <img>、なければ絵文字。画像の読み込みに失敗したら絵文字に戻す
function lookHtml(look) {
  if (look.img) {
    return `<img class="sprite" src="${look.img}" alt="" draggable="false"
      onerror="this.outerHTML='<span class=&quot;emoji&quot;>${look.emoji}</span>'">`;
  }
  return `<span class="emoji">${look.emoji}</span>`;
}

// ヒーローの見た目を切り替える（idle / attack / victory / damage）
function setHeroPose(pose) {
  const img = $('hero-sprite');
  if (img && CONFIG.hero[pose]) img.src = CONFIG.hero[pose];
}

function makeUnit(cell) {
  const u = document.createElement('div');
  let look, label;
  if (cell.type === 'monster') {
    look = cell.look;
    label = fmt(cell.value);
    u.className = 'unit' + (cell.boss ? ' boss' : '');
  } else if (cell.type === 'potion') {
    look = CONFIG.potion;
    label = '+' + fmt(cell.value);
    u.className = 'unit item';
  } else {
    look = CONFIG.double;
    label = '×2';
    u.className = 'unit item';
  }
  u.innerHTML = `${lookHtml(look)}<span class="val">${label}</span>`;
  u.style.setProperty('--bob-delay', (-Math.random() * 1.8).toFixed(2) + 's');
  cell.unit = u;
  return u;
}

// マスの大きさは「画面の高さ」だけで決める（横は広いステージなので詰め込まない）
function layout() {
  if (!state.level) return;
  const stage = $('stage');
  const avail = stage.clientHeight - 34 - 90 - 20;   // 地面・HUD・上の余白を除いた高さ
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

// ============================================================
//  カメラ（横に広いステージの一部だけを画面に映す）
// ============================================================
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
}

// 指定したマスが画面の左寄り（cameraLead）に来るようにカメラを動かす
function followFloor(floorEl, ms) {
  setCamera(worldPos(floorEl).x - cam.viewW * CONFIG.cameraLead, ms);
}

// 画面の外に残っている敵の方向に矢印を出す
function updateArrows() {
  if (!state.level) return;
  let left = false, right = false;
  state.level.towers.flat().forEach(c => {
    if (c.cleared || !c.el) return;
    const x = c.el.offsetParent ? worldPos(c.el).x : 0;
    if (x < cam.x + 20) left = true;
    if (x > cam.x + cam.viewW - 20) right = true;
  });
  $('arrow-left').classList.toggle('hidden', !left);
  $('arrow-right').classList.toggle('hidden', !right);
}

// 中景の飾り（雲・木・岩など）をレベルごとにランダム配置
function buildDecor(lv) {
  const box = $('bg-mid');
  box.innerHTML = '';
  const rnd = makeRng(lv * 31 + 7);
  const width = parseFloat(box.style.width) || cam.viewW;
  for (let x = -40; x < width; x += 90 + rnd() * 110) {
    const kind = CONFIG.decor[Math.floor(rnd() * CONFIG.decor.length)];
    const img = document.createElement('img');
    img.className = 'decor ' + kind.name;
    img.src = `assets/stage/${kind.name}.png`;
    img.alt = '';
    img.onerror = () => img.remove();
    const size = kind.size[0] + rnd() * (kind.size[1] - kind.size[0]);
    img.style.width = size + 'px';
    img.style.left = x + 'px';
    if (kind.sky) img.style.top = (70 + rnd() * 140) + 'px';
    else img.style.bottom = (26 + rnd() * 10) + 'px';
    box.appendChild(img);
  }
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

// 大きな数字を短く表示（12345 → 12.3K, 4560000 → 4.56M）
function fmt(n) {
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e4, 'K']];
  for (const [v, s] of units) {
    if (n >= v) return (n / v).toPrecision(3).replace(/\.?0+$/, '') + s;
  }
  return String(n);
}

// パワー表示と、敵の数字の色（勝てる=緑 / 勝てない=赤）を更新
function updatePower() {
  $('hero-power').textContent = fmt(state.power);
  state.level.towers.flat().forEach(cell => {
    if (cell.type === 'monster') {
      cell.unit.classList.toggle('weak', cell.value < state.power);
    }
  });
}

// エフェクト画像をマスの上に一瞬表示する
function fxBurst(src, floorEl) {
  if (!src) return;
  const p = worldPos(floorEl);
  const el = document.createElement('img');
  el.className = 'fx';
  el.src = src;
  el.alt = '';
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  el.onerror = () => el.remove();
  $('world').appendChild(el);
  setTimeout(() => el.remove(), 600);
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

// ============================================================
//  タップ処理
// ============================================================
async function onTap(cell, floorEl) {
  if (state.busy || state.over || cell.cleared || state.justDragged) return;
  state.busy = true;
  state.moving = true;

  // 遠くのマスほど移動に時間をかけ、カメラも一緒に追いかける
  const hero = $('hero');
  const from = worldPos(state.heroFloorEl), to = worldPos(floorEl);
  const moveMs = Math.round(Math.min(900, Math.max(CONFIG.moveMs, Math.hypot(to.x - from.x, to.y - from.y) * 1.1)));
  hero.style.setProperty('--move-ms', moveMs + 'ms');
  hero.classList.add('jump');
  placeHero(floorEl, false);
  followFloor(floorEl, moveMs);
  beep(440, 60, 'triangle');
  await wait(moveMs);
  hero.classList.remove('jump');

  if (cell.type === 'monster') {
    hero.classList.add('fight');
    setHeroPose('attack');
    await wait(CONFIG.fightMs / 2);
    hero.classList.remove('fight');

    if (cell.value < state.power) {
      cell.unit.classList.add('dying');
      fxBurst(CONFIG.fx.kill, floorEl);
      state.power += cell.value;
      popText('+' + fmt(cell.value), floorEl);
      beep(660, 80);
      beep(880, 120);
    } else {
      setHeroPose('damage');
      hero.classList.add('dying');
      popText('LOSE', floorEl, true);
      beep(160, 400, 'sawtooth');
      state.over = true;
      await wait(700);
      showLose();
      return;
    }
  } else if (cell.type === 'potion') {
    cell.unit.classList.add('dying');
    fxBurst(CONFIG.fx.potion, floorEl);
    state.power += cell.value;
    popText('+' + fmt(cell.value), floorEl);
    beep(780, 120, 'sine', 0.08);
  } else {
    cell.unit.classList.add('dying');
    fxBurst(CONFIG.fx.double, floorEl);
    state.power *= 2;
    popText('×2!', floorEl);
    beep(990, 160, 'sine', 0.08);
  }

  hero.classList.remove('grow');
  void hero.offsetWidth;
  hero.classList.add('grow');
  await wait(CONFIG.fightMs / 2);
  cell.cleared = true;
  floorEl.classList.add('cleared');
  $('home').classList.add('cleared');
  state.heroFloorEl = floorEl;
  updatePower();
  updateArrows();

  setHeroPose('idle');
  if (state.level.towers.flat().every(c => c.cleared)) {
    state.over = true;
    setHeroPose('victory');
    await wait(250);
    showWin();
  }
  state.busy = false;
  state.moving = false;
}

// ============================================================
//  クリア / ゲームオーバー
// ============================================================
function showOverlay(title, body, btnText, onClick) {
  $('overlay-title').textContent = title;
  $('overlay-body').innerHTML = body;
  const btn = $('overlay-btn');
  btn.textContent = btnText;
  btn.onclick = onClick;
  $('overlay').classList.remove('hidden');
}

function showWin() {
  const save = loadSave();
  save.level = Math.max(save.level || 1, state.lv + 1);
  save.best = Math.max(save.best || 0, state.power);
  writeSave(save);
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 140, 'square'), i * 110));
  showOverlay(
    'CLEAR!',
    `最終パワー <b>${fmt(state.power)}</b><br>最高記録 ${fmt(save.best)}`,
    '次のレベルへ',
    () => startLevel(state.lv + 1)
  );
}

function showLose() {
  showOverlay(
    'やられた…',
    '自分より強い敵に挑んでしまった！<br>数字が<span style="color:var(--weak);font-weight:900">緑</span>の敵から倒そう',
    'リトライ',
    () => startLevel(state.lv)
  );
}

// ============================================================
//  起動
// ============================================================
function init() {
  $('retry-btn').addEventListener('click', () => {
    if (!state.moving) startLevel(state.lv);   // 開始演出中でもやり直せる。移動中だけは不可
  });
  setupCameraControls();
  window.addEventListener('resize', () => {
    layout();
    if (state.heroFloorEl) {
      placeHero(state.heroFloorEl, true);
      followFloor(state.heroFloorEl, 0);
    }
  });

  // ?lv=5 のように URL で開始レベルを指定できる（テスト用）
  const param = parseInt(new URLSearchParams(location.search).get('lv'), 10);
  const saved = loadSave().level || 1;
  startLevel(param > 0 ? param : saved);
}

init();
