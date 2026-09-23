"""スプライトシート（複数キャラが並んだ1枚絵）を1体ずつのPNGに切り出す。

使い方:
  python tools/slice_sheet.py <シート画像> <出力フォルダ> <名前1,名前2,...>

- 背景が透明ならアルファで、透明でなければ四隅の色を背景とみなして切り抜く
- 左上 → 右下の順（行ごと）に名前を割り当てる
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def foreground_mask(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGBA")).astype(np.int16)
    alpha = a[..., 3]
    if (alpha < 16).mean() > 0.2:  # 透明背景
        return alpha > 24
    # 不透明背景: 四隅の平均色との差で判定し、端からつながった部分だけを背景とする
    rgb = a[..., :3]
    h, w = alpha.shape
    corners = np.array([rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1]])
    bg = np.median(corners, axis=0)
    near_bg = np.abs(rgb - bg).sum(axis=2) < 60
    lab, _ = ndimage.label(near_bg)
    edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    background = np.isin(lab, list(edge_labels))
    return ~background


def slice_sheet(path: Path, out_dir: Path, names: list[str]) -> None:
    img = Image.open(path).convert("RGBA")
    mask = foreground_mask(img)
    # 近いパーツ（剣先・エフェクトなど）を1体にまとめるため膨張してからラベリング
    grown = ndimage.binary_dilation(mask, iterations=max(4, img.width // 120))
    lab, n = ndimage.label(grown)
    min_area = img.width * img.height * 0.004
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        area = (lab[sl] == i).sum()
        if area >= min_area:
            boxes.append((sl, i))

    # 行ごとに並べる（上端のy座標でグループ化 → 各行を x 順）
    boxes.sort(key=lambda b: b[0][0].start)
    rows, row_h = [], img.height / 12
    for b in boxes:
        cy = (b[0][0].start + b[0][0].stop) / 2
        if rows and abs(cy - rows[-1][0]) < row_h * 1.5:
            rows[-1][1].append(b)
        else:
            rows.append([cy, [b]])
    ordered = [b for _, r in rows for b in sorted(r, key=lambda b: b[0][1].start)]

    out_dir.mkdir(parents=True, exist_ok=True)
    rgba = np.asarray(img).copy()
    rgba[..., 3] = np.where(mask, rgba[..., 3], 0)
    for idx, (sl, label_id) in enumerate(ordered):
        name = names[idx] if idx < len(names) else f"{path.stem}_{idx + 1:02d}"
        crop = rgba[sl].copy()
        crop[..., 3] = np.where(lab[sl] == label_id, crop[..., 3], 0)
        pad = 8
        crop = np.pad(crop, ((pad, pad), (pad, pad), (0, 0)))
        Image.fromarray(crop).save(out_dir / f"{name}.png", optimize=True)
    print(f"{path.name}: {len(ordered)} 個切り出し（名前 {len(names)} 個）")


if __name__ == "__main__":
    src, dst, names = sys.argv[1], sys.argv[2], sys.argv[3]
    slice_sheet(Path(src), Path(dst), [s.strip() for s in names.split(",") if s.strip()])
