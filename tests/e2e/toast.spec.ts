import { test, expect } from '@playwright/test';
import { startBouginGame } from './helpers';

test('古い対局の吹き出し終了時刻を過ぎても、新しい対局の台詞を消さない', async ({ page }) => {
  await startBouginGame(page);
  // 表示タイマーの競合を固定。対局・画面の遷移は実際のボタンを通す。
  await page.clock.install();
  await page.evaluate(() => (window as any).__ojiji.showToast('thinking', '前の対局', '古い台詞', 1000));
  await expect(page.locator('.bubble')).toContainText('古い台詞');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'タイトルへ', exact: true }).click();
  await page.getByRole('button', { name: '前回の設定で始める' }).click();
  await page.clock.runFor(1100);
  // 古い終了処理が新しい対局に空白時間を設定していた場合、ここで台詞が出ず失敗する。
  await page.evaluate(() => (window as any).__ojiji.showToast('thinking', '今回の対局', '新しい台詞', 6000));
  await expect(page.locator('.bubble')).toContainText('新しい台詞');
  await page.clock.runFor(1500);
  await expect(page.locator('.bubble')).toBeVisible();
  await expect(page.locator('.bubble')).toContainText('新しい台詞');
});
