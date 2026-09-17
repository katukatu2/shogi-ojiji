# アプリアイコンの元（public/icon.svg）を、今のオジジ（雷蔵）の顔から作る。
# 入力: assets-src/raizo/heads/neutral.webp（制作元の頭部。ロスレス、約 340px 幅）
# 出力: public/icon.svg（紺の角丸四角に顔を載せる。PNG 一式は npm run icons がここから書き出す）
# - 以前の icon.svg は手描きの図形で、廃止した初期デザインのオジジだった（iPhone のホーム画面で指摘された）
# - scripts/build-icons.mjs は最初の <rect> から地の色と角の丸みを読むので、先頭に地の四角を置く
# - 顔は紺の地に重ねた JPEG で埋め込む。描画に使う resvg は WebP を描けず、透過 PNG だと約 16 万バイトになる
# - JPEG の地の紺は 1 段ずれることがある（#2b3a55 が 43,59,85 になる）。四隅まで敷くと縁の色が地の色と
#   合わなくなるので、顔の周りだけに置き、縁は純粋な <rect> の紺を見せる
# 使い方: python scripts/build-icon-svg.py && npm run icons
import base64, io, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'raizo', 'heads', 'neutral.webp')
OUT = os.path.join(ROOT, 'public', 'icon.svg')
NAVY = (0x2B, 0x3A, 0x55)
VIEW = 256          # icon.svg の viewBox の一辺
RADIUS = 56         # 角の丸み（viewBox 上）
HEAD_WIDTH = 0.86   # 一辺に対する顔の幅
INSET = 0.08        # 埋め込む絵の外側に残す純粋な地の幅（一辺に対する割合）
PX = 512            # 埋め込む絵の一辺（1 - 2 * INSET を掛けた範囲をこの画素数で描く前の基準）
QUALITY = 85


def main():
    head = Image.open(SRC).convert('RGBA')
    head = head.crop(head.getbbox())
    w = round(PX * HEAD_WIDTH)
    h = round(head.height * w / head.width)
    head = head.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (PX, PX), NAVY + (255,))
    canvas.alpha_composite(head, ((PX - w) // 2, (PX - h) // 2 + round(PX * 0.02)))
    # 縁の INSET 分を切り落として JPEG にする（顔は内側に収まっている）
    cut = round(PX * INSET)
    inner = canvas.crop((cut, cut, PX - cut, PX - cut)).convert('RGB')
    buf = io.BytesIO()
    inner.save(buf, 'JPEG', quality=QUALITY, subsampling=0, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    pos = VIEW * INSET
    size = VIEW * (1 - 2 * INSET)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEW} {VIEW}" role="img" aria-label="将棋オジジ">\n'
        f'  <rect width="{VIEW}" height="{VIEW}" rx="{RADIUS}" fill="#{NAVY[0]:02x}{NAVY[1]:02x}{NAVY[2]:02x}"/>\n'
        f'  <image x="{pos:g}" y="{pos:g}" width="{size:g}" height="{size:g}" href="data:image/jpeg;base64,{b64}"/>\n'
        '</svg>\n'
    )
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(svg)
    print(f'public/icon.svg  {len(svg.encode()) / 1024:.1f} KB（JPEG {len(buf.getvalue()) / 1024:.1f} KB）')


if __name__ == '__main__':
    main()
