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

// エックスサーバーの本番で、保存は完了しているのに通信なしで起動できなかった（Chromium・WebKit とも毎回）。
// 配信元の nginx は圧縮する応答に Vary: Accept-Encoding を付ける。手元で Vary だけを変えた比較では、Vary ありで
// 失敗・なしで成功したので、Service Worker の cache.match に ignoreVary を付けた。
// ただし手元での再現はタイミング次第で毎回は起きず、この試験は修正前の Service Worker でも通る。
// つまり再発を確実に捕まえる試験ではない。Vary を付ける配信元で通信なしの経路が動くことの確認にとどまる。
// 確実な確認は本番での通信なし起動（docs/deploy-xserver.md の手順）で行う。
test('配信元が Vary を付けても、保存完了後は通信なしでページと素材を返す', async ({ page, context }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller).catch(() => false)).toBe(true);
  const vary = await page.evaluate(async () => (await fetch('./', { cache: 'no-store' })).headers.get('vary'));
  expect(vary).toContain('Accept-Encoding');
  // Service Worker が完了とみなす印（.ojiji-ready）が版のキャッシュに書かれるまで待つ
  await expect.poll(() => page.evaluate(async () => {
    const name = (await caches.keys()).find((n) => /^ojiji:\/:[0-9a-f]{20}$/.test(n));
    if (!name) return false;
    return !!(await (await caches.open(name)).match(new URL('.ojiji-ready', location.href).href));
  }).catch(() => false), { timeout: 30_000 }).toBe(true);

  await context.setOffline(true);
  const statuses = await page.evaluate(async () => {
    const out: Record<string, number | string> = {};
    for (const p of ['./', './engine/yaneuraou.k-p.wasm', './raizo/raizo-rig.js']) {
      try { out[p] = (await fetch(p)).status; } catch { out[p] = 'failed'; }
    }
    return out;
  });
  expect(statuses).toEqual({ './': 200, './engine/yaneuraou.k-p.wasm': 200, './raizo/raizo-rig.js': 200 });
  await page.reload();
  await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
});
