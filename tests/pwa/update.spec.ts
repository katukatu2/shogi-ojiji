import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('更新失敗で旧版を守り、連続更新は実行版と最新待機版だけ残して閉じた後に切り替わる', async ({ page, context, request, baseURL }, info) => {
  const id = `${info.project.name}-${randomUUID()}`; // サーバーを再利用する再実行でも、前回の版・通信回数を引き継がない
  const path = `/updates/${id}/`;
  const prefix = `ojiji:${path}:`;
  const update = async (version: string, fail = false) => {
    expect((await request.post('/__test/update', { data: { id, version, fail } })).ok()).toBe(true);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())!.installing)).toBe(false);
  };
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.register('./coi-serviceworker.js'));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.reload();
  expect(await page.evaluate(() => (window as any).release)).toBe('a');
  await update('b', true);
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())!.waiting)).toBe(false);
  expect(await page.evaluate(() => fetch('./app.js').then((r) => r.text()))).toContain("'a'");
  await update('b');
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting?.state)).toBe('installed');
  await update('c');
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting?.state)).toBe('installed');
  expect(await page.evaluate(async (prefix) => (await caches.keys()).filter((key) => key.startsWith(prefix)).sort(), prefix))
    .toEqual([prefix + 'a', prefix + 'c', prefix + 'meta'].sort());
  // 待機版のコードが既存タブへ混ざらず、不変の大きな素材を再取得していない。
  expect(await page.evaluate(() => fetch('./app.js').then((r) => r.text()))).toContain("'a'");
  const counts = await (await request.get('/__test/update')).json();
  expect(counts[path + 'shared.bin']).toBe(1);
  await page.close();
  const next = await context.newPage();
  await next.goto(baseURL + path);
  await expect.poll(() => next.evaluate(() => (window as any).release)).toBe('c');
  expect(await next.evaluate(async (prefix) => (await caches.keys()).filter((key) => key.startsWith(prefix)).sort(), prefix))
    .toEqual([prefix + 'c', prefix + 'meta'].sort());
  await context.setOffline(true);
  await next.reload();
  expect(await next.evaluate(() => (window as any).release)).toBe('c');
});
