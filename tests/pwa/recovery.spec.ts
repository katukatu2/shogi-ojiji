import { test, expect } from '@playwright/test';

for (const failure of ['asset', 'manifest', 'version'] as const) {
  test(`初回の${failure}障害でもエンジンが使え、再試行後はオフラインで起動する`, async ({ page, context, request }, info) => {
    const path = `/fault/${failure}-${info.project.name}/`;
    const target = path + (failure === 'asset' ? 'icons/icon-512-square.png' : 'offline-assets.json');
    expect((await request.post('/__test/fault', { data: { path: target, mode: failure === 'version' ? 'version' : 'missing' } })).ok()).toBe(true);
    await page.goto(path);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller && crossOriginIsolated).catch(() => false)).toBe(true);
    await expect(page.locator('#offline-status')).toBeVisible();
    await page.getByRole('button', { name: 'はじめる', exact: true }).click();
    await page.getByRole('button', { name: 'この設定で対局' }).click();
    await expect(page.locator('.topbar .engine')).toHaveText('判定: エンジン');
    expect((await request.post('/__test/fault', { data: { path: target, mode: 'none' } })).ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#offline-status')).toBeHidden();
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
