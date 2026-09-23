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
  towers: lv => Math.min(2 + Math.floor(lv / 3), 7),
  floorsPerTower: lv => Math.min(2 + Math.floor(lv / 4), 5),

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

  // ---- ★評価（そのレベルで出せる最高パワーに対する割合） ----
  star3: 0.95,
  star2: 0.6,

  // ---- ヒーローの進化（パワーがこの値以上で見た目が変わる） ----
  evolve: [
    [0, 'idle'], [100, 'aura_blue'], [1000, 'aura_gold'], [10000, 'armored'], [100000, 'king'],
  ],

  // ---- カメラ ----
  cameraLead: 0.38,        // ヒーローを画面の左から何割の位置に映すか
  parallaxFar: 0.15,       // 遠景（背景画像）の動く速さ（1 = ステージと同じ）
  parallaxMid: 0.5,        // 中景（雲・木など）の動く速さ
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
  fx: {
    kill: IMG('effects', 'explosion'),
    potion: IMG('effects', 'heal'),
    double: IMG('effects', 'level_up'),
    bomb: IMG('effects', 'pink_explosion'),
    poison: IMG('effects', 'poison_smoke'),
    evolve: IMG('effects', 'light_pillar'),
    heart: IMG('effects', 'heart'),
    confetti: IMG('effects', 'confetti'),
  },
  hero: name => IMG('hero', name),
};

// ============================================================
//  ワールド（10レベルごとに景色・飾り・ボスが変わる）
// ============================================================
const WORLDS = [
  {
    name: 'はじまりの草原', boss: 'giant_golem',
    backgrounds: ['meadow_castle', 'sunset_castle', 'forest'],
    decor: [
      { name: 'cloud', size: [90, 150], sky: true }, { name: 'cloud', size: [70, 120], sky: true },
      { name: 'tree', size: [80, 130] }, { name: 'rock', size: [50, 80] }, { name: 'fence', size: [70, 100] },
    ],
  },
  {
    name: '砂の国と南の海', boss: 'kraken',
    backgrounds: ['desert', 'beach'],
    decor: [
      { name: 'cloud', size: [80, 130], sky: true }, { name: 'rock', size: [50, 90] },
      { name: 'rock', size: [40, 70] }, { name: 'torch', size: [30, 44] },
    ],
  },
  {
    name: '氷の国と天空', boss: 'dragon',
    backgrounds: ['snow', 'sky'],
    decor: [
      { name: 'cloud', size: [100, 160], sky: true }, { name: 'cloud', size: [80, 130], sky: true },
      { name: 'rock', size: [50, 80] }, { name: 'tree', size: [70, 110] },
    ],
  },
  {
    name: '地底と火山', boss: 'dragon',
    backgrounds: ['cave', 'volcano'],
    decor: [
      { name: 'rock', size: [50, 90] }, { name: 'rock', size: [40, 70] }, { name: 'torch', size: [30, 44] },
    ],
  },
  {
    name: '魔王の城', boss: 'demon_king',
    backgrounds: ['night_castle', 'demon_castle'],
    decor: [
      { name: 'torch', size: [30, 44] }, { name: 'castle_wall', size: [90, 130] }, { name: 'rock', size: [50, 80] },
    ],
  },
];

const LEVELS_PER_WORLD = 10;
const worldOf = lv => WORLDS[Math.min(WORLDS.length - 1, Math.floor((lv - 1) / LEVELS_PER_WORLD))];
