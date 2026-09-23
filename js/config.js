'use strict';

// ============================================================
//  調整用パラメータ（ブラッシュアップはまずここから）
//  lv は 1 から始まるレベル番号
// ============================================================
const IMG = (cat, name) => `img/${cat}/${name}.webp`;

const CONFIG = {
  startPower: 10,          // 各レベル開始時のヒーローのパワー（ショップで強化できる）
  moveMs: 320,             // ヒーローの最短移動時間(ms)
  fightMs: 380,            // 戦闘演出の時間(ms)
  undoPerLevel: 3,         // 1レベルで「1手戻す」を使える回数（ショップで増やせる）

  // ---- ステージの広さ ----
  // 序盤（Lv1〜3）は低い塔を3本並べて画面を埋める
  towers: lv => (lv <= 3 ? 3 : Math.min(2 + Math.floor(lv / 3), 7)),
  floorsPerTower: lv => Math.min(2 + Math.floor(lv / 4), 5),

  // 塔と塔の間に架かる橋の数（同じ階どうしだけ）。塔の中ははしごで上下自由
  // 序盤は全部の階に橋 → 2本 → 1本（その階まで登らないと隣の塔へ渡れない）
  bridgesPerGap: (lv, nFloors) => (lv <= 3 ? nFloors : lv <= 12 ? 2 : 1),

  // ---- テンポ ----
  speeds: [1, 2],          // ▶▶ ボタンで切り替える速さ
  bossHits: 3,             // ボスは何回斬って倒すか（演出。勝ち負けの判定は他の敵と同じ）

  // ---- 敵の強さ（その時点のパワーに対する割合） ----
  // ほとんどは弱め、ときどき「ギリギリの強敵」が混ざる → 数字が増えすぎず、競り合いが生まれる
  weakRatio: [0.1, 0.4],
  toughRatio: lv => [0.7, Math.min(0.8 + lv * 0.01, 0.95)],
  toughRate: lv => Math.min(0.15 + lv * 0.01, 0.35),
  bossRatio: [0.85, 0.96],

  // ---- アイテム・罠の出現 ----
  potionRate: 0.1,                 // 回復薬（+N）の割合
  potionRatio: [0.15, 0.35],
  doubles: lv => (lv < 3 ? 0 : Math.min(1 + Math.floor((lv - 3) / 6), 3)),   // ×2 の数（後で取るほど得）
  bombs: lv => (lv < 5 ? 0 : Math.min(1 + Math.floor((lv - 5) / 8), 3)),     // 💣 パワー半分（早めに取ると被害が小さい）
  poisons: lv => (lv < 8 ? 0 : Math.min(1 + Math.floor((lv - 8) / 10), 3)),  // ☠ −N（弱いうちに取ると力尽きる）
  poisonRatio: [0.3, 0.45],

  // ？ボックス：開けるまで中身が分からない部屋。中身はパワーに対する割合で効くので、開けて即負けにはならない
  mysteries: lv => (lv < 4 ? 0 : Math.min(1 + Math.floor((lv - 4) / 6), 4)),
  mysteryTable: [            // [中身, 出やすさ]
    ['double', 2],           // ✨ パワー2倍
    ['plus', 3],             // 💰 パワー +40%
    ['coin', 2],             // 🪙 金貨（パワーは変わらない）
    ['bomb', 2],             // 💣 パワー半分
    ['minus', 2],            // ➖ パワー −25%
  ],
  mysteryCoins: lv => 10 + lv * 3,
  perfectBonus: 0.5,         // 全部屋を回ってからボスを倒すと、金貨 +50%

  // ---- ★評価（そのレベルで出せる最高パワーに対する割合） ----
  star3: 0.95,
  star2: 0.6,

  // ---- ヒーローの進化（パワーがこの値以上で見た目が変わる） ----
  evolve: [
    [0, 'idle'], [100, 'aura_blue'], [1000, 'aura_gold'], [10000, 'armored'], [100000, 'king'],
  ],

  // ---- カメラ ----
  visibleTowers: 3,        // スマホの画面に塔が何本ぐらい見えるようにするか（マスの大きさが決まる）
  cameraLead: 0.38,        // ヒーローを画面の左から何割の位置に映すか
  parallaxFar: 0.15,       // 遠景（背景画像）の動く速さ（1 = ステージと同じ）
  parallaxMid: 0.5,        // 中景（雲・木など）の動く速さ
  parallaxFg: 1.3,         // 手前の飾り（岩・柵）の動く速さ（1より大きい = ステージより速い）
  introMs: 1400,           // レベル開始時、ボスからヒーローへカメラが戻る時間

  // ---- ショップ ----
  shop: {
    power: { max: 10, add: 3, cost: n => 40 * (n + 1) * (n + 1) },  // スタートパワー +3
    undo: { max: 5, cost: n => 80 * (n + 1) },                      // 1手戻す +1回
  },
  coins: (lv, stars) => 5 + lv * 2 + stars * 5,

  // ---- 見た目 ----
  // 敵は「弱い → 強い」の順。数字が大きい敵ほど後ろから選ばれる
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
  ].map(([name, emoji]) => ({ img: IMG('enemies', name), emoji })),

  items: {
    potion: { img: IMG('items', 'potion_red'), emoji: '🧪' },
    double: { img: IMG('items', 'star'), emoji: '✨' },
    bomb: { img: IMG('items', 'bomb'), emoji: '💣' },
    poison: { img: IMG('items', 'poison'), emoji: '☠️' },
  },
  // ？ボックスの中身の見た目と表示
  mysteryLook: {
    double: { img: IMG('items', 'star'), emoji: '✨', label: '×2!', fx: 'level_up', good: true },
    plus: { img: IMG('items', 'coin_bag'), emoji: '💰', label: '+40%', fx: 'heal', good: true },
    coin: { img: IMG('items', 'coins'), emoji: '🪙', label: '金貨!', fx: 'coin_burst', good: true },
    bomb: { img: IMG('items', 'bomb'), emoji: '💣', label: '÷2…', fx: 'pink_explosion', good: false },
    minus: { img: IMG('items', 'poison'), emoji: '➖', label: '−25%', fx: 'poison_smoke', good: false },
  },
  fx: {
    kill: IMG('effects', 'explosion'),
    slash: IMG('effects', 'slash'),
    shockwave: IMG('effects', 'shockwave'),
    potion: IMG('effects', 'heal'),
    double: IMG('effects', 'level_up'),
    bomb: IMG('effects', 'pink_explosion'),
    poison: IMG('effects', 'poison_smoke'),
    evolve: IMG('effects', 'light_pillar'),
    heart: IMG('effects', 'heart'),
    confetti: IMG('effects', 'confetti'),
  },
  hero: name => IMG('hero', name),
  // お姫様：檻の中では call / cry / pray を順に切り替えて動いて見せる。助けたら joy
  princess: pose => IMG('allies', `princess_${pose}`),
  princessLoop: ['call', 'cry', 'pray'],
  princessMs: 1300,
};

