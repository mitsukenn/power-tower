# CLAUDE.md

このリポジトリは「パワータワー」（広告系タワーバトルゲーム）です。
メインPC と 4thPC の 2 台から、Claude Code を使って交互にブラッシュアップしています。

## 作業ルール

- **作業を始める前に必ず `git pull`** して、もう一方のPCの変更を取り込む。
- 作業が一区切りしたら、日本語のコミットメッセージで commit → `git push` まで行う（ユーザーが不要と言った場合を除く）。
- 改善アイデアは `BRUSHUP.md` にある。実装したら該当項目に `[x]` を付け、新しく思いついたアイデアは追記する。
- ユーザーとのやり取りは日本語で。

## 構成

- 素の HTML / CSS / JavaScript。ビルド・依存パッケージなし。`<script>` を順番に読み込む（config → level → audio → game）。
- `js/config.js` の `CONFIG` と `WORLDS` に調整値を集約。バランス調整はまずここを触る。
- ステージの種類は `stageTypeOf(lv)`（normal / treasure / boss / rush / dark）、種類ごとの生成パラメータは `levelParams(lv)`。マップの NEW 表示は `NEW_AT`。
- 移動ルール：部屋どうしは `level.edges`（橋・はしご）でつながった所だけ行き来できる。通ったエリア（'home'＋クリア済み）とつながった部屋にだけ進める（`isReachable(cell, explored, edges)` / `linkedNeighbors`）。
- 💣 は ÷2 のあと、つながった隣の敵（ボス以外）を強さに関係なく吹き飛ばして吸収する（`blastTargets` / `takeCell`）。
- `js/level.js` の `generateLevel(lv)` は、スタートから部屋を1つずつ広げて通路（塔の中は全部はしご、塔の間は `CONFIG.bridgesPerGap` 本の橋を決まった階に）を作り、スタートから通路にそって部屋を広げた順を「正解の順番」として数値を決める。最後の隙間はボスの階に橋を架けない。💣・☠ はボスへの幹の道に優先して置く。爆風で順番が変わることもあるので、最後に `bestScore` で解けるか確かめ、解けなければ作り直す → 必ずクリア可能。この性質は壊さないこと。
  - 正解の順番では 💣 は序盤、×2 と ☠ は終盤。☠ の値は開始パワーより大きくして「先に取ると負け」のひっかけにしている。
  - クリア条件は「ボスを倒す」。ほかの部屋は寄り道自由（全部屋クリア後にボスを倒すと PERFECT）。
  - `bestPlan()` / `bestScore()` は「どこまで寄り道してからボスに挑むか・どの罠を避けるか」を何百通りか試して最高パワーの目安を出し、★評価（`CONFIG.star3` / `star2`）と負けたときのヒントに使う。
  - ？ボックス（type `mystery`）は中身 `content` を生成時に決めておく。効果はパワーに対する割合なので、開けて即負けにはならない。
- 画像は `img/`（WebP・軽量）を使う。原本は `assets/`。原本を追加・変更したら `python tools/optimize.py` で `img/` を作り直す。
- セーブは localStorage（キー `powerTower.v2`）。解放レベル・★・金貨・ショップ強化・アイテムの数（`save.items`）・既読ヒントなど。
- ホーム画面に追加の案内は game.js の「ホーム画面に追加（PWA）」の節。Android は beforeinstallprompt、iPhone は手順を表示、LINE などアプリ内ブラウザは「ブラウザで開いて」。すすめるレベルは `CONFIG.homeAskAt`、ホーム画面から初回起動のお礼は `CONFIG.homeGift`。iPhone のホーム画面版はセーブが Safari と別になる点に注意。
- アイテムは `CONFIG.itemList`。使う処理は game.js の「アイテム」の節（`useItem` / `hammerSmash` / `useShield`）。

## 公開時の注意

- `index.html` の CSS / JS の読み込みには `?v=日付+記号`（例 `?v=20260923c`）を付けている。**JS か CSS を変えたら、この値を全部そろえて新しくする**。
  付け忘れると、スマホに古いファイルが残って「新しい game.js ＋ 古い config.js」の組み合わせになり、動かなくなることがある。

## 動作確認

- `index.html?lv=8` で任意レベルから開始（タイトルを飛ばす）。スマホ幅（375px 前後）で崩れないことも確認する。
- レベル生成を変えたら、Node で全レベルがクリア可能か確認する：
  `cat js/config.js js/level.js > /tmp/t.js && echo 'for(let lv=1;lv<=60;lv++){const L=generateLevel(lv);if(bestScore(L.towers.flat(),CONFIG.startPower)<0)console.log("NG",lv)}' >> /tmp/t.js && node /tmp/t.js`
- 公開URL: https://machino-ai.jp/power-tower/ （main に push すると GitHub Pages に反映）
- `sw.js` は HTML/JS/CSS をネット優先で取るので、push 後はリロードで最新になる。

## ChatGPT で素材を追加生成するときの注意（Chrome 操作）

- 1枚ずつ「透明背景・均等な 3×3/4×4 グリッド」で頼むと切り出しやすい（`tools/slice_sheet.py`）。
- 生成を立て続けに頼むと「リクエストが多すぎます」と制限される。依頼は1〜2分に1回程度に抑える。
- 保存は ChatGPT の保存ボタンを使わず、ページ内で `fetch(img.src)` → `<a download>` をスクリプトで押すと制限に数えられず、裏のタブからでも保存できる。
- このPCの Chrome の保存先は `Downloads/SunoWAV`（`tools/grab_latest.sh` の `PT_DOWNLOAD_DIR`）。
- 画面のクリックは前面のタブでしか効かない。
