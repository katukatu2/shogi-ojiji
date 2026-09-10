import { test } from '@playwright/test';
import { runProductGame } from '../../scripts/product-game';

test('製品UIで初手から詰みまで指し、結果と進捗を保存する', async ({ page, baseURL }, testInfo) => {
  await runProductGame(page, { url: baseURL!, out: testInfo.outputPath('game') });
});
