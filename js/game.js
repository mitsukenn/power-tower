'use strict';

// ============================================================
//  ユーティリティ
// ============================================================
const $ = id => document.getElementById(id);

// 速さ（▶▶ボタン）。演出の待ち時間・アニメーションの長さはすべて sp() で割る
const spd = () => (typeof save !== 'undefined' && save.speed) || 1;
const sp = ms => ms / spd();
const wait = ms => new Promise(r => setTimeout(r, sp(ms)));

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
  state.best = Math.max(bestScore(state.cells, state.start, 300, null, state.level.edges), 1);
  state.history = [];
  state.undoLeft = CONFIG.undoPerLevel + save.up.undo;
  state.busy = false;
  state.moving = false;
  state.over = false;
  state.evolveIdx = 0;
  state.combo = 0;
  state.levelCoins = 0;      // ？ボックスで拾った金貨
  clearQueue();
  state.hintCell = null;

  showScreen('game');
  $('level').textContent = lv;
  $('world-name').textContent = worldOf(lv).name;
  $('overlay').classList.add('hidden');
  hideTutorial();
  hideTip();
  hidePrincessSpeech();
  setBackground(lv);
  applyWorldLook(lv);

  const hero = $('hero');
  hero.classList.remove('dying', 'fight');
  setHeroPose('idle');

  buildStage();
  layout();
  buildBridges();
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

// 塔の壁・屋根・色をワールドに合わせる
function applyWorldLook(lv) {
  const w = worldOf(lv);
  const world = $('world');
  world.style.setProperty('--wall-img', `url("${IMG('stage', w.wall)}")`);
  ['--stone-light', '--stone', '--stone-dark', '--stone-side'].forEach((v, i) => world.style.setProperty(v, w.tint[i]));
}

