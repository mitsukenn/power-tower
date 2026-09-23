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
- `js/level.js` の `generateLevel(lv)` は「正解の順番」を先に作ってから塔へシャッフル配置する → 必ずクリア可能。この性質は壊さないこと。
  - 正解の順番では 💣 は序盤、×2 と ☠ は終盤。☠ の値は開始パワーより大きくして「先に取ると負け」のひっかけにしている。
  - `bestScore()` がそのレベルの最高パワーの目安を出し、★評価（`CONFIG.star3` / `star2`）に使う。
- 画像は `img/`（WebP・軽量）を使う。原本は `assets/`。原本を追加・変更したら `python tools/optimize.py` で `img/` を作り直す。
- セーブは localStorage（キー `powerTower.v2`）。解放レベル・★・金貨・ショップ強化・既読ヒントなど。

## 動作確認

- `index.html?lv=8` で任意レベルから開始（タイトルを飛ばす）。スマホ幅（375px 前後）で崩れないことも確認する。
- レベル生成を変えたら、Node で全レベルがクリア可能か確認する：
  `cat js/config.js js/level.js > /tmp/t.js && echo 'for(let lv=1;lv<=60;lv++){const L=generateLevel(lv);if(bestScore(L.towers.flat(),CONFIG.startPower)<0)console.log("NG",lv)}' >> /tmp/t.js && node /tmp/t.js`
- 公開URL: https://machino-ai.jp/power-tower/ （main に push すると GitHub Pages に反映）
- `sw.js` は HTML/JS/CSS をネット優先で取るので、push 後はリロードで最新になる。

## ChatGPT で素材を追加生成するときの注意（Chrome 操作）

- 1枚ずつ「透明背景・均等な 3×3/4×4 グリッド」で頼むと切り出しやすい（`tools/slice_sheet.py`）。
- 生成を立て続けに頼むと「リクエストが多すぎます」と制限される。依頼は1〜2分に1回程度に抑える。
- 保存は ChatGPT の保存ボタンを連打すると制限に数えられる。前面タブで待ち受け、裏タブから BroadcastChannel で画像を渡して `<a download>` で保存すると制限に数えられない。
- クリックは前面のタブでしか効かない。
