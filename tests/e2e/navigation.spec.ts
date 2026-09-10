import { test, expect } from '@playwright/test';
import { open, startBouginGame, gameState } from './helpers';

for (const target of ['settings', 'game'] as const) {
  test(`履歴の移動が遅れても${target}を先に表示せず、戻る1回が働く`, async ({ page }) => {
    await startBouginGame(page);
    await page.evaluate(() => {
      const go = history.go.bind(history);
      history.go = (delta) => { window.setTimeout(() => go(delta), 250); };
    });
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'タイトルへ', exact: true }).click();
    const renderedEarly = await page.evaluate((target) => {
      // 履歴を畳んでいる間もタイトルの操作は受け付け、最後に選んだ画面へ進める。
      const settings = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('戦法・強さを変える'));
      if (!settings) throw new Error('設定を開くボタンがない');
      settings.click();
      if (target === 'game') {
        const play = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('前回の設定で始める'));
        if (!play) throw new Error('対局を開くボタンがない');
        play.click();
      }
      return !!document.querySelector(target === 'game' ? '.game' : '.settings-screen');
    }, target);
    expect(renderedEarly).toBe(false);
    if (target === 'settings') await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();
    else { await expect(page.locator('.board')).toBeVisible(); page.once('dialog', (dialog) => void dialog.accept()); }
    await page.goBack();
    await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
  });
}

for (const depth of [1, 2]) {
  test(`履歴${depth}段でリロードした後、タイトルの戻る1回で前のページへ戻る`, async ({ page }) => {
    await page.goto('/privacy.html');
    await page.getByRole('link', { name: /戻る/ }).click();
    await page.getByRole('button', { name: 'はじめる', exact: true }).click();
    if (depth === 2) await page.getByRole('button', { name: 'この設定で対局' }).click();
    await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(depth);
    await page.reload();
    await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/privacy.html$/);
  });
}

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
    const button = document.querySelector<HTMLButtonElement>('.settings-head .back');
    if (!button || button.textContent !== '‹ タイトル') throw new Error('設定画面の戻るボタンが見つからない');
    button.click();
    const start = [...document.querySelectorAll('button')].find((b) => b.textContent === 'はじめる');
    if (!start || !document.querySelector('.title-screen')) throw new Error('タイトルへ戻らなかった');
    start.click();
  });
  await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(1);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
});