function buildStage() {
  const box = $('enemies');
  box.innerHTML = '';
  state.cellByKey = new Map();
  $('home').dataset.key = 'home';
  const towers = state.level.towers;
  const w = worldOf(state.lv);
  towers.forEach((floors, t) => {
    const tower = document.createElement('div');
    tower.className = 'tower';
    floors.forEach((cell, f) => {
      const el = document.createElement('div');
      el.className = 'floor';
      el.appendChild(makeUnit(cell));
      el.addEventListener('click', () => onTap(cell, el));
      el.dataset.key = cellKey(t, f);
      Object.assign(cell, { el, t, f });
      state.cellByKey.set(el.dataset.key, cell);
      tower.appendChild(el);
    });
    if (t < towers.length - 1) {
      // ふつうの塔には屋根
      const roof = document.createElement('img');
      roof.className = 'roof';
      roof.src = IMG('stage', w.roof);
      roof.alt = '';
      roof.onerror = () => roof.remove();
      tower.appendChild(roof);
    } else {
      // ボスの塔の上には、檻に入ったお姫様
      const cap = document.createElement('div');
      cap.className = 'captive';
      cap.id = 'captive';
      // 新しいポーズ画像が無いときは元のお姫様の絵を使う
      cap.innerHTML = `<img class="princess" id="princess-img" src="${CONFIG.princess('call')}" alt=""
          onerror="this.onerror=null;this.src='${IMG('allies', 'princess')}'">
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
    mystery: () => '？',
  };
  const kind = { monster: 'mon', potion: 'item', double: 'item', bomb: 'trap', poison: 'trap', mystery: 'mystery' }[cell.type];
  // ワールド最後のレベル（10, 20, …）のボスは特大
  const mega = cell.boss && state.lv % LEVELS_PER_WORLD === 0 ? 'mega' : '';
  u.className = ['unit', kind, cell.boss ? 'boss' : '', mega].join(' ').trim();
  const hp = cell.boss ? '<div class="hpbar"><i></i></div>' : '';
  // ？ボックスは中身を隠して「？」の箱だけ見せる
  const body = cell.type === 'mystery'
    ? '<span class="qbox">?</span>'
    : lookHtml(cell.type === 'monster' ? cell.look : CONFIG.items[cell.type]);
  u.innerHTML = `${hp}${body}<span class="val">${labels[cell.type]()}</span>`;
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
  const depth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--depth')) || 0;
  // 横幅：画面に塔が CONFIG.visibleTowers 本ぐらい見える大きさ
  //   塔1本ぶん = マス幅 + 内側の余白12 + 奥行き + 塔の間隔(マス幅×0.35 + 奥行き)
  const perTower = stage.clientWidth * 0.95 / CONFIG.visibleTowers;
  const widthFit = Math.floor((perTower - 12 - depth * 2) / 1.35);
  // 高さ：階数が少ない序盤はマスを大きくして、画面がスカスカに見えないようにする
  const maxH = state.level.nFloors <= 2 ? 104 : 84;
  const heightFit = Math.max(44, Math.min(maxH, Math.floor(avail / state.level.nFloors) - 6));
  const floorW = Math.max(52, Math.min(112, widthFit, Math.round(heightFit * 1.15)));
  const floorH = Math.max(44, Math.min(heightFit, Math.round(floorW * 1.1)));
  const root = document.documentElement.style;
  root.setProperty('--floor-w', floorW + 'px');
  root.setProperty('--floor-h', floorH + 'px');
  root.setProperty('--tower-gap', Math.round(floorW * 0.35 + depth) + 'px');
  measureWorld();
}

// world 内での要素の中心座標
function worldPos(el) {
  const w = $('world').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - w.left + r.width / 2, y: r.top - w.top + r.height / 2, top: r.top - w.top };
}

// dx: マスの中心から横にずらす量（敵の手前で止まるとき用）
function placeHero(floorEl, instant, dx = 0) {
  const hero = $('hero');
  const p = worldPos(floorEl);
  if (instant) hero.style.transition = 'none';
  hero.style.left = (p.x + dx) + 'px';
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
  $('fg').style.width = (cam.viewW + cam.max * CONFIG.parallaxFg) + 'px';
}

function setCamera(x, ms = 0) {
  cam.x = Math.max(0, Math.min(cam.max, x));
  ms = ms && sp(ms);
  const t = ms ? `transform ${ms}ms cubic-bezier(.25,.8,.3,1)` : 'none';
  [['world', 1], ['bg-mid', CONFIG.parallaxMid], ['bg-far', CONFIG.parallaxFar], ['fg', CONFIG.parallaxFg]].forEach(([id, k]) => {
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

  // 手前の飾り：小さめの岩や柵を地面すれすれに。ステージより速く流れて奥行きが出る
  const fg = $('fg');
  fg.innerHTML = '';
  const fgKinds = worldOf(lv).fg;
  const fgWidth = parseFloat(fg.style.width) || cam.viewW;
  for (let x = rnd() * 120; x < fgWidth; x += 160 + rnd() * 220) {
    const img = document.createElement('img');
    const name = fgKinds[Math.floor(rnd() * fgKinds.length)];
    img.className = 'decor ' + name;
    img.src = IMG('stage', name);
    img.alt = '';
    img.onerror = () => img.remove();
    img.style.width = (name === 'torch' ? 28 : 46 + rnd() * 30) + 'px';
    img.style.left = x + 'px';
    fg.appendChild(img);
  }
}

// ============================================================
//  お姫様：檻の中で「呼ぶ・泣く・祈る」を切り替えて動いて見せる。セリフの吹き出し
// ============================================================
function setPrincessPose(pose) {
  const img = $('princess-img');
  if (img) img.src = CONFIG.princess(pose);
}

function startPrincessLoop() {
  clearInterval(state.princessTimer);
  let i = 0;
  setPrincessPose(CONFIG.princessLoop[0]);
  state.princessTimer = setInterval(() => {
    i = (i + 1) % CONFIG.princessLoop.length;
    setPrincessPose(CONFIG.princessLoop[i]);
  }, CONFIG.princessMs);
}

// 吹き出し：ステージが拡大・縮小しても檻の上に付いていくよう、表示中は毎フレーム位置を合わせる
function princessSay(text, ms) {
  const cap = $('captive');
  if (!cap) return;
  hidePrincessSpeech();
  const bubble = document.createElement('div');
  bubble.className = 'speech';
  bubble.id = 'princess-speech';
  bubble.textContent = text;
  $('stage').appendChild(bubble);
  const follow = () => {
    if (!bubble.isConnected) return;
    const s = $('stage').getBoundingClientRect();
    const r = cap.getBoundingClientRect();
    bubble.style.left = Math.min(s.width - 70, Math.max(70, r.left - s.left + r.width / 2)) + 'px';
    bubble.style.top = Math.max(110, r.top - s.top) + 'px';
    requestAnimationFrame(follow);
  };
  follow();
  if (ms) setTimeout(() => bubble.remove(), sp(ms));
}
function hidePrincessSpeech() { $('princess-speech')?.remove(); }

// レベル開始演出：ステージ全体を見せて、お姫様が「助けて〜！」→ ヒーローのところへカメラが寄る
// 一度クリアしたレベルは短め。タップでスキップできる
async function playIntro() {
  const token = ++state.introToken;
  const replay = !!save.stars[state.lv];
  const world = $('world');
  state.busy = true;
  state.introPlaying = true;
  setCamera(0, 0);
  // 全体が画面に収まるように縮小（地面を基準に）
  const s = Math.min(1, cam.viewW / world.offsetWidth);
  world.style.transition = 'none';
  world.style.transformOrigin = '0 100%';
  world.style.transform = `scale(${s})`;
  startPrincessLoop();
  await wait(replay ? 250 : 500);
  if (token !== state.introToken) return false;
  setPrincessPose('call');
  princessSay('助けて〜！', replay ? 1100 : 2000);
  Sound.sfx.help();
  await wait(replay ? 900 : 1700);
  if (token !== state.introToken) return false;
  startPrincessLoop();
  const ms = replay ? 650 : CONFIG.introMs;
  followFloor($('home'), ms);    // 縮小 → 通常の大きさでヒーローへ
  await wait(ms);
  if (token !== state.introToken) return false;
  state.introPlaying = false;
  state.busy = false;
  return true;
}

function skipIntro() {
  state.introToken++;
  state.introPlaying = false;
  hidePrincessSpeech();
  followFloor($('home'), 250);
  state.busy = false;
  showGuides();
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
  const explored = exploredSet();
  state.cells.forEach(c => {
    if (!c.dot) return;
    let kind = c.type === 'monster' ? (c.value < state.power ? 'weak' : 'strong') : c.type;
    if (c.boss) kind += ' boss';
    if (!c.cleared && !isReachable(c, explored, state.level.edges)) kind += ' far';
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
  updateReach();
  updateMinimap();
}

// ============================================================
//  移動ルール：通ったエリアのとなり（上下の階・橋でつながった隣の塔の同じ階）にだけ進める
// ============================================================
// 通ったエリア（スタート地点＋クリア済みのマス）。extra に移動中のマスを足せる
function exploredSet(extra) {
  const s = new Set(['home']);
  state.cells.forEach(c => { if (c.cleared) s.add(cellKey(c.t, c.f)); });
  if (extra) s.add(cellKey(extra.t, extra.f));
  return s;
}

// 行けるマスは明るく、まだ行けないマスは暗く。通った橋は明るく
function updateReach() {
  const explored = exploredSet();
  state.cells.forEach(c => {
    const open = !c.cleared && isReachable(c, explored, state.level.edges);
    c.el.classList.toggle('open', open);
    c.el.classList.toggle('far', !c.cleared && !open);
  });
  document.querySelectorAll('.bridge, .ladder').forEach(b => {
    b.classList.toggle('used', explored.has(b.dataset.a) && explored.has(b.dataset.b));
  });
}

// 橋・はしごでつながったとなり（'home' は 1本目の塔の1階とつながる）
const nodeNeighbors = k => linkedNeighbors(k, state.level.edges);
const elOfKey = k => (k === 'home' ? $('home') : state.cellByKey.get(k).el);

// ヒーローが今いる場所から、通ったエリアをたどって target の隣まで行く道（通過するマスの要素の配列）
function heroPath(target) {
  const explored = exploredSet();
  const start = state.heroFloorEl.dataset.key;
  const goal = cellKey(target.t, target.f);
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const k = queue.shift();
    if (nodeNeighbors(k).includes(goal)) {
      const path = [];
      for (let x = k; x !== start; x = prev.get(x)) path.unshift(x);
      return path.map(elOfKey);
    }
    nodeNeighbors(k).forEach(n => {
      if (explored.has(n) && !prev.has(n)) { prev.set(n, k); queue.push(n); }
    });
  }
  return [];
}

// 通路を描く：隣の塔の同じ階どうしは「橋」、同じ塔の上下は「はしご」。つながっている所だけ
function buildBridges() {
  const world = $('world');
  world.querySelectorAll('.bridge, .ladder').forEach(b => b.remove());
  const towers = state.level.towers;
  const edges = state.level.edges;
  const depth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--depth')) || 0;
  const w = world.getBoundingClientRect();
  const bridge = (aKey, bKey, aEl, bEl) => {
    if (!edges.has(edgeKey(aKey, bKey))) return;
    const ra = aEl.getBoundingClientRect(), rb = bEl.getBoundingClientRect();
    const left = ra.right - w.left + 6 + depth;
    const br = document.createElement('div');
    br.className = 'bridge';
    br.dataset.a = aKey;
    br.dataset.b = bKey;
    br.style.left = left + 'px';
    br.style.width = Math.max(8, rb.left - w.left - 6 - left) + 'px';
    br.style.top = (ra.bottom - w.top - 12) + 'px';
    world.appendChild(br);
  };
  // はしご：下の部屋の真ん中あたりから上の部屋の真ん中あたりまで、部屋の左端に立てかける
  const ladder = (lower, upper) => {
    const aKey = cellKey(lower.t, lower.f), bKey = cellKey(upper.t, upper.f);
    if (!edges.has(edgeKey(aKey, bKey))) return;
    const rl = lower.el.getBoundingClientRect(), ru = upper.el.getBoundingClientRect();
    const ld = document.createElement('div');
    ld.className = 'ladder';
    ld.dataset.a = aKey;
    ld.dataset.b = bKey;
    ld.style.left = (rl.left - w.left + 3) + 'px';
    ld.style.top = (ru.top - w.top + ru.height * 0.45) + 'px';
    ld.style.height = (rl.top - ru.top) + 'px';
    world.appendChild(ld);
  };
  bridge('home', '0,0', $('home'), towers[0][0].el);
  towers.forEach((floors, t) => floors.forEach((c, f) => {
    if (t < towers.length - 1) bridge(cellKey(t, f), cellKey(t + 1, f), c.el, towers[t + 1][f].el);
    if (f < floors.length - 1) ladder(c, floors[f + 1]);
  }));
}

// まだ行けないマスをタップしたとき
function rejectTap(floorEl) {
  floorEl.classList.remove('nope');
  void floorEl.offsetWidth;
  floorEl.classList.add('nope');
  Sound.sfx.deny();
  showTip('🚧 まだ行けない！ <b>光っている部屋</b>（橋・はしごでつながった先）から進もう', 2200);
}

// ============================================================
//  演出
// ============================================================
function fxBurst(src, floorEl, scale = 1, rotate = 0) {
  if (!src || !floorEl) return;
  const p = worldPos(floorEl);
  const el = document.createElement('img');
  el.className = 'fx';
  el.src = src;
  el.alt = '';
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  el.style.setProperty('--fx-scale', scale);
  el.style.setProperty('--fx-rot', rotate + 'deg');
  el.onerror = () => el.remove();
  $('world').appendChild(el);
  setTimeout(() => el.remove(), sp(700));
}

// style: '' / 'big'（大きな数字）/ 'crit'（CRITICAL!）/ 'combo'
function popText(text, floorEl, bad, style = '') {
  const p = worldPos(floorEl);
  const el = document.createElement('div');
  el.className = ['pop', bad ? 'bad' : '', style].join(' ').trim();
  el.textContent = text;
  el.style.left = p.x + 'px';
  el.style.top = p.top + 'px';
  $('world').appendChild(el);
  setTimeout(() => el.remove(), sp(style ? 1100 : 800));
}

// strength: 'small'（通常ヒット）/ 'big'（強敵・爆弾）
function shakeStage(strength = 'big') {
  const st = $('stage');
  st.classList.remove('shake', 'shake-small');
  void st.offsetWidth;
  st.classList.add(strength === 'small' ? 'shake-small' : 'shake');
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
//  敵を倒す演出：踏み込み斬り → ヒットストップ → 吹き飛び → 光の玉を吸収
// ============================================================
const rand = (a, b) => a + Math.random() * (b - a);

// 火花：中心から放射状に飛び散る小さな光
function sparks(p, count, colors, dist) {
  const world = $('world');
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i');
    s.className = 'spark';
    s.style.left = p.x + 'px';
    s.style.top = p.y + 'px';
    s.style.background = colors[i % colors.length];
    const size = rand(4, 9);
    s.style.width = s.style.height = size + 'px';
    const a = rand(0, Math.PI * 2), d = rand(dist * 0.4, dist);
    world.appendChild(s);
    s.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.2)`, opacity: 0 },
    ], { duration: sp(rand(350, 650)), easing: 'cubic-bezier(.15,.8,.3,1)' }).onfinish = () => s.remove();
  }
}

