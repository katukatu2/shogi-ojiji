import { test, expect, Page } from '@playwright/test';
import { openWithProgress, readProgress, savedProgress, startBouginGame, playMove, waitForMoves } from './helpers';

// 終局までの探索を省き、終局処理→成績→画面の接続を試す。将棋の終局規則は position.test.ts で別途検証。
async function finish(page: Page, result: 'win' | 'draw' | 'lose', reason?: string) {
  await page.evaluate(([result, reason]) => {
    (window as any).__ojiji.endGame(result, reason);
  }, [result, reason]);
  await page.getByRole('button', { name: 'オジジの一言を聞く' }).click();
}

test('引き分けは詰み扱いにならず、1局だけ記録し、戦法選択へ戻れる', async ({ page }) => {
  await startBouginGame(page);
  await page.evaluate(() => {
    (window as any).__ojiji.endGame('draw', '千日手');
    (window as any).__ojiji.endGame('draw', '千日手');
  });
  await expect(page.locator('.mate-banner')).toContainText('千日手');
  await expect(page.locator('.mate-banner')).not.toContainText('詰み');
  await page.getByRole('button', { name: 'オジジの一言を聞く' }).click();
  await expect(page.locator('.result')).toContainText('引き分けか。仕切り直しじゃ。');
  const progress = await readProgress(page) as any;
  expect(progress.styles.bougin.games).toBe(1);
  expect(progress.styles.bougin.wins).toBe(0);
  await page.locator('.result').getByRole('button', { name: '戦法を変える' }).click();
  await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();
});

test('勝利で昇級・免状が表示され、再戦と保存データに門下生が反映される', async ({ page }) => {
  await openWithProgress(page, {
    ...savedProgress('bougin'), winsAtLevel: { apprentice: 1 },
    styles: { yagura: { games: 3, wins: 1, scolded: 0, tasksDone: ['yagura:bishop-exchange', 'yagura:edge-attack', 'yagura:bousin'] } },
  });
  await page.getByRole('button', { name: '前回の設定で始める' }).click();
  await finish(page, 'win');
  await expect(page.locator('.result .promotion')).toContainText('門下生');
  await expect(page.locator('.result')).toContainText('免状じゃ。「初勝利」');
  expect((await readProgress(page))?.level).toBe('student');
  await page.locator('.result').getByRole('button', { name: '同じ設定でもう一局' }).click();
  await expect(page.locator('.topbar')).toContainText('対 棒銀・門下生');
});

test('今日の3手を拡大し、指す前・指した後を切り替えて閉じられる', async ({ page }) => {
  await startBouginGame(page);
  await playMove(page, [7, 7], [7, 6]);
  await waitForMoves(page, 2);
  // 序盤の好手では振り返りカードが出ない場合がある。保存形式と同じ、形勢が動いた記録を用意する。
  await page.evaluate(() => {
    (window as any).__ojiji.game().logs = [{
      ply: 1, movesBefore: [], usi: '7g7f', kanji: '▲７六歩', before: 0, after: -500,
      level: 4, headline: 'それは悪手じゃろう', why: '表示検証用の記録',
      betterKanji: '▲２六歩', betterUsi: '2g2f', praise: '', depth: 16,
    }];
  });
  await finish(page, 'lose');
  await expect(page.locator('.result .moment').first()).toBeVisible();
  await page.locator('.result .moment').first().click();
  const modal = page.locator('.overlay').filter({ has: page.getByRole('button', { name: '指した後', exact: true }) });
  await expect(modal.locator('.mini-board')).toBeVisible();
  await modal.getByRole('button', { name: '指した後', exact: true }).click();
  await expect(modal.getByRole('button', { name: '指した後', exact: true })).toHaveClass(/on/);
  await modal.getByRole('button', { name: '指す前', exact: true }).click();
  await expect(modal.getByRole('button', { name: '指す前', exact: true })).toHaveClass(/on/);
  await modal.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.result')).toBeVisible();
});
