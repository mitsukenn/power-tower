'use strict';

// ============================================================
//  乱数・共通
// ============================================================
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

const between = (rnd, [a, b]) => a + rnd() * (b - a);

// ============================================================
//  移動ルール：通ったエリア（スタート地点＋クリア済みのマス）に隣接するマスにだけ進める
//  隣接 = 同じ塔の1つ上・1つ下の階、または隣の塔の同じ階（柱と橋でつながっている）
//  スタート地点 'home' は 1本目の塔の1階 (0,0) とつながっている
// ============================================================
const cellKey = (t, f) => `${t},${f}`;
const neighborsOf = (t, f) => [[t, f - 1], [t, f + 1], [t - 1, f], [t + 1, f]];

// explored: 通ったエリアのキーの Set（'home' とクリア済みマスの cellKey）
function isReachable(cell, explored) {
  if (cell.t === 0 && cell.f === 0 && explored.has('home')) return true;
  return neighborsOf(cell.t, cell.f).some(([t, f]) => explored.has(cellKey(t, f)));
}

// マスを1つ取ったあとのパワー。負ける（力尽きる）なら null
function applyCell(power, cell) {
  switch (cell.type) {
    case 'monster': return cell.value < power ? power + cell.value : null;
    case 'potion': return power + cell.value;
    case 'double': return power * 2;
    case 'bomb': return Math.max(1, Math.floor(power / 2));
    case 'poison': return power - cell.value > 0 ? power - cell.value : null;
    case 'mystery':
      switch (cell.content) {
        case 'double': return power * 2;
        case 'plus': return power + Math.ceil(power * 0.4);
        case 'bomb': return Math.max(1, Math.floor(power / 2));
        case 'minus': return Math.max(1, power - Math.floor(power * 0.25));
      }
      return power;   // coin
  }
  return power;
}

// ============================================================
//  レベル生成
//  「正解の順番」を先に決めて数値を作り、そのあと塔にシャッフル配置する → 必ずクリア可能
//  正解の順番では 💣は序盤、×2 と ☠ は終盤。逆にすると損をしたり負けたりする
// ============================================================
function generateLevel(lv) {
  const rnd = makeRng(lv * 9973 + 17);
  const nTowers = CONFIG.towers(lv);
  const nFloors = CONFIG.floorsPerTower(lv);
  const total = nTowers * nFloors;

  // 1) 正解の順番でのマスの種類を決める
  const kinds = new Array(total).fill(null);
  kinds[total - 1] = 'boss';
  const placeIn = (kind, count, from, to) => {
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const idx = from + Math.floor(rnd() * (to - from + 1));
        if (idx >= 0 && idx < total - 1 && !kinds[idx]) { kinds[idx] = kind; break; }
      }
    }
  };
  // 💣 はステージのどこにでも。避けて回り道するか、踏んで近道するか
  placeIn('bomb', CONFIG.bombs(lv), 1, Math.max(1, Math.floor(total * 0.8)));
  placeIn('mystery', CONFIG.mysteries(lv), 1, total - 2);
  placeIn('double', CONFIG.doubles(lv), Math.floor(total * 0.55), total - 2);
  placeIn('poison', CONFIG.poisons(lv), Math.floor(total * 0.5), total - 2);
  placeIn('potion', Math.round(total * CONFIG.potionRate), 0, total - 2);

  // 2) 正解の順番どおりに進めながら数値を決める
  const start = CONFIG.startPower;
  let p = start;
  const seq = kinds.map(kind => {
    kind = kind || 'monster';
    if (kind === 'monster' || kind === 'boss') {
      const tough = kind === 'boss' || rnd() < CONFIG.toughRate(lv);
      const range = kind === 'boss' ? CONFIG.bossRatio : tough ? CONFIG.toughRatio(lv) : CONFIG.weakRatio;
      const v = Math.max(1, Math.min(p - 1, Math.round(p * between(rnd, range))));
      p += v;
      return { type: 'monster', value: v, boss: kind === 'boss', tough };
    }
    if (kind === 'potion') {
      const v = Math.max(1, Math.round(p * between(rnd, CONFIG.potionRatio)));
      p += v;
      return { type: 'potion', value: v };
    }
    if (kind === 'mystery') {
      const table = CONFIG.mysteryTable;
      let r = rnd() * table.reduce((s, [, w]) => s + w, 0);
      const content = (table.find(([, w]) => (r -= w) < 0) || table[0])[0];
      const cell = { type: 'mystery', content };
      p = applyCell(p, cell);
      return cell;
    }
    if (kind === 'double') { p *= 2; return { type: 'double' }; }
    if (kind === 'bomb') { p = Math.max(1, Math.floor(p / 2)); return { type: 'bomb' }; }
    // 毒：開始時のパワーでは耐えられない量にして「先に取ると負け」のひっかけにする
    const v = Math.max(start + 2, Math.round(p * between(rnd, CONFIG.poisonRatio)));
    if (v >= p) { const pv = Math.max(1, Math.round(p * 0.2)); p += pv; return { type: 'potion', value: pv }; }
    p -= v;
    return { type: 'poison', value: v };
  });
  const intended = p;

  // 3) 見た目：数字の大きさ（log スケール）で弱い〜強いモンスターを割り当てる
  const maxV = Math.max(...seq.filter(c => c.type === 'monster').map(c => c.value), 2);
  const list = CONFIG.monsters;
  seq.forEach(cell => {
    if (cell.type !== 'monster') return;
    const t = Math.log(Math.max(1, cell.value)) / Math.log(maxV);
    const band = Math.min(list.length - 1, Math.floor(t * list.length));
    const jitter = Math.floor(rnd() * 3) - 1;
    cell.look = list[Math.max(0, Math.min(list.length - 1, band + jitter))];
  });

  seq[total - 1].look = { img: IMG('bosses', worldOf(lv).boss), emoji: '🐉' };

  // 4) 配置：スタートから「通ったエリアに隣接するマス」をランダムに1つずつ広げていった順に置く
  //    → 正解の順番どおりに進めば、いつも隣のマスに行ける（必ずクリア可能）
  //    ボスは最後の塔のてっぺんで、最後に到達するマス
  const bossKey = cellKey(nTowers - 1, nFloors - 1);
  const slots = [];
  for (let t = 0; t < nTowers; t++) for (let f = 0; f < nFloors; f++) slots.push({ t, f });
  const explored = new Set(['home']);
  const towers = Array.from({ length: nTowers }, () => new Array(nFloors));
  for (let i = 0; i < total; i++) {
    const last = i === total - 1;
    const frontier = slots.filter(s => {
      const k = cellKey(s.t, s.f);
      return !explored.has(k) && isReachable(s, explored) && (k !== bossKey || last);
    });
    const s = frontier[Math.floor(rnd() * frontier.length)];
    explored.add(cellKey(s.t, s.f));
    towers[s.t][s.f] = { ...seq[i], t: s.t, f: s.f, cleared: false };
  }
  let id = 0;
  towers.forEach(floors => floors.forEach(c => { c.id = id++; }));
  return { towers, nFloors, intended };
}

