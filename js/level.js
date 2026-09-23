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

const between = (rnd, [a, b]) => a + rnd() * (b - a);

// ============================================================
//  移動ルールと通路
//  - 部屋どうしは「橋（隣の塔の同じ階）」と「はしご（同じ塔の上下）」がある所だけつながっている
//  - 進めるのは、通ったエリア（スタート地点 'home' ＋クリア済みの部屋）とつながった部屋だけ
//  - 'home' は 1本目の塔の1階 (0,0) と必ずつながっている
//  edges: つながっている組の Set（edgeKey）。null なら全部つながっている扱い
// ============================================================
const cellKey = (t, f) => `${t},${f}`;
const neighborsOf = (t, f) => [[t, f - 1], [t, f + 1], [t - 1, f], [t + 1, f]];
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// となりのノード（つながっているかは問わない）
function gridNeighbors(k) {
  if (k === 'home') return ['0,0'];
  const [t, f] = k.split(',').map(Number);
  const list = neighborsOf(t, f).map(([a, b]) => cellKey(a, b));
  if (t === 0 && f === 0) list.push('home');
  return list;
}

// 橋・はしごでつながっているとなりのノード
function linkedNeighbors(k, edges) {
  return gridNeighbors(k).filter(n => !edges || edges.has(edgeKey(k, n)));
}

function isReachable(cell, explored, edges) {
  return linkedNeighbors(cellKey(cell.t, cell.f), edges).some(n => explored.has(n));
}

// ============================================================
//  マスの効果
// ============================================================
const isBomb = c => c.type === 'bomb' || (c.type === 'mystery' && c.content === 'bomb');

// マスを1つ取ったあとのパワー（爆風は含まない）。負ける（力尽きる）なら null
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

// 💣の爆風：つながったとなりの部屋にいる敵（ボス以外）を、強さに関係なく吹き飛ばして吸収する
// byKey: まだ取っていないマスの Map（cellKey → cell）
function blastTargets(bomb, byKey, edges) {
  return linkedNeighbors(cellKey(bomb.t, bomb.f), edges)
    .map(k => byKey.get(k))
    .filter(c => c && !c.cleared && c.type === 'monster' && !c.boss);
}

// 爆風込みで1マス取る。{ power, blasted } を返す。負けるなら null
function takeCell(power, cell, byKey, edges) {
  const p = applyCell(power, cell);
  if (p === null) return null;
  if (!isBomb(cell)) return { power: p, blasted: [] };
  const blasted = blastTargets(cell, byKey, edges);
  return { power: p + blasted.reduce((s, c) => s + c.value, 0), blasted };
}

// ============================================================
//  レベル生成
//  1) 通路：塔の中は全部はしごでつながる。塔と塔の間は決まった階にだけ橋（同じ階どうし）
//  2) スタートから通路にそって部屋を1つずつ広げる。広げた順が「正解の順番」（ボスは最後）
//  3) 💣・☠ はボスへの道（幹）に優先して置く → 通らないとボスに届かない場面が生まれる
//  4) 正解の順番どおりに進めながら数値を決める
//  5) 爆風で順番が変わることもあるので、自動で解いてみて解けなければ作り直す
// ============================================================
function generateLevel(lv) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const L = buildLevel(lv, attempt, false);
    if (bestScore(L.towers.flat(), CONFIG.startPower, 80, null, L.edges) > 0) return L;
  }
  return buildLevel(lv, 0, true);   // 念のため：全部の階に橋があるステージ
}

