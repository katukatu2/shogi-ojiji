# オジジの顔素材を作る。
# 入力: assets-src/raizo/heads/*.webp（制作元の頭部 8 点。ロスレス、約 340px 幅）
# 出力: public/raizo/faces/*.webp（アプリが読む顔。非可逆 WebP、幅 288px 基準、アルファ付き）
# - 8 点を同じ倍率で縮小し、顔どうしの位置関係を保つ（眉の重ね描きがずれないように）
# - brow は眉の部分だけを切り出す（sour の顔の上に重ねる。切り出し位置は raizo-rig.js の BROW と対応）
# - 表示は最大でもカットインの約 240px なので、288px あれば @2x でも足りる
# 使い方: python scripts/build-faces.py
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'raizo', 'heads')
OUT = os.path.join(ROOT, 'public', 'raizo', 'faces')
BASE_WIDTH = 288          # neutral の幅をこれに合わせ、他も同じ倍率で縮める
QUALITY = 80
BROW_CROP = (65, 110, 213, 68)  # brow.webp の中の眉の位置 (x, y, w, h)。制作元の rig と同じ
FACES = ['neutral', 'blink', 'think', 'sip', 'sour', 'shout', 'surprise']


def load(name):
    return Image.open(os.path.join(SRC, name + '.webp')).convert('RGBA')


def save(im, name):
    path = os.path.join(OUT, name + '.webp')
    im.save(path, 'WEBP', quality=QUALITY, method=6, lossless=False)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    scale = BASE_WIDTH / load('neutral').width
    total = 0
    for name in FACES:
        im = load(name)
        size = (round(im.width * scale), round(im.height * scale))
        total += save(im.resize(size, Image.LANCZOS), name)
    x, y, w, h = BROW_CROP
    brow = load('brow').crop((x, y, x + w, y + h))
    total += save(brow.resize((round(w * scale), round(h * scale)), Image.LANCZOS), 'brow')
    print(f'faces: {len(FACES) + 1} files, {total / 1024:.0f} KB, scale {scale:.3f}')


if __name__ == '__main__':
    main()
