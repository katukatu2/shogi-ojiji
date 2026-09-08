# タイトル画面用の、オジジの体（首から下）の静止画を作る。
# 入力: assets-src/raizo/body/{body,sleeve,relaxed}.webp（制作元の体・袖・手）
# 出力: public/raizo/body.webp（500×620 の描画空間そのまま。顔は入っていない）
# 制作元の全身リグ（raizo-rig.js の idle、t=0）と同じ位置・角度で体と両腕を合成する。
# 顔は <raizo-rig> がこの上に重なる（style.css の .title-screen .face.full raizo-rig の位置と対応）。
# 使い方: python scripts/build-body.py
import math, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'raizo', 'body')
OUT = os.path.join(ROOT, 'public', 'raizo', 'body.webp')
W, H = 500, 620   # 描画空間
K = 2             # 合成は 2 倍で行い、最後に縮める
QUALITY = 80


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def T(x, y): return [[1, 0, x], [0, 1, y], [0, 0, 1]]
def S(x, y): return [[x, 0, 0], [0, y, 0], [0, 0, 1]]
def R(a): c, s = math.cos(a), math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


def inv(m):
    (a, b, c), (d, e, f), _ = m
    det = a * e - b * d
    return [[e / det, -b / det, (b * f - c * e) / det], [-d / det, a / det, (c * d - a * f) / det], [0, 0, 1]]


def load(name):
    return Image.open(os.path.join(SRC, name + '.webp')).convert('RGBA')


def draw(canvas, img, base, width, angle=0.0, ax=0.5, ay=0.5, flip=False):
    # raizo-rig.js の draw() と同じ変換: translate → rotate → flip → 原点をアンカーへ → 画像の拡縮
    h = width * img.height / img.width
    m = mul(base, R(angle))
    if flip:
        m = mul(m, S(-1, 1))
    m = mul(m, T(-width * ax, -h * ay))
    m = mul(m, S(width / img.width, h / img.height))
    m = mul(S(K, K), m)  # 描画空間 → 出力ピクセル
    a, b, c = inv(m)[0]
    d, e, f = inv(m)[1]
    layer = img.transform(canvas.size, Image.AFFINE, (a, b, c, d, e, f), resample=Image.BICUBIC)
    canvas.alpha_composite(layer)


def arm(canvas, sleeve, hand, side, angle):
    # raizo-rig.js の arm() と同じ。side は画面上の左右
    screen_left = side == 'left'
    mirror = -1 if screen_left else 1
    shoulder = (154 if screen_left else 346, 352)
    sleeve_w = 106
    sleeve_h = sleeve_w * sleeve.height / sleeve.width
    base = mul(T(*shoulder), R(angle))
    draw(canvas, sleeve, base, sleeve_w, 0, .44, .075, screen_left)
    base = mul(base, T(mirror * (.40 - .44) * sleeve_w, (.84 - .075) * sleeve_h))
    draw(canvas, hand, base, 70, mirror * -.72, .84, .40, screen_left)


def main():
    body, sleeve, hand = load('body'), load('sleeve'), load('relaxed')
    canvas = Image.new('RGBA', (W * K, H * K), (0, 0, 0, 0))
    draw(canvas, body, T(250, 300), 280, 0, .5, 0)          # 体
    arm(canvas, sleeve, hand, 'right', .08)                  # 画面右の腕
    arm(canvas, sleeve, hand, 'left', -.08)                  # 画面左の腕
    out = canvas.resize((W, H), Image.LANCZOS)
    out.save(OUT, 'WEBP', quality=QUALITY, method=6, lossless=False)
    print(f'body: {out.size}, bbox {out.getbbox()}, {os.path.getsize(OUT) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
