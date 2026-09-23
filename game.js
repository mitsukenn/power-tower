'use strict';

// ============================================================
//  調整用パラメータ（ブラッシュアップはまずここから）
//  lv は 1 から始まるレベル番号
// ============================================================
const CONFIG = {
  startPower: 10,          // 各レベル開始時のヒーローのパワー
  moveMs: 320,             // ヒーローの移動時間(ms)
  fightMs: 380,            // 戦闘演出の時間(ms)

  // 敵の塔の数と、1本あたりの階数
  towers: lv => Math.min(1 + Math.floor((lv + 1) / 3), 3),
  floorsPerTower: lv => Math.min(2 + Math.floor(lv / 2), 6),

  // 敵の強さ = その時点で到達しうるパワー × [下限, 上限] の割合
  // 上限が 1 に近いほどギリギリの戦いになる
  enemyRatio: lv => {
    const hi = Math.min(0.6 + lv * 0.03, 0.95);
    return [Math.max(0.15, hi - 0.5), hi];
  },

  potionRate: 0.12,              // 回復薬（+N）が出る確率
  potionRatio: [0.2, 0.5],       // 回復薬の量（パワーに対する割合）
  doubleRate: lv => (lv >= 3 ? 0.08 : 0), // ×2 アイテムが出る確率

  monsters: ['👾', '👺', '💀', '🧟', '🦇', '🐺', '👹', '🦂'],
  boss: '🐉',
  potion: '🧪',
  double: '✨',
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
      const emoji = CONFIG.monsters[Math.floor(rnd() * CONFIG.monsters.length)];
      seq.push({ type: 'monster', value: v, emoji });
      p += v;
    }
  }

  // 最後の敵はボスとして最後の塔のてっぺんに置く
  const boss = seq.pop();
  boss.boss = true;
  boss.emoji = CONFIG.boss;
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
  state.over = false;

  $('level').textContent = lv;
  $('overlay').classList.add('hidden');
  const hero = $('hero');
  hero.classList.remove('dying', 'fight');
  hero.style.setProperty('--move-ms', CONFIG.moveMs + 'ms');

  buildStage();
  layout();
  state.heroFloorEl = $('home');
  placeHero(state.heroFloorEl, true);
  updatePower();
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

function makeUnit(cell) {
  const u = document.createElement('div');
  let emoji, label;
  if (cell.type === 'monster') {
    emoji = cell.emoji;
    label = cell.value;
    u.className = 'unit' + (cell.boss ? ' boss' : '');
  } else if (cell.type === 'potion') {
    emoji = CONFIG.potion;
    label = '+' + cell.value;
    u.className = 'unit item';
  } else {
    emoji = CONFIG.double;
    label = '×2';
    u.className = 'unit item';
  }
  u.innerHTML = `<span class="emoji">${emoji}</span><span class="val">${label}</span>`;
  cell.unit = u;
  return u;
}

// 塔の数・階数に合わせてマスの大きさを決める
function layout() {
  if (!state.level) return;
  const stage = $('stage');
  const nT = state.level.towers.length + 1; // 自分の塔を含む
  const w = stage.clientWidth - 24 - 8 * (nT - 1) - nT * 16;
  const h = stage.clientHeight - 70;
  const floorW = Math.max(44, Math.min(96, Math.floor(w / nT)));
  const floorH = Math.max(40, Math.min(80, Math.floor(h / state.level.nFloors) - 4));
  const root = document.documentElement.style;
  root.setProperty('--floor-w', floorW + 'px');
  root.setProperty('--floor-h', floorH + 'px');
}

function placeHero(floorEl, instant) {
  const hero = $('hero');
  const s = $('stage').getBoundingClientRect();
  const r = floorEl.getBoundingClientRect();
  if (instant) hero.style.transition = 'none';
  hero.style.left = (r.left - s.left + r.width / 2) + 'px';
  hero.style.top = (r.top - s.top + r.height / 2) + 'px';
  if (instant) {
    void hero.offsetWidth; // transition を無効にしたまま位置を確定させる
    hero.style.transition = '';
  }
}

// パワー表示と、敵の数字の色（勝てる=緑 / 勝てない=赤）を更新
function updatePower() {
  $('hero-power').textContent = state.power;
  state.level.towers.flat().forEach(cell => {
    if (cell.type === 'monster') {
      cell.unit.classList.toggle('weak', cell.value < state.power);
    }
  });
}

function popText(text, floorEl, bad) {
  const s = $('stage').getBoundingClientRect();
  const r = floorEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'pop' + (bad ? ' bad' : '');
  el.textContent = text;
  el.style.left = (r.left - s.left + r.width / 2) + 'px';
  el.style.top = (r.top - s.top) + 'px';
  $('stage').appendChild(el);
  setTimeout(() => el.remove(), 800);
}

// ============================================================
//  タップ処理
// ============================================================
async function onTap(cell, floorEl) {
  if (state.busy || state.over || cell.cleared) return;
  state.busy = true;

  const hero = $('hero');
  placeHero(floorEl, false);
  beep(440, 60, 'triangle');
  await wait(CONFIG.moveMs);

  if (cell.type === 'monster') {
    hero.classList.add('fight');
    await wait(CONFIG.fightMs / 2);
    hero.classList.remove('fight');

    if (cell.value < state.power) {
      cell.unit.classList.add('dying');
      state.power += cell.value;
      popText('+' + cell.value, floorEl);
      beep(660, 80);
      beep(880, 120);
    } else {
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
    state.power += cell.value;
    popText('+' + cell.value, floorEl);
    beep(780, 120, 'sine', 0.08);
  } else {
    cell.unit.classList.add('dying');
    state.power *= 2;
    popText('×2!', floorEl);
    beep(990, 160, 'sine', 0.08);
  }

  await wait(CONFIG.fightMs / 2);
  cell.cleared = true;
  floorEl.classList.add('cleared');
  $('home').classList.add('cleared');
  state.heroFloorEl = floorEl;
  updatePower();

  if (state.level.towers.flat().every(c => c.cleared)) {
    state.over = true;
    await wait(250);
    showWin();
  }
  state.busy = false;
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
    `最終パワー <b>${state.power}</b><br>最高記録 ${save.best}`,
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
    if (!state.busy) startLevel(state.lv);
  });
  window.addEventListener('resize', () => {
    layout();
    if (state.heroFloorEl) placeHero(state.heroFloorEl, true);
  });

  // ?lv=5 のように URL で開始レベルを指定できる（テスト用）
  const param = parseInt(new URLSearchParams(location.search).get('lv'), 10);
  const saved = loadSave().level || 1;
  startLevel(param > 0 ? param : saved);
}

init();