// 敵の絵を複製して、回転しながら奥へ吹き飛ばす（元の絵は隠す）
function knockOut(cell, power) {
  const src = cell.unit.querySelector('.sprite, .emoji');
  if (!src) return;
  const p = worldPos(src);
  const r = src.getBoundingClientRect();
  const ghost = src.cloneNode(true);
  ghost.className = 'ko-ghost ' + src.className;
  ghost.style.left = p.x + 'px';
  ghost.style.top = p.y + 'px';
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  $('world').appendChild(ghost);
  cell.unit.classList.add('ko');
  const dx = rand(90, 160) * power, dy = -rand(120, 200) * power, spin = rand(360, 720);
  ghost.animate([
    { transform: 'translate(-50%, -50%) rotate(0) scale(1)', filter: 'brightness(4)' },
    { transform: 'translate(calc(-50% + 12px), calc(-50% - 16px)) rotate(25deg) scale(1.15)', filter: 'brightness(1.5)', offset: 0.12 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin}deg) scale(.25)`, filter: 'brightness(1)', opacity: 0 },
  ], { duration: sp(700), easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => ghost.remove();
}

// 倒した敵から光の玉がはじけ出て、ヒーローに吸い込まれる
function absorbOrbs(from, count) {
  const hero = $('hero');
  const to = { x: parseFloat(hero.style.left), y: parseFloat(hero.style.top) - 10 };
  const world = $('world');
  let longest = 0;
  for (let i = 0; i < count; i++) {
    const o = document.createElement('i');
    o.className = 'orb';
    o.style.left = from.x + 'px';
    o.style.top = from.y + 'px';
    world.appendChild(o);
    const bx = rand(-70, 70), by = rand(-90, -20);
    const dur = 430 + i * 30;
    longest = Math.max(longest, dur);
    o.animate([
      { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 },
      { transform: `translate(calc(-50% + ${bx}px), calc(-50% + ${by}px)) scale(1.2)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(.4)`, opacity: .9 },
    ], { duration: sp(dur), easing: 'cubic-bezier(.5,0,.8,.6)' }).onfinish = () => {
      o.remove();
      Sound.sfx.absorb(i);
      hero.classList.remove('absorb');
      void hero.offsetWidth;
      hero.classList.add('absorb');
    };
  }
  return longest;
}

function flashScreen() {
  const f = document.createElement('div');
  f.className = 'flash';
  $('stage').appendChild(f);
  f.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: sp(280), easing: 'ease-out' }).onfinish = () => f.remove();
}

function zoomPunch(strength) {
  $('stage').animate([
    { transform: 'scale(1)' }, { transform: `scale(${1 + strength})` }, { transform: 'scale(1)' },
  ], { duration: sp(320), easing: 'cubic-bezier(.2,.9,.3,1)' });
}

// ボスの HP ゲージ（残り回数 / 全体）
function setBossHp(cell, left) {
  const bar = cell.unit.querySelector('.hpbar i');
  if (bar) bar.style.width = (left / CONFIG.bossHits * 100) + '%';
}

// ボスに近づいたとき：画面が暗くなって WARNING
async function bossWarning(cell) {
  const w = document.createElement('div');
  w.className = 'warning';
  w.innerHTML = '<span>WARNING</span><small>BOSS</small>';
  $('stage').appendChild(w);
  cell.unit.classList.add('enrage');
  Sound.sfx.warning();
  await wait(1000);
  w.remove();
  cell.unit.classList.remove('enrage');
}

// ボスは何回か斬って HP を削る（最後の一撃は killAnimation）
async function bossStrikes(cell, floorEl) {
  const hero = $('hero');
  const center = worldPos(cell.unit.querySelector('.sprite, .emoji') || floorEl);
  for (let hit = 1; hit < CONFIG.bossHits; hit++) {
    setHeroPose('attack');
    hero.classList.remove('lunge');
    void hero.offsetWidth;
    hero.classList.add('lunge');
    Sound.sfx.whoosh();
    await wait(110);
    fxBurst(CONFIG.fx.slash, floorEl, 1.6, hit % 2 ? 25 : -35);
    cell.unit.classList.add('hit', 'recoil');
    shakeStage('small');
    sparks(center, 14, ['#fff', '#ffe066', '#ff7a3b'], 80);
    Sound.sfx.impact();
    setBossHp(cell, CONFIG.bossHits - hit);
    popText(`${hit}/${CONFIG.bossHits}`, floorEl, false, 'combo');
    await wait(130);
    cell.unit.classList.remove('hit');
    hero.classList.remove('lunge');
    await wait(260);
    cell.unit.classList.remove('recoil');
  }
}

async function killAnimation(cell, floorEl) {
  const hero = $('hero');
  // 強敵・ボス、そして「ゲームで最初の1体」は派手なクリティカル演出
  const first = !save.seen.firstKill;
  const big = cell.boss || cell.tough || first;
  if (first) { save.seen.firstKill = true; persist(); }
  if (cell.boss) setBossHp(cell, 0);
  const center = worldPos(cell.unit.querySelector('.sprite, .emoji') || floorEl);
  state.combo = (state.combo || 0) + 1;

  // 1) 踏み込んで斬る
  setHeroPose('attack');
  hero.classList.add('lunge');
  Sound.sfx.whoosh();
  await wait(110);

  // 2) ヒット！ 斬撃・光・揺れ・火花。一瞬止める（ヒットストップ）
  fxBurst(CONFIG.fx.slash, floorEl, big ? 1.9 : 1.4, rand(-30, 20));
  cell.unit.classList.add('hit');
  shakeStage(big ? 'big' : 'small');
  sparks(center, big ? 26 : 14, ['#fff', '#ffe066', '#ffb03b', '#ff7a3b'], big ? 110 : 70);
  if (big) {
    Sound.sfx.critical();
    flashScreen();
    zoomPunch(0.06);
    fxBurst(CONFIG.fx.shockwave, floorEl, 2.2);
    popText(cell.boss ? 'BOSS DOWN!' : 'CRITICAL!', floorEl, false, 'crit');
  } else {
    Sound.sfx.impact();
  }
  await wait(big ? 240 : 110);

  // 3) 吹き飛ぶ＋爆発
  hero.classList.remove('lunge');
  knockOut(cell, big ? 1.4 : 1);
  fxBurst(CONFIG.fx.kill, floorEl, big ? 1.6 : 1.1);
  if (state.combo >= 2) {
    Sound.sfx.combo(Math.min(state.combo, 8));
    popText(`COMBO ×${state.combo}`, floorEl, false, 'combo');
  }
  await wait(120);

  // 4) 光の玉を吸収して、数字がはじける
  const ms = absorbOrbs(center, big ? 10 : 6);
  await wait(ms - 180);   // 最後の玉が届く少し前に次へ（テンポ優先）
  popText('+' + fmt(cell.value), floorEl, false, big ? 'big' : '');
  Sound.sfx.hit();
}

// ============================================================
//  タップ処理
// ============================================================
// マスがタップされたとき：開始演出中ならスキップ、演出中なら「予約」しておく
function onTap(cell, floorEl) {
  if (state.justDragged || state.over || cell.cleared) return;
  if (state.introPlaying) { skipIntro(); return; }
  if (state.busy) {
    // 移動中のマスを取り終えたら行けるマスなら予約できる
    if (state.moving && isReachable(cell, exploredSet(state.pendingCell), state.level.edges)) queueTap(cell, floorEl);
    return;
  }
  if (!isReachable(cell, exploredSet(), state.level.edges)) return rejectTap(floorEl);
  doTap(cell, floorEl);
}

// 先行入力：演出が終わったらすぐ次のマスへ動けるように1つだけ予約できる
function queueTap(cell, floorEl) {
  clearQueue();
  state.queued = { cell, floorEl };
  floorEl.classList.add('queued');
}
function clearQueue() {
  if (state.queued) state.queued.floorEl.classList.remove('queued');
  state.queued = null;
}
function runQueue() {
  const q = state.queued;
  clearQueue();
  if (q && !q.cell.cleared && !state.over && !state.busy && isReachable(q.cell, exploredSet(), state.level.edges)) doTap(q.cell, q.floorEl);
}

async function doTap(cell, floorEl) {
  hideTutorial();
  state.cells.forEach(c => c.el.classList.remove('hinted'));
  state.busy = true;
  state.moving = true;
  state.pendingCell = cell;
  state.history.push({
    power: state.power, heroFloorEl: state.heroFloorEl, cellId: cell.id,
    evolveIdx: state.evolveIdx, levelCoins: state.levelCoins,
  });

  // 通ったエリアをたどって、目的のマスの隣まで歩く
  const hero = $('hero');
  const path = heroPath(cell);
  const hopMs = path.length > 4 ? 90 : 140;
  for (const el of path) {
    hero.style.setProperty('--move-ms', sp(hopMs) + 'ms');
    placeHero(el, false);
    followFloor(el, hopMs);
    await wait(hopMs);
  }

  // 最後のひと跳び。遠いほど時間をかけ、カメラも一緒に追いかける
  const from = worldPos(path.length ? path[path.length - 1] : state.heroFloorEl), to = worldPos(floorEl);
  const moveMs = Math.round(Math.min(900, Math.max(CONFIG.moveMs, Math.hypot(to.x - from.x, to.y - from.y) * 1.1)));
  hero.style.setProperty('--move-ms', sp(moveMs) + 'ms');
  hero.classList.add('jump');
  // 敵のときは手前で止まって斬りかかる
  const standOff = cell.type === 'monster' ? -floorEl.offsetWidth * 0.42 : 0;
  placeHero(floorEl, false, standOff);
  followFloor(floorEl, moveMs);
  Sound.sfx.jump();
  await wait(moveMs);
  hero.classList.remove('jump');

  let after = applyCell(state.power, cell);

  if (cell.type === 'monster') {
    if (cell.boss) await bossWarning(cell);
    if (after === null) {
      hero.classList.add('fight');
      setHeroPose('attack');
      await wait(CONFIG.fightMs / 2);
      hero.classList.remove('fight');
      state.combo = 0;
      return lose(cell);
    }
    if (cell.boss) await bossStrikes(cell, floorEl);
    await killAnimation(cell, floorEl);
  } else if (cell.type === 'poison') {
    state.combo = 0;
    fxBurst(CONFIG.fx.poison, floorEl);
    if (after === null) return lose(cell);
    cell.unit.classList.add('dying');
    popText('−' + fmt(cell.value), floorEl, true);
    Sound.sfx.poison();
  } else if (cell.type === 'mystery') {
    state.combo = 0;
    await openMystery(cell, floorEl);
  } else {
    state.combo = 0;
    cell.unit.classList.add('dying');
    const fx = { potion: ['+' + fmt(cell.value || 0), 'potion'], double: ['×2!', 'double'], bomb: ['÷2…', 'bomb'] }[cell.type];
    fxBurst(CONFIG.fx[fx[1]], floorEl, cell.type === 'bomb' ? 1.5 : 1);
    popText(fx[0], floorEl, cell.type === 'bomb');
    Sound.sfx[cell.type]();
    if (cell.type === 'bomb') shakeStage();
  }

  // 💣の爆風：つながったとなりの敵をまとめて吹き飛ばして吸収
  if (isBomb(cell)) after += await bombBlast(cell, floorEl);

  state.power = after;
  hero.classList.remove('grow');
  void hero.offsetWidth;
  hero.classList.add('grow');
  if (standOff) {
    // 敵がいなくなったマスの中央へ一歩進む
    hero.style.setProperty('--move-ms', sp(160) + 'ms');
    placeHero(floorEl, false);
    await wait(160);
  } else {
    await wait(CONFIG.fightMs / 2);
  }
  cell.cleared = true;
  floorEl.classList.add('cleared');
  $('home').classList.add('cleared');
  state.heroFloorEl = floorEl;
  updatePower();
  await checkEvolve();
  updateArrows();
  state.moving = false;
  updateUndo();

  state.pendingCell = null;
  // ボスを倒したらクリア（ほかの部屋は寄り道自由）
  if (cell.boss) { clearQueue(); return win(); }
  state.busy = false;
  runQueue();
}

// 💣の爆風。巻き込んだ敵の数値の合計を返す（1手戻す用に履歴にも残す）
async function bombBlast(bomb, floorEl) {
  const byKey = new Map(state.cells.filter(c => !c.cleared && c !== bomb).map(c => [cellKey(c.t, c.f), c]));
  const targets = blastTargets(bomb, byKey, state.level.edges);
  state.history[state.history.length - 1].blasted = targets.map(c => c.id);
  if (!targets.length) return 0;
  await wait(250);
  Sound.sfx.critical();
  flashScreen();
  zoomPunch(0.05);
  let sum = 0;
  targets.forEach(c => {
    fxBurst(CONFIG.fx.kill, c.el, 1.6);
    fxBurst(CONFIG.fx.bomb, c.el, 1.3);
    sparks(worldPos(c.el), 18, ['#fff', '#ffb03b', '#ff5a5a', '#c86bff'], 100);
    knockOut(c, 1.5);
    sum += c.value;
    c.cleared = true;
    c.el.classList.add('cleared');
  });
  popText(`BLAST! ×${targets.length}`, floorEl, false, 'crit');
  await wait(300);
  let longest = 0;
  targets.forEach(c => { longest = Math.max(longest, absorbOrbs(worldPos(c.el), 5)); });
  await wait(longest - 150);
  popText('+' + fmt(sum), floorEl, false, 'big');
  Sound.sfx.hit();
  return sum;
}

// ？ボックスを開ける：箱が揺れて、中身が飛び出す
async function openMystery(cell, floorEl) {
  const m = CONFIG.mysteryLook[cell.content];
  const box = cell.unit.querySelector('.qbox');
  box.classList.add('shaking');
  Sound.sfx.jump();
  await wait(420);
  // 中身を見せる
  box.outerHTML = lookHtml(m);
  cell.unit.querySelector('.val').textContent = m.label;
  cell.unit.classList.add('revealed', m.good ? 'good' : 'bad');
  fxBurst(IMG('effects', 'sparkle'), floorEl, 1.6);
  fxBurst(IMG('effects', m.fx), floorEl, 1.4);
  sparks(worldPos(floorEl), 16, m.good ? ['#fff', '#ffe066', '#7fe0ff'] : ['#c86bff', '#ff5a5a', '#333'], 80);
  popText(m.label, floorEl, !m.good, 'big');
  if (cell.content === 'coin') {
    state.levelCoins += CONFIG.mysteryCoins(state.lv);
    Sound.sfx.win();
  } else if (cell.content === 'double') {
    Sound.sfx.double();
  } else if (cell.content === 'plus') {
    Sound.sfx.potion();
  } else if (cell.content === 'bomb') {
    Sound.sfx.bomb();
    shakeStage();
  } else {
    Sound.sfx.poison();
  }
  await wait(650);
  cell.unit.classList.add('dying');
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
    cell.unit.classList.remove('dying', 'ko', 'hit');
    // ？ボックスは箱に戻す
    if (cell.type === 'mystery') cell.el.replaceChild(makeUnit(cell), cell.el.querySelector('.unit'));
  }
  // 爆風で吹き飛ばした敵も元に戻す
  (h.blasted || []).forEach(id => {
    const c = state.cells.find(x => x.id === id);
    c.cleared = false;
    c.el.classList.remove('cleared');
    c.unit.classList.remove('dying', 'ko', 'hit');
  });
  state.levelCoins = h.levelCoins || 0;
  state.combo = 0;
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
  clearQueue();
  Sound.sfx.undo();
  // 負けた直後の「1手戻す」なら、ヒントのマスを光らせる
  if (state.hintCell && !state.hintCell.cleared) {
    state.hintCell.el.classList.add('hinted');
    followFloor(state.hintCell.el, 400);
  }
  state.hintCell = null;
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
    clearInterval(state.princessTimer);
    setPrincessPose('joy');
    cap.classList.add('freed');
    fxBurst(CONFIG.fx.heart, state.cells[state.cells.length - 1].el, 1.6);
    princessSay('ありがとう！', 1600);
  }
  Sound.sfx.win();
  confetti();
  await wait(1100);

  const lv = state.lv;
  const stars = starsFor(state.power, state.best);
  const first = !save.stars[lv];
  // 全部屋を回ってからボスを倒したら PERFECT（金貨ボーナス）
  const perfect = state.cells.every(c => c.cleared);
  let coins = first ? CONFIG.coins(lv, stars) : Math.ceil(CONFIG.coins(lv, stars) / 3);
  if (perfect) coins = Math.ceil(coins * (1 + CONFIG.perfectBonus));
  coins += state.levelCoins;
  save.stars[lv] = Math.max(save.stars[lv] || 0, stars);
  save.best[lv] = Math.max(save.best[lv] || 0, state.power);
  save.unlocked = Math.max(save.unlocked, lv + 1);
  save.coins += coins;
  persist();

  const left = state.cells.filter(c => !c.cleared).length;
  showOverlay({
    title: perfect ? 'PERFECT!' : 'CLEAR!',
    stars,
    body: `最終パワー <b id="final-power">0</b>
      <div class="sub-line">★3の目安 ${fmt(Math.ceil(state.best * CONFIG.star3))}</div>
      <div class="sub-line">${perfect ? '🏆 全部屋制覇！ 金貨ボーナス +50%' : `寄り道していない部屋：${left}`}</div>
      <div class="coin-line"><img src="${IMG('items', 'coins')}" alt="">+${coins}</div>`,
    buttons: [
      { text: '次のレベルへ ▶', onClick: () => startLevel(lv + 1) },
      { text: stars < 3 ? 'もう一度（★3を目指す）' : 'もう一度', cls: 'sub', onClick: () => startLevel(lv) },
    ],
  });
  countUp($('final-power'), state.power, 900);
}

// ヒント用にマスを言葉で説明する
function describeCell(c) {
  switch (c.type) {
    case 'monster': return `「${fmt(c.value)}」の敵`;
    case 'potion': return `回復薬（+${fmt(c.value)}）`;
    case 'double': return '✨×2';
    case 'bomb': return '💣爆弾';
    case 'poison': return `☠毒（−${fmt(c.value)}）`;
    case 'mystery': return '？ボックス';
  }
  return '';
}

async function lose(cell) {
  clearQueue();
  state.pendingCell = null;
  const hero = $('hero');
  setHeroPose('damage');
  hero.classList.add('dying');
  popText('LOSE', cell.el, true);
  Sound.sfx.lose();
  state.over = true;
  state.moving = false;
  updateUndo();
  await wait(700);

  // 今の状態から勝てる手順を探して、最初の1手をヒントにする
  const plan = bestPlan(state.cells.filter(c => !c.cleared), state.power, 250, exploredSet(), state.level.edges);
  state.hintCell = plan.score > 0 ? plan.first : null;
  const hint = state.hintCell
    ? `<div class="hint-line">💡 ヒント：先に <b>${describeCell(state.hintCell)}</b> を取ろう</div>`
    : '<div class="hint-line">💡 この流れからは勝てない…もっと前に戻るか、最初からやり直そう</div>';
  const body = (cell.type === 'poison'
    ? '毒で力尽きた…'
    : `あと <b class="need">${fmt(cell.value - state.power + 1)}</b> パワーで勝てた！`) + hint;
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
    // ヒーローにいちばん近い「倒せる敵」を指さす
    const explored = exploredSet();
    const target = state.cells.filter(c => c.type === 'monster' && c.value < state.power && isReachable(c, explored, state.level.edges))
      .sort((a, b) => worldPos(a.el).x - worldPos(b.el).x || a.value - b.value)[0];
    if (target) {
      const hand = $('tutorial-hand');
      $('world').appendChild(hand);
      const p = worldPos(target.el);
      hand.style.left = p.x + 'px';
      hand.style.top = p.y + 'px';
      hand.classList.remove('hidden');
      if (p.x > cam.x + cam.viewW - 40) setCamera(p.x - cam.viewW * 0.6, 400);   // 画面外なら見える位置へ
      showTip('自分より<b class="weak-text">弱い敵（緑の数字）</b>をタップして吸収しよう！<br>進めるのは<b>光っている部屋</b>（橋・はしごでつながった先）だけ。<b>ボスを倒せばクリア</b>！', 0);
      save.seen.tutorial = true;
      save.seen.rule = true;
      save.seen.goal = true;
      save.seen.maze = true;
      persist();
      return;
    }
  }
  // 以前から遊んでいる人向け：新しい移動ルールのお知らせ（1回だけ）
  if (!save.seen.rule || !save.seen.goal || !save.seen.maze) {
    save.seen.rule = true;
    save.seen.goal = true;
    save.seen.maze = true;
    persist();
    showTip('🌉 <b>新ルール</b>：<b>橋・はしご</b>でつながった部屋にだけ進めるよ。<br>👑 <b>ボスを倒せばクリア</b>！ 寄り道してパワーを集めるほど★が増える', 8000);
    return;
  }
  const tips = {
    double: '✨ <b>×2</b> はパワーが2倍！ <b>大きくなってから</b>取るほどお得',
    bomb: '💣 <b>爆弾</b>はパワーが半分になるけど、<b>つながった隣の敵をまとめて吹き飛ばして吸収</b>！ 強い敵のそばで使おう',
    mystery: '❓ <b>？ボックス</b>は開けるまで中身が分からない！ ×2・パワー・金貨…でも爆弾かも？',
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
  const fresh = !Object.keys(save.stars).length;
  $('start-btn').textContent = fresh ? '▶ はじめる' : `▶ つづきから Lv ${save.unlocked}`;
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

// 速さ切り替え（▶ = 通常、▶▶ = 2倍速）。CSS のアニメーションにも --spd で反映
function setSpeed(s) {
  save.speed = s;
  persist();
  document.documentElement.style.setProperty('--spd', 1 / s);
  const btn = $('speed-btn');
  btn.textContent = s > 1 ? '▶▶' : '▶';
  btn.classList.toggle('on', s > 1);
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
  setSpeed(save.speed || 1);
  $('speed-btn').onclick = () => {
    const list = CONFIG.speeds;
    setSpeed(list[(list.indexOf(save.speed || 1) + 1) % list.length]);
    Sound.sfx.click();
  };

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
    buildBridges();
    updateReach();
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