// ============================================================
//  そのレベルで出せる最高パワーの目安（★評価に使う）
//  クリア条件は「ボスを倒す」。ほかの部屋は寄り道自由なので、
//  「どこまで寄り道してからボスに挑むか」「どの罠を避けるか」を変えた手順を何百通りか試す
// ============================================================
function bestScore(cells, start, tries = 400) {
  return bestPlan(cells, start, tries).score;
}

// 損をするマス（避けられるなら避けたい）
const isHarmful = c => c.type === 'bomb' || c.type === 'poison'
  || (c.type === 'mystery' && (c.content === 'bomb' || c.content === 'minus'));

// 最高スコアと、そのときの「最初の1手」を返す（負けたときのヒントに使う）
// cells: まだ取っていないマス、explored0: 通ったエリア（省略時はスタート地点だけ）
function bestPlan(cells, start, tries = 400, explored0 = null) {
  const rnd = makeRng(cells.length * 7919 + start);
  const basePri = c => {
    if (c.type === 'mystery') return isHarmful(c) ? 0.5 : 3.5;
    switch (c.type) {
      case 'bomb': return 0;
      case 'monster': case 'potion': return 1;
      case 'double': return 4;
      case 'poison': return 5;
    }
    return 3;
  };
  const boss = cells.find(c => c.boss);
  let best = -1, first = null;
  for (let t = 0; t < tries; t++) {
    const noise = t === 0 ? 0 : rnd() * 3;
    const pri = new Map(cells.map(c => [c, basePri(c) + rnd() * noise]));
    // 半分くらいの手順では、損をするマスを最初から避ける
    const avoid = new Set(t === 0 ? [] : cells.filter(c => isHarmful(c) && rnd() < 0.5));
    let p = start, firstPick = null;
    const left = cells.filter(c => c !== boss && !avoid.has(c));
    const explored = new Set(explored0 || ['home']);
    // 今この時点でボスに挑んだらどうなるか（勝てるなら候補）
    const tryFinish = () => {
      if (!boss || !isReachable(boss, explored)) return;
      const fin = applyCell(p, boss);
      if (fin !== null && fin > best) { best = fin; first = firstPick || boss; }
    };
    tryFinish();
    while (left.length) {
      let pick = -1, pickKey = Infinity;
      left.forEach((c, i) => {
        if (!isReachable(c, explored)) return;                   // まだ行けない
        if (applyCell(p, c) === null) return;                    // 今は取れない
        const key = pri.get(c) + (c.value ? c.value / (p * 10) : 0);
        if (key < pickKey) { pickKey = key; pick = i; }
      });
      if (pick < 0) break;
      if (!firstPick) firstPick = left[pick];
      p = applyCell(p, left[pick]);
      explored.add(cellKey(left[pick].t, left[pick].f));
      left.splice(pick, 1);
      tryFinish();
    }
  }
  return { score: best, first };
}

// ★の数（クリアしていれば最低1）
function starsFor(final, best) {
  if (final >= best * CONFIG.star3) return 3;
  if (final >= best * CONFIG.star2) return 2;
  return 1;
}