function buildLevel(lv, attempt, allBridges) {
  const rnd = makeRng(lv * 9973 + 17 + attempt * 104729);
  const nTowers = CONFIG.towers(lv);
  const nFloors = CONFIG.floorsPerTower(lv);
  const total = nTowers * nFloors;
  const bossKey = cellKey(nTowers - 1, nFloors - 1);
  const P = levelParams(lv);   // ステージの種類ごとのパラメータ

  // 1) 通路
  const edges = new Set([edgeKey('home', '0,0')]);
  for (let t = 0; t < nTowers; t++) {
    for (let f = 0; f < nFloors - 1; f++) edges.add(edgeKey(cellKey(t, f), cellKey(t, f + 1)));   // はしご
  }
  const nBridges = allBridges ? nFloors : Math.min(nFloors, CONFIG.bridgesPerGap(lv, nFloors));
  for (let t = 0; t < nTowers - 1; t++) {
    // 最後の隙間はてっぺん（ボスの階）に橋を架けない：ボスの塔の他の部屋がボス経由でしか行けなくなるため
    const lastGap = t === nTowers - 2;
    const floors = Array.from({ length: nFloors }, (_, f) => f).filter(f => !(lastGap && f === nFloors - 1 && nFloors > 1));
    for (let i = floors.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [floors[i], floors[j]] = [floors[j], floors[i]];
    }
    floors.slice(0, nBridges).forEach(f => edges.add(edgeKey(cellKey(t, f), cellKey(t + 1, f))));
  }

  // 2) 通路にそって部屋を広げる（ボスは最後）
  const explored = new Set(['home']);
  const parent = new Map();
  const order = [];
  const slots = [];
  for (let t = 0; t < nTowers; t++) for (let f = 0; f < nFloors; f++) slots.push(cellKey(t, f));
  for (let i = 0; i < total; i++) {
    const last = i === total - 1;
    const frontier = slots.filter(k => !explored.has(k) && (k !== bossKey || last)
      && linkedNeighbors(k, edges).some(n => explored.has(n)));
    const k = frontier[Math.floor(rnd() * frontier.length)];
    const from = linkedNeighbors(k, edges).filter(n => explored.has(n));
    parent.set(k, from[Math.floor(rnd() * from.length)]);
    explored.add(k);
    order.push(k);
  }

  // 3) ボスへの道（迷路の幹）に乗っている部屋の、正解の順番での位置
  const onPath = new Set();
  for (let k = parent.get(bossKey); k && k !== 'home'; k = parent.get(k)) onPath.add(order.indexOf(k));

  const kinds = new Array(total).fill(null);
  kinds[total - 1] = 'boss';
  const inRange = (from, to) => i => i >= from && i <= to && i < total - 1 && !kinds[i];
  const placeIn = (kind, count, from, to, preferPath) => {
    for (let n = 0; n < count; n++) {
      const ok = inRange(from, to);
      const pathCand = preferPath ? [...onPath].filter(ok) : [];
      const all = Array.from({ length: total }, (_, i) => i).filter(ok);
      const cand = pathCand.length ? pathCand : all;
      if (cand.length) kinds[cand[Math.floor(rnd() * cand.length)]] = kind;
    }
  };
  placeIn('bomb', P.bombs, 1, Math.floor(total * 0.8), true);
  placeIn('poison', P.poisons, Math.floor(total * 0.5), total - 2, true);
  placeIn('mystery', P.mysteries, 1, total - 2, false);
  placeIn('double', P.doubles, Math.floor(total * 0.55), total - 2, false);
  placeIn('potion', Math.round(total * P.potionRate), 0, total - 2, false);

  // 4) 正解の順番どおりに進めながら数値を決める
  const start = CONFIG.startPower;
  let p = start;
  const seq = kinds.map(kind => {
    kind = kind || 'monster';
    if (kind === 'monster' || kind === 'boss') {
      const tough = kind === 'boss' || rnd() < P.toughRate;
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
      const table = P.mysteryTable;
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

  // 見た目：数字の大きさ（log スケール）で弱い〜強いモンスターを割り当てる
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

  // 配置
  const towers = Array.from({ length: nTowers }, () => new Array(nFloors));
  order.forEach((k, i) => {
    const [t, f] = k.split(',').map(Number);
    towers[t][f] = { ...seq[i], t, f, cleared: false };
  });
  let id = 0;
  towers.forEach(floors => floors.forEach(c => { c.id = id++; }));
  return { towers, nFloors, edges, intended, type: P.type, coinRate: P.coinRate };
}

// ============================================================
//  そのレベルで出せる最高パワーの目安（★評価に使う）
//  クリア条件は「ボスを倒す」。ほかの部屋は寄り道自由なので、
//  「どこまで寄り道してからボスに挑むか」「どの罠を避けるか・💣をどこで使うか」を変えた手順を何百通りか試す
// ============================================================
function bestScore(cells, start, tries = 400, explored0 = null, edges = null) {
  return bestPlan(cells, start, tries, explored0, edges).score;
}

// 損をしやすいマス（避けたり、後回しにしたりする候補）
const isHarmful = c => c.type === 'bomb' || c.type === 'poison'
  || (c.type === 'mystery' && (c.content === 'bomb' || c.content === 'minus'));

// 最高スコアと、そのときの「最初の1手」を返す（負けたときのヒントに使う）
// cells: まだ取っていないマス、explored0: 通ったエリア（省略時はスタート地点だけ）
function bestPlan(cells, start, tries = 400, explored0 = null, edges = null) {
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
  // 速くするため、各マスの「つながったとなり」を先に計算しておく
  const keyOf = new Map(cells.map(c => [c, cellKey(c.t, c.f)]));
  const links = new Map(cells.map(c => [c, linkedNeighbors(keyOf.get(c), edges)]));
  const cellAt = new Map(cells.map(c => [keyOf.get(c), c]));
  const others = cells.filter(c => c !== boss);
  let best = -1, first = null;
  for (let t = 0; t < tries; t++) {
    const noise = t === 0 ? 0 : rnd() * 3;
    const pri = new Map(cells.map(c => [c, basePri(c) + rnd() * noise]));
    // 半分くらいの手順では、損をしやすいマスをなるべく避ける
    const avoid = new Set(t === 0 ? [] : cells.filter(c => isHarmful(c) && rnd() < 0.5));
    let p = start, firstPick = null;
    const taken = new Set();
    const explored = new Set(explored0 || ['home']);
    const reach = c => links.get(c).some(k => explored.has(k));
    // 爆風で巻き込める敵
    const blastOf = c => links.get(c).map(k => cellAt.get(k))
      .filter(n => n && !taken.has(n) && n.type === 'monster' && !n.boss);
    // 今この時点でボスに挑んだらどうなるか（勝てるなら候補）
    const tryFinish = () => {
      if (!boss || !reach(boss)) return;
      const fin = applyCell(p, boss);
      if (fin !== null && fin > best) { best = fin; first = firstPick || boss; }
    };
    const take = c => { taken.add(c); explored.add(keyOf.get(c)); };
    tryFinish();
    for (;;) {
      let pick = null, pickKey = Infinity, pickP = 0, pickBlast = null;
      for (const c of others) {
        if (taken.has(c) || !reach(c)) continue;
        let np = applyCell(p, c);
        if (np === null) continue;                                  // 今は取れない
        let blast = null;
        if (isBomb(c)) { blast = blastOf(c); np += blast.reduce((s, n) => s + n.value, 0); }
        let key = pri.get(c) + (c.value ? c.value / (p * 10) : 0);
        if (avoid.has(c)) key += 100;                               // 避けたいマスは他に無いときだけ
        if (blast && blast.length) key -= 1;                        // 爆風で敵を巻き込めるなら優先
        if (key < pickKey) { pickKey = key; pick = c; pickP = np; pickBlast = blast; }
      }
      if (!pick || (avoid.has(pick) && rnd() < 0.5)) break;
      if (!firstPick) firstPick = pick;
      p = pickP;
      take(pick);
      if (pickBlast) pickBlast.forEach(take);
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
