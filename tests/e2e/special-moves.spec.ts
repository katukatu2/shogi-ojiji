import { test, expect } from '@playwright/test';
import { cell, playMove, startBouginGame, waitForMoves } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route('**/engine/yaneuraou.k-p.js', (route) => route.abort());
  await startBouginGame(page);
  // ルール単体テストと同じく、成り／打ちの直前局面を用意して UI の操作を検証する。
  await page.evaluate(() => {
    const api = (window as any).__ojiji;
    const g = api.game();
    const p = new g.pos.constructor();
    p.set(4, 8, { type: 'OU', color: 0 });
    p.set(4, 0, { type: 'OU', color: 1 });
    p.set(2, 3, { type: 'FU', color: 0 });
    p.hands[0].GI = 1;
    g.pos = p;
    api.render();
  });
});

for (const promote of [true, false]) {
  test(`敵陣へ入る歩を${promote ? '成る' : '成らず'}で確定し、対局が続く`, async ({ page }) => {
    await playMove(page, [7, 4], [7, 3]);
    await page.getByRole('button', { name: promote ? '成る' : '成らない', exact: true }).click();
    await expect(cell(page, 7, 3)).toHaveText(promote ? 'と' : '歩');
    await waitForMoves(page, 2);
    expect(await page.evaluate(() => (window as any).__ojiji.game().pos.moves[0].promote)).toBe(promote);
  });
}

test('持ち駒の銀を打つと持ち駒から減り、盤に置かれる', async ({ page }) => {
  await page.locator('.hp').filter({ hasText: /^銀$/ }).click();
  await cell(page, 6, 7).click();
  await expect(cell(page, 6, 7)).toHaveText('銀');
  await waitForMoves(page, 2);
  const first = await page.evaluate(() => (window as any).__ojiji.game().pos.moves[0]);
  expect(first.from).toBeNull();
  expect(first.piece).toBe('GI');
  await expect(page.locator('.hp').filter({ hasText: /^銀$/ })).toHaveCount(0);
});

test('簡易AIはWorkerで合法手を選び、元の局面を変更しない', async ({ page }) => {
  const workerStarted = page.waitForEvent('worker');
  const result = page.evaluate(async () => {
    const { chooseLocalMove } = await import('/src/ai/local.ts');
    const p = (window as any).__ojiji.game().pos;
    const before = p.toSfen();
    const move = await chooseLocalMove(p);
    return { before, after: p.toSfen(), legal: p.legalMoves().some((m: unknown) => JSON.stringify(m) === JSON.stringify(move)) };
  });
  const worker = await workerStarted;
  expect(worker.url()).toContain('local-worker');
  const data = await result;
  expect(data.legal).toBe(true);
  expect(data.after).toBe(data.before);
});
