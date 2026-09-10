// 画面の動線: タイトル → 対局設定 → 対局。設定の保存と、初回の動線。
// 各テストは新しいブラウザ文脈（localStorage は空）で始まる。前回の設定が要るテストは openWithProgress で作る。

import { test, expect } from '@playwright/test';
import { dismissEngineNotice, expectGameScreen, open, openWithProgress, readProgress, savedProgress, PROGRESS_KEY } from './helpers';

test.describe('画面の動線', () => {
  test('タイトル → 戦法・強さを変える → 対局設定で棒銀・見習いを選ぶ → 対局画面', async ({ page }) => {
    // 2 回目以降のタイトル（前回は矢倉）
    await openWithProgress(page, savedProgress('yagura'));
    await expect(page.getByRole('heading', { name: '将棋オジジの定石指南' })).toBeVisible();
    const quick = page.getByRole('button', { name: '前回の設定で始める' });
    await expect(quick).toContainText('矢倉・見習い');

    await page.getByRole('button', { name: '戦法・強さを変える' }).click();
    await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();
    await expect(page.getByText('オジジの強さ')).toBeVisible();
    await expect(page.getByText('オジジの戦法')).toBeVisible();

    // 前回の戦法（矢倉）が選択済みで開く
    const go = page.getByRole('button', { name: 'この設定で対局' });
    await expect(go).toContainText('矢倉・見習い');

    // 戦法と強さを選び直す（戦法の行は「棒銀」で始まる。開始ボタンの「棒銀・見習い」と混同しない）
    await page.getByRole('button', { name: /^棒銀/ }).click();
    await page.getByRole('button', { name: '見習い', exact: true }).click();
    await expect(go).toContainText('棒銀・見習い');
    await expect(page.getByText('棒銀の駒組み')).toBeVisible();

    await go.click();

    // 対局画面。「対局開始」の演出が出て消える
    const banner = page.getByText('対局開始', { exact: true });
    await expect(banner).toBeVisible();
    await expectGameScreen(page, '対 棒銀・見習い');
    await expect(page.getByText('1手目')).toBeVisible();
    await expect(page.getByText('叱られ 0回')).toBeVisible();
    await expect(page.getByRole('button', { name: /^課題: / })).toBeVisible();
    await expect(banner).toBeHidden();

    // 保存された設定
    const progress = await readProgress(page);
    expect(progress?.lastStyle).toBe('bougin');
    expect(progress?.level).toBe('apprentice');
  });

  test('設定の保存: 対局を始めたあと再読み込みすると、タイトルの主ボタンに前回の戦法・強さが出る', async ({ page }) => {
    await open(page);
    // 初回はまだ何も保存されていない
    expect(await readProgress(page)).toBeNull();

    await page.getByRole('button', { name: 'はじめる' }).click();
    await page.getByRole('button', { name: /^棒銀/ }).click();
    await page.getByRole('button', { name: '見習い', exact: true }).click();
    await page.getByRole('button', { name: 'この設定で対局' }).click();
    await expectGameScreen(page, '対 棒銀・見習い');

    await page.reload();
    await dismissEngineNotice(page);

    const quick = page.getByRole('button', { name: '前回の設定で始める' });
    await expect(quick).toBeVisible();
    await expect(quick).toContainText('棒銀・見習い');
    await expect(page.getByRole('button', { name: '戦法・強さを変える' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'はじめる' })).toHaveCount(0);

    // 1 タップで同じ設定の対局に入れる
    await quick.click();
    await expectGameScreen(page, '対 棒銀・見習い');
  });

  test('初回の動線: 保存が無ければ「はじめる」→ 対局設定を必ず通って対局へ', async ({ page }) => {
    await open(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await dismissEngineNotice(page);
    expect(await page.evaluate((key) => localStorage.getItem(key), PROGRESS_KEY)).toBeNull();

    // タイトルには「はじめる」だけ。前回の設定のボタンは出ない
    const start = page.getByRole('button', { name: 'はじめる' });
    await expect(start).toBeVisible();
    await expect(page.getByRole('button', { name: '前回の設定で始める' })).toHaveCount(0);
    await expect(page.getByText('遊び方')).toBeVisible();

    await start.click();
    await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();

    // 既定は最初の戦法（矢倉）と見習い
    const go = page.getByRole('button', { name: 'この設定で対局' });
    await expect(go).toContainText('矢倉・見習い');
    await expect(page.getByText('成績: まだ指していない')).toBeVisible();

    // 設定からタイトルへ戻れる
    await page.getByRole('button', { name: 'タイトル' }).click();
    await expect(start).toBeVisible();

    // もう一度設定を通って対局へ
    await start.click();
    await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();
    await go.click();
    await expectGameScreen(page, '対 矢倉・見習い');

    const progress = await readProgress(page);
    expect(progress?.lastStyle).toBe('yagura');
  });
});
