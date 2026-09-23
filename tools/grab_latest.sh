#!/usr/bin/env bash
# Chrome のダウンロード先にある「ChatGPT Image *.png」を古い順に名前を付けて assets/_sheets/ に移す
# 使い方: bash tools/grab_latest.sh <名前1> [名前2 ...]
#   名前が N 個なら、最新 N 個を「古い順」に割り当てる（保存した順に名前を並べればよい）
set -e
DL="${PT_DOWNLOAD_DIR:-/c/Users/marak/Downloads/SunoWAV}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/_sheets"
mkdir -p "$OUT"
mapfile -t files < <(ls -t "$DL"/ChatGPT\ Image*.png 2>/dev/null | head -n $# | tac)
[ "${#files[@]}" -ne $# ] && { echo "ダウンロードが ${#files[@]} 個しかありません（必要 $# 個）"; exit 1; }
i=0
for name in "$@"; do
  mv "${files[$i]}" "$OUT/$name.png"
  echo "$name.png <- $(basename "${files[$i]}")"
  i=$((i + 1))
done
