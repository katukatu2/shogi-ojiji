// 対局画面: 駒を動かす、オジジが応手する、形だけの NG でカットインが出る、ヒント・待った、投了と再戦。
// どれもエンジンの有無に依存しない（エンジンが無ければ「判定: 簡易」で進む）。
// 棒銀・見習いの対局を「前回の設定で始める」から始める（helpers.startBouginGame）。

import { test, expect } from '@playwright/test';
import { cell, engineLabel, gameState, playMove, readProgress, startBouginGame, waitForMoves, waitForQuiet } from './helpers';

test.describe('対局', () => {
  test('駒をタップして▲７六歩を指すと、最終手に出て、オジジが応手する', async ({ page }) => {
    await startBouginGame(page);

    // 最終手の欄の変化を記録しておく（オジジの応手が速いと「▲７六歩」の表示は一瞬なので、監視して拾う）
    await page.evaluate(() => {
      const target = document.querySelector('.lastmove');
      const log: string[] = [];
      (window as unknown as { __lastmoveLog: string[] }).__lastmoveLog = log;
      if (target) new MutationObserver(() => log.push(target.textContent ?? '')).observe(target, { childList: true, characterData: true, subtree: true });
    });

    // ７七の歩を選ぶと、行き先（７六）に印が出る
    await cell(page, 7, 7).click();
    await expect(cell(page, 7, 7)).toHaveClass(/sel/);
    await expect(cell(page, 7, 6)).toHaveClass(/target/);
    await cell(page, 7, 6).click();

    // 歩が７六へ移り、オジジが応手する
    await expect(cell(page, 7, 6)).toHaveText('歩');
    await expect(cell(page, 7, 7)).toBeEmpty();
    await waitForMoves(page, 2);

    const log = await page.evaluate(() => (window as unknown as { __lastmoveLog: string[] }).__lastmoveLog);
    expect(log.some((t) => t.startsWith('▲７六歩'))).toBe(true);
    // 応手のあとは最終手がオジジの手（△）になり、３手目
    await expect(page.locator('.lastmove')).toHaveText(/^△/);
    await expect(page.getByText('3手目')).toBeVisible();
    const state = await gameState(page);
    expect(state?.busy).toBe(false);
    expect(state?.result).toBeNull();

    test.info().annotations.push({ type: '判定', description: await engineLabel(page) });
  });

  test('形だけの NG（▲４八玉で玉飛接近）でカットインが出て、「指し直す」で戻る', async ({ page }) => {
    await startBouginGame(page);
    await playMove(page, [7, 7], [7, 6]);
    await waitForMoves(page, 2);

    // ５九の玉を飛車の隣（４八）へ。COMMON_BAD の king-near-rook（エンジン不要）
    await playMove(page, [5, 9], [4, 8]);

    const cutin = page.locator('.cutin');
    await expect(cutin).toBeVisible();
    await expect(cutin.getByText('それは悪手じゃろう')).toBeVisible();
    await expect(cutin.getByText('玉飛接近すべからず！')).toBeVisible();
    await expect(cutin.getByText('飛車のそばに玉を置くな')).toBeVisible();
    await expect(page.getByText('叱られ 0回')).toBeVisible(); // 段階 4 は「ばかもーん」ではないので数えない

    await cutin.getByRole('button', { name: '指し直す' }).click();
    await expect(cutin).toBeHidden();

    // 手は指されておらず、玉は５九のまま
    const state = await gameState(page);
    expect(state?.moves).toBe(2);
    expect(state?.badMoves).toBe(1);
    expect(state?.busy).toBe(false);
    await expect(cell(page, 5, 9)).toHaveText('玉');
    await expect(cell(page, 4, 8)).toBeEmpty();
    await expect(page.getByText('3手目')).toBeVisible();

    // 指し直して対局が続く（▲６八玉は居飛車の正しい方向）
    await playMove(page, [5, 9], [6, 8]);
    await expect(cell(page, 6, 8)).toHaveText('玉');
    await waitForMoves(page, 4);
  });

  test('「ヒント」と「待った」が動く（待ったで一組戻る）', async ({ page }) => {
    await startBouginGame(page);
    await playMove(page, [7, 7], [7, 6]);
    await waitForMoves(page, 2);
    await waitForQuiet(page);

    // ヒント: エンジンがあれば手を緑で示し、無ければその旨を言う。どちらも吹き出しの題は「ヒント」
    // （課題の札に「ヒント」の文字が入ることがあるので exact で探す）
    await page.getByRole('button', { name: 'ヒント', exact: true }).click();
    const bubble = page.locator('.bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText('ヒント');
    const text = await bubble.innerText();
    if (text.includes('ワシなら')) {
      expect((await gameState(page))?.hints).toBe(1);
      await expect(page.locator('.board .cell.hint').first()).toBeVisible();
    } else {
      expect(text).toContain('ヒントは出せん');
    }

    // 待った: 自分の手とオジジの手を一組戻す
    await page.getByRole('button', { name: '待った', exact: true }).click();
    await expect(page.getByText('先手番（あなた）')).toBeVisible();
    await expect(page.getByText('1手目')).toBeVisible();
    await expect(cell(page, 7, 7)).toHaveText('歩');
    await expect(cell(page, 7, 6)).toBeEmpty();
    const state = await gameState(page);
    expect(state?.moves).toBe(0);
    expect(state?.matta).toBe(1);
    await expect(page.locator('.board .cell.hint')).toHaveCount(0);

    // 戻したあとも指せる
    await playMove(page, [2, 7], [2, 6]);
    await waitForMoves(page, 2);
  });

  test('「投了する」→ 結果画面 → 「同じ設定でもう一局」で新しい対局が始まる', async ({ page }) => {
    await startBouginGame(page);
    await playMove(page, [7, 7], [7, 6]);
    await waitForMoves(page, 2);

    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.accept();
    });
    await page.getByRole('button', { name: '投了する', exact: true }).click();
    expect(dialogs).toEqual(['投了しますか？']);

    // 結果画面（対局画面の操作ボタンにも「タイトルへ」があるので、結果の板の中で探す）
    const result = page.locator('.panel.result');
    await expect(result.getByRole('heading', { name: '投了か。潔いのは悪くない。' })).toBeVisible();
    await expect(result.getByText('ばかもん 0 ／ 悪手 0 ／ ヒント 0 ／ 待った 0')).toBeVisible();
    await expect(result.getByText(/^課題は次回: /)).toBeVisible();
    await expect(result.getByRole('button', { name: '戦法を変える' })).toBeVisible();
    await expect(result.getByRole('button', { name: 'タイトルへ' })).toBeVisible();
    expect((await gameState(page))?.result).toBe('resign');

    // 成績に 1 局が記録される
    const progress = await readProgress(page);
    expect((progress?.styles as Record<string, { games: number; wins: number }>).bougin.games).toBe(1);
    expect((progress?.styles as Record<string, { games: number; wins: number }>).bougin.wins).toBe(0);

    // 同じ設定でもう一局
    await result.getByRole('button', { name: '同じ設定でもう一局' }).click();
    await expect(page.getByText('対局開始', { exact: true })).toBeVisible();
    await expect(result).toHaveCount(0);
    await expect(page.locator('.topbar').getByText('対 棒銀・見習い')).toBeVisible();
    await expect(page.getByText('先手番（あなた）')).toBeVisible();
    await expect(cell(page, 7, 7)).toHaveText('歩');
    const state = await gameState(page);
    expect(state?.moves).toBe(0);
    expect(state?.result).toBeNull();
  });
});
