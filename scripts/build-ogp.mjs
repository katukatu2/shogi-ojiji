// LINE・X などでリンクを共有したときに出る画像（OGP、public/ogp.jpg、1200×630）を作る。
// 使い方: npm run build && npm run assets:ogp
// - タイトル画面の全身のオジジは、体の静止画と顔のリグを画面上で重ねて描いている（raizo-rig.js と style.css）。
//   位置を計算し直すとずれるので、ビルド済みのアプリを配信して実際の表示を背景なしで撮り、それを台紙に置く。
// - 文字は書き出す環境の明朝・ゴシック体で描く（Windows なら游明朝・游ゴシック）。生成物は git に入れる。
// - 画像はオフライン保存の対象から外している（scripts/prepare-offline.mjs）。共有先が取りに来るだけで、遊ぶ人には要らない。
import { chromium } from '@playwright/test';
import { writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStaticServer } from './serve-static.mjs';

const OUT = resolve('public', 'ogp.jpg');
const W = 1200;
const H = 630;

const server = createStaticServer({ isolated: true });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const browser = await chromium.launch();
try {
  // 1. タイトル画面の全身のオジジを、背景を透明にして撮る
  const shot = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, serviceWorkers: 'block' });
  const page = await shot.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const figure = page.locator('.title-screen .face.full');
  await figure.waitFor();
  await page.waitForTimeout(1500); // 体の画像と顔のリグの読み込みを待つ
  await page.addStyleTag({ content: 'html, body, #app, .title-screen { background: transparent !important; }' });
  const ojiji = await figure.screenshot({ omitBackground: true });

  // 2. 台紙に題名とひと言を組む
  const card = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const cp = await card.newPage();
  await cp.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
    body { background: #efe6d2; color: #2a2118; position: relative;
      font-family: 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'YuGothic', 'Meiryo', 'Noto Sans JP', sans-serif; }
    .frame { position: absolute; inset: 18px; border: 3px solid #2b3a55; border-radius: 18px; }
    .text { position: absolute; left: 76px; top: 70px; width: 700px; }
    h1 { margin: 0; font-family: 'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'Noto Serif JP', serif;
      font-weight: 800; font-size: 92px; line-height: 1.12; color: #2b3a55; letter-spacing: 2px; }
    .hook { margin-top: 34px; font-size: 42px; font-weight: 700; }
    .hook b { color: #b23a2a; }
    .sub { margin-top: 14px; font-size: 30px; line-height: 1.5; }
    .foot { position: absolute; left: 76px; bottom: 52px; font-size: 26px; color: #6b5a44; }
    .foot span { display: inline-block; margin-right: 22px; padding: 4px 14px; border-radius: 20px; background: #2b3a55; color: #fff; font-size: 22px; }
    img { position: absolute; right: 64px; bottom: 21px; height: 560px; }
  </style></head><body>
    <div class="frame"></div>
    <div class="text">
      <h1>将棋オジジの<br>定石指南</h1>
      <div class="hook">悪い手には「<b>ばかもーん！</b>」</div>
      <div class="sub">オジジの得意戦法を相手に指して、<br>序盤の定跡を叱られながら覚える将棋</div>
    </div>
    <div class="foot"><span>無料・登録不要</span>shogi.godo-amity.com</div>
    <img src="data:image/png;base64,${ojiji.toString('base64')}">
  </body></html>`);
  await cp.waitForFunction(() => document.fonts.ready.then(() => [...document.images].every((i) => i.complete)));
  const jpg = await cp.screenshot({ type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: W, height: H } });
  writeFileSync(OUT, jpg);
  console.log(`public/ogp.jpg  ${W}x${H}  ${(statSync(OUT).size / 1024).toFixed(1)} KB`);
} finally {
  await browser.close();
  server.close();
}
