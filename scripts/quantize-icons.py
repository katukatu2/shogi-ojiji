# Web で配るアイコン PNG を 256 色のパレット形式にして軽くする（npm run icons の後段）。
# 対象: public/app-icons/*.png（オフライン保存で最初にダウンロードされる）
# - 今のオジジの絵は塗りが細かく、フルカラー PNG だと Web 用 5 点で約 830 KB になり、
#   アプリ全体（約 2 MB）の初回ダウンロードが約 4 割増えた
# - iOS の AppIcon（App Store の規定で透過なしの RGB が必要）と Android の mipmap は配布物に入らないので触らない
# - 透過のある any 用アイコンは、角丸の外の透明を保ったままパレット化する
# 使い方: npm run icons（node scripts/build-icons.mjs のあとに呼ばれる）
import glob, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

for path in sorted(glob.glob(os.path.join(ROOT, 'public', 'app-icons', '*.png'))):
    before = os.path.getsize(path)
    im = Image.open(path).convert('RGBA')
    q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    q.save(path, optimize=True)
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
    print(f'{rel}  {before / 1024:.1f} KB -> {os.path.getsize(path) / 1024:.1f} KB')
