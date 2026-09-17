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
  await expect(page.locator('.result h2')).toHaveText('負けはせんかったが、勝ちもせんかった。次は決めに来い。');
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
  await expect(page.locator('.result').getByRole('img', { name: '免状「初勝利」' })).toBeVisible();
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
  const progress = await readProgress(page);
  await page.locator('.result .moment').first().click();
  await expect(modal).toBeVisible();
  await page.goBack();
  await expect(modal).toBeHidden();
  await expect(page.locator('.result')).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state?.ojiji)).toBe(2);
  expect(await readProgress(page)).toEqual(progress);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
});

// 結果画面は「文字ばかりで見栄えが悪い。対局後に文字をいっぱい読ませるのは良くない」と指摘された。
// 免状と課題達成は朱印にして顔の左右に押し、オジジの一言は一つ、回数は 0 を出さない。
async function winWithStamps(page: Page, level: 'apprentice' | 'master') {
  await openWithProgress(page, { ...savedProgress('bougin', level) });
  await page.getByRole('button', { name: '前回の設定で始める' }).click();
  await waitForMoves(page, 0);
  await page.evaluate(() => { (window as any).__ojiji.game().task.done = () => true; });
  await finish(page, 'win');
  await expect(page.locator('.result')).toBeVisible();
}

for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}×${viewport.height}: 印 4 枚が顔の左右に収まり、台詞に重ならない`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // 師範代で叱られず課題も達成して勝つと、初勝利・叱られず勝利・皆伝・課題達成の 4 枚
    await winWithStamps(page, 'master');
    const result = page.locator('.result');
    for (const name of ['免状「初勝利」', '免状「叱られず勝利」', '免状「皆伝」', '課題達成']) {
      await expect(result.getByRole('img', { name })).toBeVisible();
    }
    await expect(result.locator('.title-change')).toContainText('称号');
    // 押す演出の途中は印が拡大しているので、演出が終わってから位置を測る
    await result.locator('.stamp').evaluateAll((els) => Promise.all(els.flatMap((e) => e.getAnimations().map((a) => a.finished))));
    const layout = await result.evaluate((panel) => {
      const box = (e: Element) => e.getBoundingClientRect();
      const p = box(panel), h2 = box(panel.querySelector('h2')!);
      return [...panel.querySelectorAll('.stamp')].map((s) => {
        const r = box(s);
        return {
          overlapsLine: r.bottom > h2.top && r.top < h2.bottom && r.right > h2.left && r.left < h2.right,
          inside: r.left >= p.left && r.right <= p.right,
        };
      });
    });
    expect(layout).toHaveLength(4);
    for (const s of layout) expect(s).toEqual({ overlapsLine: false, inside: true });
    // 以前の緑の帯と二行目の台詞は無い
    await expect(result.locator('.badge-new, .oneword')).toHaveCount(0);
  });
}

test('印は一枚ずつ押す演出があり、視差効果を減らす設定では最初から押してある', async ({ browser }) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const context = await browser.newContext({ reducedMotion, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await winWithStamps(page, 'apprentice');
    const anims = await page.locator('.result .stamp').evaluateAll((els) => els.map((e) => e.getAnimations().length));
    expect(anims.length).toBeGreaterThan(0);
    for (const n of anims) expect(n).toBe(reducedMotion === 'reduce' ? 0 : 1);
    await context.close();
  }
});

test('回数は 0 のものを出さず、課題を逃したら一言だけ', async ({ page }) => {
  await startBouginGame(page);
  await page.evaluate(() => {
    const g = (window as any).__ojiji.game();
    g.badMoves = 2;
    g.hints = 1;
    g.task.done = () => false;
  });
  await finish(page, 'lose');
  const result = page.locator('.result');
  await expect(result.locator('.score')).toHaveText('悪手 2 ／ ヒント 1');
  await expect(result.getByText('課題は次回', { exact: true })).toBeVisible();
  await expect(result.locator('.stamp')).toHaveCount(0);
});
