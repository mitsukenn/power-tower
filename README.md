# パワータワー 🦸🗼

広告でよく見る「タワーバトル」系のブラウザゲームです。
自分より**弱い**敵（数字が緑）をタップして倒すと、その数字ぶんパワーが増えます。
強い敵（数字が赤）に挑むと負け。すべての階を空にしたらクリア！

- 🧪 `+N` … パワーが N 増える
- ✨ `×2` … パワーが 2 倍（レベル3以降。取る順番がカギ）
- 🐉 … ボス（最後の塔のてっぺん）

**遊ぶ:** https://machino-ai.jp/power-tower/

## ファイル構成

| ファイル | 内容 |
|---|---|
| `index.html` | 画面の骨組み |
| `style.css` | 見た目・アニメーション |
| `game.js` | ゲームロジック。先頭の `CONFIG` で難易度などを調整 |
| `BRUSHUP.md` | 改善アイデア・TODO リスト |
| `CLAUDE.md` | Claude Code に作業してもらうときの指示書 |

ビルド不要。`index.html` をブラウザで開くだけで動きます。
`index.html?lv=8` のように付けると好きなレベルから始められます（テスト用）。

## 2台のPC（メインPC / 4thPC）で共同編集する手順

### 最初の1回だけ（4thPC側）

```bash
gh auth login
gh repo clone mitsukenn/power-tower
```

### 毎回の作業の流れ（どちらのPCでも同じ）

1. **作業前に最新を取り込む**
   ```bash
   git pull
   ```
2. 編集する（Claude Code に「BRUSHUP.md の〇〇をやって」と頼んでもOK）
3. **作業後に保存して送る**
   ```bash
   git add -A
   git commit -m "変更内容"
   git push
   ```

push すると 1〜2 分で GitHub Pages の URL にも反映されます。

> 同じファイルを両方のPCで同時に編集すると「コンフリクト」が起きることがあります。
> 作業前の `git pull`、作業後の `git push` を習慣にすれば、ほぼ防げます。
