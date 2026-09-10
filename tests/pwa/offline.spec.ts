import { test, expect } from '@playwright/test';

for (const path of ['/', '/sub/']) {
  test(`${path} 初回に素材一式を保存し、オフライン再起動でもエンジンで指せる`, async ({ page, context }) => {
    await page.goto(path);
    // 初回は分離ヘッダーを適用するため1回だけ自動リロードする。その間の評価コンテキスト破棄を許容。
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller).catch(() => false)).toBe(true);
    await expect.poll(() => page.evaluate(() => crossOriginIsolated).catch(() => false)).toBe(true);
    await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
    expect(await page.evaluate(() => '__ojiji' in window)).toBe(false);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
    await page.getByRole('button', { name: 'はじめる', exact: true }).click();
    await page.getByRole('button', { name: 'この設定で対局' }).click();
    await expect(page.locator('.topbar .engine')).toHaveText('判定: エンジン');
    await page.locator('.board .cell').nth(56).click();
    await page.locator('.board .cell').nth(47).click();
    await expect(page.getByText('3手目', { exact: true })).toBeVisible();
    const audio = await page.evaluate(async (path) => {
      const res = await fetch(path + 'sfx/bakamon_thunder.mp3?v=2026-09-09b', { headers: { Range: 'bytes=0-1' } });
      return res.status === 206 && (await res.arrayBuffer()).byteLength === 2;
    }, path);
    expect(audio).toBe(true);
  });
}
