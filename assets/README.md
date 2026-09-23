# 素材一覧（201点）

ChatGPT の画像生成で作った素材です。スタイルは「広告でよく見るタワーバトル系・つやのある3Dレンダリング風」で統一しています。
全体の見本は [catalog.jpg](catalog.jpg) を見てください。

| フォルダ | 数 | 中身 |
|---|---|---|
| `hero/` | 9 | armored, attack, aura_blue, aura_gold, damage, idle, jump, king, victory |
| `enemies/` | 45 | slime, bat, goblin, skeleton, zombie, wolf, oni, scorpion, mushroom, ghost, golem, baby_dragon, mummy, spider, harpy, troll, black_knight, skeleton_mage, yeti, fire_spirit, thunder_bird, shark_man, ninja, pirate, imp, witch, robot, poison_slime, gold_bat, goblin_king, skeleton_general, zombie_dog, ice_wolf, blue_oni, gold_scorpion, poison_mushroom, pumpkin, snowman, cactus, mimic, frog, snake, bear, orc, gargoyle |
| `bosses/` | 4 | dragon, demon_king, giant_golem, kraken |
| `allies/` | 9 | princess, king, mage, archer, priest, fairy, black_cat, villager, merchant |
| `items/` | 48 | ポーション3色、剣・盾・斧・弓・槍・ハンマー、鍵、宝箱、宝石5色、金貨、食べ物、装備品、巻物・魔法の本 ほか |
| `effects/` | 32 | explosion, slash, sparkle, heal, level_up, fire, ice, thunder, confetti, barrier, tornado, rainbow ほか |
| `ui/` | 16 | 丸ボタン4色、星（金/空）、リボン、看板、歯車、音符、スピーカー、鍵、矢印、手カーソル、トロフィー、メダル |
| `stage/` | 27 | 壁タイル（石/木/氷/溶岩）、屋根（赤/青）、旗、窓、土台、地面、岩、木、雲、城壁、柵、たいまつ、城門、橋、塔のてっぺん、はしご、階段、鎖、扉、檻、玉座 ほか |
| `backgrounds/` | 11 | meadow_castle, sunset_castle, night_castle, forest, desert, snow, volcano, beach, sky, cave, demon_castle（縦長 900×1350 の JPG） |

- `_sheets/` … 生成されたままの原本（1枚に複数体が並んだシート、背景の原寸 PNG）
- 透明 PNG は `tools/slice_sheet.py` でシートから1体ずつ切り出したもの

## 素材を追加するとき

1. ChatGPT で「透明背景・均等な 3×3（または 4×4）グリッド」を指定して生成し、ダウンロードする
2. `bash tools/grab_latest.sh <シート名>` で `_sheets/` に取り込む
3. `python tools/slice_sheet.py assets/_sheets/<シート名>.png assets/<フォルダ> 名前1,名前2,... 3x3` で切り出す
4. 背景は `bash tools/add_bg.sh <名前>` で JPG に変換して `backgrounds/` へ
