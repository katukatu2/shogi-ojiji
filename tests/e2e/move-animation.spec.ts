// 駒が動く演出（src/main.ts の「駒が動く演出」）。
// 演出は 0.15 秒で終わるので、試験の中だけ長くして、動いている最中の状態を確実に捕まえる。
import { test, expect, type Page } from '@playwright/test';
import { startBouginGame, playMove, waitForMoves, cell } from './helpers';

const LONG = 30_000;

async function setAnimMs(page: Page, ms: number): Promise<void> {
  await page.evaluate((ms) => (window as unknown as { __ojiji: { setMoveAnimMs(n: number): void } }).__ojiji.setMoveAnimMs(ms), ms);
}

// そのマスの駒に付いている演出（無ければ null）
function slideOf(page: Page, file: number, rank: number) {
  return cell(page, file, rank).locator('.piece').evaluate((el) => {
    const a = el.getAnimations()[0] as Animation | undefined;
    if (!a) return null;
    const kf = (a.effect as KeyframeEffect).getKeyframes();
    return { from: String(kf[0].transform), to: String(kf[kf.length - 1].transform), time: Number(a.currentTime) };
  });
}

// 盤の上で演出が付いている駒の数
function slidingCount(page: Page): Promise<number> {
  return page.evaluate(() => Array.from(document.querySelectorAll('.board .piece')).filter((p) => p.getAnimations().length > 0).length);
}

// オジジの最終手の移動先（筋・段）
function ojijiTo(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const m = (window as unknown as { __ojiji: { game(): { lastMove: { to: { x: number; y: number } } } } }).__ojiji.game().lastMove;
    return [9 - m.to.x, m.to.y + 1] as [number, number];
  });
}

test('自分の駒は移動元から滑り、最後は CSS どおりの位置に収まる', async ({ page }) => {
  await startBouginGame(page);
  await setAnimMs(page, LONG);
  await playMove(page, [7, 7], [7, 6]);
  const s = await slideOf(page, 7, 6);
  expect(s).not.toBeNull();
  // ７七 から ７六 へ: 1 マス下（画面では下）から上がってくる。横のずれは無い
  const m = s!.from.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/);
  expect(m).not.toBeNull();
  expect(Math.abs(Number(m![1]))).toBeLessThan(1);
  expect(Number(m![2])).toBeGreaterThan(20);
  expect(s!.to).toBe('none');
});

test('オジジの駒も滑り、自分の駒の演出はオジジの手で置き換わる', async ({ page }) => {
  await startBouginGame(page);
  await setAnimMs(page, LONG);
  await playMove(page, [7, 7], [7, 6]);
  await waitForMoves(page, 2);
  const [f, r] = await ojijiTo(page);
  const s = await slideOf(page, f, r);
  expect(s).not.toBeNull();
  // 後手の駒は回転を保ったまま滑る
  expect(s!.from).toContain('rotate(180deg)');
  expect(s!.to).toBe('rotate(180deg)');
  expect(await slideOf(page, 7, 6)).toBeNull();
  expect(await slidingCount(page)).toBe(1);
});

test('滑っている途中で描き直しても、最初からやり直さず続きから動く', async ({ page }) => {
  await startBouginGame(page);
  await setAnimMs(page, LONG);
  // 見習いのオジジは 1 秒足らずで応じるので、自分の駒では途中の描き直しを試せない。
  // オジジが指したあとは自分の番で盤が止まるので、オジジの駒で試す
  await playMove(page, [7, 7], [7, 6]);
  await waitForMoves(page, 2);
  const [f, r] = await ojijiTo(page);
  const t0 = (await slideOf(page, f, r))!.time;
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as unknown as { __ojiji: { render(): void } }).__ojiji.render());
  const s = await slideOf(page, f, r);
  expect(s).not.toBeNull();
  expect(s!.time).toBeGreaterThan(t0 + 700);
});

test('「待った」で戻したときは、前のオジジの手をもう一度滑らせない', async ({ page }) => {
  await startBouginGame(page);
  await playMove(page, [7, 7], [7, 6]);
  await waitForMoves(page, 2);
  await playMove(page, [2, 7], [2, 6]);
  await waitForMoves(page, 4);
  await setAnimMs(page, LONG);
  const matta = page.getByRole('button', { name: '待った', exact: true });
  await expect(matta).toBeEnabled();
  await matta.click();
  await waitForMoves(page, 2);
  expect(await slidingCount(page)).toBe(0);
});

test('演出が終わると、重なり順とタップの設定が元に戻る', async ({ page }) => {
  await startBouginGame(page);
  await setAnimMs(page, 60);
  await playMove(page, [7, 7], [7, 6]);
  await waitForMoves(page, 2);
  // オジジの駒の演出も終わるまで待ち、盤のどの駒にも演出の設定が残っていないことを見る
  await expect.poll(() => slidingCount(page)).toBe(0);
  const leftovers = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.board .piece'))
    .filter((p) => p.style.zIndex !== '' || p.style.pointerEvents !== '').length);
  expect(leftovers).toBe(0);
});

test.describe('視差効果を減らす設定', () => {
  test.use({ reducedMotion: 'reduce' });
  test('駒を滑らせない', async ({ page }) => {
    await startBouginGame(page);
    await setAnimMs(page, LONG);
    await playMove(page, [7, 7], [7, 6]);
    expect(await slideOf(page, 7, 6)).toBeNull();
    expect(await slidingCount(page)).toBe(0);
  });
});
