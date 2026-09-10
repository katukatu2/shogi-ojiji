import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
for (const failure of ['asset', 'manifest', 'version'] as const) {
  test(`${viewport.width}×${viewport.height} 初回の${failure}障害を見える位置で知らせ、再試行後はオフラインで起動する`, async ({ page, context, request }, info) => {
    await page.setViewportSize(viewport);
    const path = `/fault/${failure}-${viewport.width}-${info.project.name}/`;
    const target = path + (failure === 'asset' ? 'icons/icon-512-square.png' : 'offline-assets.json');
    expect((await request.post('/__test/fault', { data: { path: target, mode: failure === 'version' ? 'version' : 'missing' } })).ok()).toBe(true);
    await page.goto(path);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller && crossOriginIsolated).catch(() => false)).toBe(true);
    await expect(page.locator('#offline-status')).toBeVisible();
    await expect(page.locator('#offline-status')).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'はじめる', exact: true }).click();
    await page.getByRole('button', { name: 'この設定で対局' }).click();
    await expect(page.locator('.topbar .engine')).toHaveText('判定: エンジン');
    await expect(page.locator('#offline-status')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.board')).toBeInViewport({ ratio: 1 });
    for (const label of ['ヒント', '待った', '投了する', 'タイトルへ']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeInViewport({ ratio: 1 });
    }
    const layout = await page.evaluate(() => {
      const notice = document.getElementById('offline-status')!.getBoundingClientRect();
      const board = document.querySelector('.board')!.getBoundingClientRect();
      return { noticeBottom: notice.bottom, boardTop: board.top, scrollX, scrollY };
    });
    expect(layout.noticeBottom).toBeLessThanOrEqual(layout.boardTop);
    expect(layout.scrollX).toBe(0);
    expect(layout.scrollY).toBe(0);
    if (failure === 'asset' && viewport.width === 390) {
      const oldHeight = (await page.locator('#offline-status').boundingBox())!.height;
      await page.setViewportSize({ width: 360, height: 640 });
      await page.locator('#offline-status').evaluate((node) => { node.style.fontSize = '20px'; });
      await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingTop))).toBeGreaterThan(oldHeight);
      await expect(page.locator('#offline-status')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.board')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: '投了する', exact: true })).toBeInViewport({ ratio: 1 });
    }
    expect((await request.post('/__test/fault', { data: { path: target, mode: 'none' } })).ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#offline-status')).toBeHidden();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('0px');
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
    await page.getByRole('button', { name: '前回の設定で始める' }).click();
    await expect(page.locator('.topbar .engine')).toHaveText('判定: エンジン');
    await page.locator('.board .cell').nth(56).click();
    await page.locator('.board .cell').nth(47).click();
    await expect(page.getByText('3手目', { exact: true })).toBeVisible();
  });
}
}
