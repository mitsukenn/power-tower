#!/usr/bin/env bash
# ダウンロードした背景画像を取り込む（原本は _sheets/bg_<名前>.png、ゲーム用は backgrounds/<名前>.jpg）
# 使い方: bash tools/add_bg.sh <名前>
#   ダウンロード先に pt_bg_<名前>.png があればそれを、無ければ最新の「ChatGPT Image」を使う
set -e
cd "$(dirname "$0")/.."
DL="${PT_DOWNLOAD_DIR:-/c/Users/marak/Downloads/SunoWAV}"
if [ -f "$DL/pt_bg_$1.png" ]; then
  mkdir -p assets/_sheets
  mv "$DL/pt_bg_$1.png" "assets/_sheets/bg_$1.png"
  echo "bg_$1.png <- pt_bg_$1.png"
else
  bash tools/grab_latest.sh "bg_$1"
fi
mkdir -p assets/backgrounds
python -c "
from PIL import Image
im = Image.open('assets/_sheets/bg_$1.png').convert('RGB')
im.thumbnail((900, 1350))
im.save('assets/backgrounds/$1.jpg', quality=85, optimize=True)
print('assets/backgrounds/$1.jpg', im.size)
"
