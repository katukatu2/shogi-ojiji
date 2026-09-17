import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
test(`${viewport.width}×${viewport.height} 製品版で実際に角を損する手を指し、投了後にその局面を振り返れる`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller && crossOriginIsolated).catch(() => false)).toBe(true);
  expect(await page.evaluate(() => '__ojiji' in window)).toBe(false);
  await page.getByRole('button', { name: 'はじめる', exact: true }).click();
  await page.getByRole('button', { name: 'この設定で対局' }).click();
  await expect(page.locator('.topbar .engine')).toHaveText('判定: エンジン');
  const cell = (file: number, rank: number) => page.locator('.board .cell').nth((rank - 1) * 9 + 9 - file);
  await cell(7, 7).click();
  await cell(7, 6).click();
  await expect(page.getByText('3手目', { exact: true })).toBeVisible();
  // 初手の応手を実盤から確認。角道が閉じていれば３三へ成り捨て、開いていれば５五へ出して取らせる。
  const closed = (await cell(3, 3).textContent()) === '歩';
  const to = closed ? [3, 3] : [5, 5];
  await cell(8, 8).click();
  await expect(cell(to[0], to[1])).toHaveClass(/target/);
  await cell(to[0], to[1]).click();
  if (closed) await page.getByRole('button', { name: '成る', exact: true }).click();
  const cutin = page.locator('.cutin');
  await expect(cutin).toBeVisible();
  await expect(cutin).toContainText(/角|馬/);
  const played = closed ? '▲３三角成' : '▲５五角';
  await expect(cutin).toContainText(played);
  await expect(cutin.locator('.evalline')).toContainText('形勢の目安');
  await expect(cutin.locator('.evalline')).not.toHaveText(/[0-9%]|読み|正解/);
  await expect(cutin.locator('.better')).toContainText('候補の手:');
  await expect(cutin.getByRole('button', { name: '指し直す', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(cutin.getByRole('button', { name: 'このまま進む', exact: true })).toBeInViewport({ ratio: 1 });
  await cutin.getByRole('button', { name: 'このまま進む', exact: true }).click();
  await expect(page.getByText('5手目', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => { expect(dialog.message()).toBe('投了しますか？'); void dialog.accept(); });
  await page.getByRole('button', { name: '投了する', exact: true }).click();
  const result = page.locator('.result');
  // オジジの一言は一つだけ（投了は戦法との戦い方の教え）
  await expect(result.locator('h2')).not.toBeEmpty();
  const moment = result.locator('.moment').filter({ hasText: played });
  await expect(moment).toHaveCount(1);
  await moment.click();
  const modal = page.locator('.moment-view');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.moment-eval')).toContainText('形勢の目安（先手視点）');
  await expect(modal.locator('.moment-eval')).not.toHaveText(/[0-9%]|読み/);
  const before = await page.locator('.board .cell').allTextContents();
  // 実対局の現在盤とは別に、3手目の指す前を復元していることを確認する。
  const mini = modal.locator('.mini-board .cell');
  const original = await mini.allTextContents();
  expect(original).toHaveLength(81);
  expect(original[64]).toBe('角'); // ８八
  expect(original).not.toEqual(before);
  await modal.getByRole('button', { name: '指した後', exact: true }).click();
  await expect(mini.nth(64)).toBeEmpty();
  await expect(mini.nth((to[1] - 1) * 9 + 9 - to[0])).toHaveText(closed ? '馬' : '角');
  await modal.getByRole('button', { name: '指す前', exact: true }).click();
  await expect(mini).toHaveText(original);
  await page.goBack();
  await expect(modal).toBeHidden();
  await expect(result).toBeVisible();
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('ojiji.progress.v2')!));
  expect(Object.values(progress.styles).reduce((total: number, rec: any) => total + rec.games, 0)).toBe(1);
});
}
