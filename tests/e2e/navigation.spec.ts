import { test, expect } from '@playwright/test';
import { open, startBouginGame, gameState } from './helpers';

test('対局からタイトルへ戻った後も、設定画面のブラウザ「戻る」が毎回働く', async ({ page }) => {
  await startBouginGame(page);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'タイトルへ', exact: true }).click();
  await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(0);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '戦法・強さを変える' }).click();
    await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(0);
  }
});

test('対局中のブラウザ「戻る」はキャンセルで続行でき、承諾するとタイトルへ戻る', async ({ page }) => {
  await startBouginGame(page);
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.goBack();
  await expect(page.locator('.board')).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(2);
  expect((await gameState(page))?.result).toBeNull();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.goBack();
  await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(0);
});

test('設定から戻った直後に開き直しても、画面と履歴が食い違わない', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'はじめる', exact: true }).click();
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'タイトル');
    button?.click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'はじめる')?.click();
  });
  await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(1);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
});
