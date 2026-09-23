"""ゲーム用の軽い画像を作る。assets/（原本）→ img/（WebP・小さいサイズ）

  python tools/optimize.py

- キャラ・アイテム等の透明PNG … 長辺 256px（ボスは 384px）の WebP
- 背景 JPG … 720x1080 の WebP
- アプリアイコン … img/icon-192.png, img/icon-512.png
原本を差し替えたら、もう一度実行すれば img/ が更新される。
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC, DST = ROOT / "assets", ROOT / "img"
SIZES = {"bosses": 384, "backgrounds": 1080}
DEFAULT = 256


def main() -> None:
    total_in = total_out = count = 0
    for src in sorted(SRC.glob("*/*")):
        cat = src.parent.name
        if cat.startswith("_") or src.suffix.lower() not in (".png", ".jpg"):
            continue
        dst = DST / cat / (src.stem + ".webp")
        dst.parent.mkdir(parents=True, exist_ok=True)
        im = Image.open(src)
        im = im.convert("RGB") if cat == "backgrounds" else im.convert("RGBA")
        im.thumbnail((SIZES.get(cat, DEFAULT),) * 2, Image.LANCZOS)
        im.save(dst, "WEBP", quality=82 if cat == "backgrounds" else 88, method=6)
        total_in += src.stat().st_size
        total_out += dst.stat().st_size
        count += 1

    # アプリアイコン（ヒーローを青い丸背景に）
    hero = Image.open(SRC / "hero" / "idle.png").convert("RGBA")
    for size in (192, 512):
        icon = Image.new("RGBA", (size, size), (58, 123, 213, 255))
        h = hero.copy()
        h.thumbnail((int(size * 0.86),) * 2, Image.LANCZOS)
        icon.alpha_composite(h, ((size - h.width) // 2, (size - h.height) // 2))
        icon.save(DST / f"icon-{size}.png", optimize=True)

    print(f"{count} files: {total_in / 1e6:.1f}MB -> {total_out / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