// ============================================================
//  ワールド（10レベルごとに景色・飾り・ボスが変わる）
// ============================================================
// wall: 塔の壁の模様（img/stage）、roof: 塔の屋根、tint: 塔の側面・上面の色 [明るい, 普通, 暗い, 側面]
// fg: 手前の飾り（ステージより速く動いて奥行きを出す）
const WORLDS = [
  {
    name: 'はじまりの草原', boss: 'giant_golem',
    wall: 'wall_stone', roof: 'roof_red', tint: ['#b3a288', '#8a7a66', '#5e5245', '#4a3f33'],
    fg: ['rock', 'fence'],
    backgrounds: ['meadow_castle', 'sunset_castle', 'forest'],
    decor: [
      { name: 'cloud', size: [90, 150], sky: true }, { name: 'cloud', size: [70, 120], sky: true },
      { name: 'tree', size: [80, 130] }, { name: 'rock', size: [50, 80] }, { name: 'fence', size: [70, 100] },
    ],
  },
  {
    name: '砂の国と南の海', boss: 'kraken',
    wall: 'wall_wood', roof: 'roof_red', tint: ['#c99a62', '#a0703f', '#6e4a27', '#553820'],
    fg: ['rock', 'fence'],
    backgrounds: ['desert', 'beach'],
    decor: [
      { name: 'cloud', size: [80, 130], sky: true }, { name: 'rock', size: [50, 90] },
      { name: 'rock', size: [40, 70] }, { name: 'torch', size: [30, 44] },
    ],
  },
  {
    name: '氷の国と天空', boss: 'dragon',
    wall: 'wall_ice', roof: 'roof_blue', tint: ['#bfe6ff', '#7fbfe6', '#4d8bb8', '#3a6d93'],
    fg: ['rock'],
    backgrounds: ['snow', 'sky'],
    decor: [
      { name: 'cloud', size: [100, 160], sky: true }, { name: 'cloud', size: [80, 130], sky: true },
      { name: 'rock', size: [50, 80] }, { name: 'tree', size: [70, 110] },
    ],
  },
  {
    name: '地底と火山', boss: 'dragon',
    wall: 'wall_lava', roof: 'roof_red', tint: ['#7a5a52', '#553a34', '#3a2522', '#2a1a18'],
    fg: ['rock'],
    backgrounds: ['cave', 'volcano'],
    decor: [
      { name: 'rock', size: [50, 90] }, { name: 'rock', size: [40, 70] }, { name: 'torch', size: [30, 44] },
    ],
  },
  {
    name: '魔王の城', boss: 'demon_king',
    wall: 'wall_stone', roof: 'roof_blue', tint: ['#8a7fa0', '#5f5578', '#3e3654', '#2d2640'],
    fg: ['rock', 'torch'],
    backgrounds: ['night_castle', 'demon_castle'],
    decor: [
      { name: 'torch', size: [30, 44] }, { name: 'castle_wall', size: [90, 130] }, { name: 'rock', size: [50, 80] },
    ],
  },
];

