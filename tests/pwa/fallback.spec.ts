import { test, expect } from '@playwright/test';

test('製品版の簡易判定でも実際に対局・投了し、架空の形勢を表示せず結果へ進む', async ({ page, request }, info) => {
  const path = `/fault/no-engine-${info.project.name}/`;
  expect((await request.post('/__test/fault', { data: { path: path + 'engine/yaneuraou.k-p.js', mode: 'missing' } })).ok()).toBe(true);
  await page.goto(path);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller && crossOriginIsolated).catch(() => false)).toBe(true);
  expect(await page.evaluate(() => '__ojiji' in window)).toBe(false);
  await page.locator('.engine-notice').getByRole('button', { name: 'わかった' }).click();
  await page.getByRole('button', { name: 'はじめる', exact: true }).click();
  await page.getByRole('button', { name: 'この設定で対局' }).click();
  await expect(page.locator('.topbar .engine')).toHaveText('判定: 簡易');
  const cell = (file: number, rank: number) => page.locator('.board .cell').nth((rank - 1) * 9 + 9 - file);
  await cell(7, 7).click(); await cell(7, 6).click();
  await expect(page.getByText('3手目', { exact: true })).toBeVisible();
  await cell(5, 9).click(); await cell(4, 8).click();
  const cutin = page.locator('.cutin');
  await expect(cutin).toContainText('玉飛接近すべからず！');
  await expect(cutin.locator('.evalline')).toHaveCount(0);
  await cutin.getByRole('button', { name: 'このまま進む', exact: true }).click();
  await expect(page.getByText('5手目', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '投了する', exact: true }).click();
  // オジジの一言は一つだけ（投了は戦法との戦い方の教え）
  await expect(page.locator('.result h2')).not.toBeEmpty();
  await expect(page.locator('.result .score')).toContainText('悪手 1');
  await expect(page.locator('.result .moment')).toHaveCount(0); // 評価の無い対局から形勢カードを捏造しない
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('ojiji.progress.v2')!));
  expect(Object.values(progress.styles).reduce((total: number, rec: any) => total + rec.games, 0)).toBe(1);
});
