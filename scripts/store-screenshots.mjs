// 開発サーバーの実際の画面を撮る。原案であり、iOS/Android の実機スクリーンショットではない。
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const output = resolve(process.argv[2] || 'logs/store-drafts');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, serviceWorkers: 'block' });
  const base = process.env.OJIJI_PREVIEW_URL || 'http://localhost:5179';
  const shot = async (name) => {
    await page.screenshot({ path: join(output, name), animations: 'disabled' });
    console.log(name);
  };
  await page.goto(base);
  await page.locator('raizo-rig').waitFor();
  await page.waitForTimeout(600);
  await shot('01-title.png');
  await page.getByRole('button', { name: 'はじめる', exact: true }).click();
  await page.getByRole('button', { name: /^四間飛車/ }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('02-settings.png');
  await page.getByRole('button', { name: /^棒銀/ }).click();
  await page.getByRole('button', { name: 'この設定で対局' }).click();
  await page.getByText('対局開始', { exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.topbar .engine').filter({ hasText: '判定: エンジン' }).waitFor();
  await shot('03-game.png');
  const cell = (file, rank) => page.locator('.board .cell').nth((rank - 1) * 9 + 9 - file);
  await cell(7, 7).click(); await cell(7, 6).click();
  await page.waitForFunction(() => window.__ojiji.game().pos.moves.length === 2);
  await cell(5, 9).click(); await cell(4, 8).click();
  await page.locator('.cutin').waitFor();
  await page.waitForTimeout(350);
  await shot('04-guidance.png');
  await page.getByRole('button', { name: 'このまま進む' }).click();
  await page.waitForFunction(() => window.__ojiji.game().pos.moves.length === 4);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '投了する', exact: true }).click();
  await page.locator('.panel.result').waitFor();
  await shot('05-results.png');

  // 実画面の全身と同じ素材を使った、Play向け横長グラフィックの原案。
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.goto(base);
  const character = page.locator('.title-screen .face.full');
  await character.evaluate((node) => { node.style.width = '320px'; node.style.flexShrink = '0'; });
  await page.waitForTimeout(600);
  // アプリ自身の顔・体の配置をそのまま撮る。素材ごとの位置を描き直さない。
  const art = (await character.screenshot({ animations: 'disabled' })).toString('base64');
  await page.setContent(`<html lang="ja"><style>*{box-sizing:border-box}body{margin:0;width:1024px;height:500px;background:#efe6d2;color:#2b3a55;font-family:'Yu Gothic',Meiryo,sans-serif;display:flex;align-items:center;padding:50px 60px;gap:40px}.art{width:320px;height:auto;flex-shrink:0}h1{font-size:44px;line-height:1.45;letter-spacing:.04em;margin:16px 0}p{font-size:21px;line-height:1.9;margin:0}.tag{font-size:16px;letter-spacing:.2em}</style><img class="art" src="data:image/png;base64,${art}"><main><div class="tag">指して、叱られて、覚える。</div><h1>将棋オジジの<br>定石指南</h1><p>５つの戦法。３段階の強さ。<br>一手の理由を、オジジと学ぶ。</p></main></html>`);
  await page.screenshot({ path: join(output, '06-feature-graphic.png'), scale: 'css' });
  writeFileSync(join(output, 'README.md'), '# ストア画像の原案\n\n01〜05: Web版の実画面、1080×1920。06: Play向け横長原案、1024×500。\n\niOS・Androidの実機画像ではありません。最終提出前に対象端末での見え方とストア掲載内容を確認します。\n画面4は実際の「玉飛接近」の指導、画面5はその対局を投了した結果です。\n');
} finally { await browser.close(); }
