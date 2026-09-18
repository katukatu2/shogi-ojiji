// iPhone でホーム画面から開くと、時計などの帯（safe-area）の下まで描く（viewport-fit=cover、black-translucent）。
// 帯の高さを Chromium の DevTools で模擬して、各画面の最上部の要素が帯の下から始まることを確かめる。
// 2026-09-18 の実機確認で、対局画面の上の帯（対 ○○・見習い、判定など）が時計と重なっていた。

import { test, expect, Page, Locator } from '@playwright/test';
import { savedProgress, openWithProgress, expectGameScreen, waitForMoves } from './helpers';

const TOP = 47; // iPhone 12〜14 の上の帯

async function emulateNotch(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: TOP, bottom: 34 } } as never);
}

async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, '要素が画面にある').not.toBeNull();
  return box!.y;
}

test.describe('画面上端の帯（safe-area）', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'safe-area の模擬は Chromium の DevTools だけ');

  // 390×844 は帯のある iPhone（12〜14）。375×667 は既定の試験画面で、帯を足すと最も窮屈になる
  for (const size of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) test(`${size.width}×${size.height}: タイトル・対局画面とも、最上部の要素が帯の下から始まる`, async ({ page }) => {
    await page.setViewportSize(size);
    await emulateNotch(page);
    await openWithProgress(page, savedProgress('bougin'));

    // 模擬が効いていることを先に確かめる（効いていなければ、この試験は何も確かめていない）
    const inset = await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.paddingTop = 'env(safe-area-inset-top)';
      document.body.append(d);
      const v = parseFloat(getComputedStyle(d).paddingTop);
      d.remove();
      return v;
    });
    expect(inset).toBe(TOP);

    await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
    expect(await topOf(page.locator('.title-screen'))).toBeGreaterThanOrEqual(TOP);

    await page.getByRole('button', { name: '前回の設定で始める' }).click();
    await expectGameScreen(page, '対 棒銀・見習い');
    await waitForMoves(page, 0);
    expect(await topOf(page.locator('.topbar'))).toBeGreaterThanOrEqual(TOP);

    // 盤は画面に収まったまま（縦のはみ出しで下の操作ボタンが隠れない）
    const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(scroll).toBeLessThanOrEqual(0);
  });
});