// ワールドマップの景色の飾り（img/stage のファイル名）
const MAP_DECOR = [
  ['tree', 'tree', 'rock', 'fence', 'flag', 'tree'],
  ['rock', 'torch', 'gate', 'rock', 'fence'],
  ['cloud', 'rock', 'tree', 'cloud', 'flag'],
  ['rock', 'torch', 'rock', 'broken_wall'],
  ['castle_wall', 'torch', 'gate', 'flag', 'broken_wall'],
];

const LEVELS_PER_WORLD = 10;
const worldOf = lv => WORLDS[Math.min(WORLDS.length - 1, Math.floor((lv - 1) / LEVELS_PER_WORLD))];

// ============================================================
//  ステージの種類（進むほど変化をつける）
//  treasure: 宝物庫（ご褒美ステージ）/ boss: ワールドボス / rush: 強敵ラッシュ / dark: 暗闇 / normal
// ============================================================
const STAGE_TYPES = {
  normal: { name: '', icon: '' },
  boss: { name: '👑 ワールドボス', icon: '👑', desc: '特大ボスが待ちかまえている！' },
  treasure: { name: '💎 宝物庫ステージ', icon: '💎', desc: '罠なし！お宝がいっぱい。金貨2倍' },
  rush: { name: '🔥 強敵ラッシュ', icon: '🔥', desc: '強い敵が多い！ 💣の爆風をうまく使おう' },
  dark: { name: '🌑 暗闇ステージ', icon: '🌑', desc: '行ける部屋の先は、近づくまで見えない' },
};

function stageTypeOf(lv) {
  const d = lv % LEVELS_PER_WORLD;
  if (d === 0) return 'boss';
  if (d === 5) return 'treasure';
  if (lv >= 18 && d === 8) return 'rush';
  if (lv >= 15 && (d === 3 || d === 7)) return 'dark';
  return 'normal';
}

// 新しい仕掛けが初めて出るレベル（マップに NEW を出す）
const NEW_AT = { 3: '×2', 4: '？', 5: '💣', 8: '☠', 13: '🌉', 17: '🌑', 18: '🔥' };

// ステージの種類ごとの生成パラメータ（CONFIG の値を上書き）
function levelParams(lv) {
  const type = stageTypeOf(lv);
  const P = {
    type,
    toughRate: CONFIG.toughRate(lv),
    potionRate: CONFIG.potionRate,
    bombs: CONFIG.bombs(lv),
    poisons: CONFIG.poisons(lv),
    doubles: CONFIG.doubles(lv),
    mysteries: CONFIG.mysteries(lv),
    mysteryTable: CONFIG.mysteryTable,
    coinRate: 1,
  };
  if (type === 'treasure') {
    Object.assign(P, {
      toughRate: 0.05, potionRate: 0.3, bombs: 0, poisons: 0,
      doubles: P.doubles + 1, mysteries: P.mysteries + 2,
      mysteryTable: CONFIG.mysteryTable.filter(([c]) => c === 'double' || c === 'plus' || c === 'coin'),
      coinRate: 2,
    });
  }
  if (type === 'rush') Object.assign(P, { toughRate: Math.min(0.6, P.toughRate + 0.25), bombs: P.bombs + 1 });
  return P;
}
