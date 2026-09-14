import { test, expect, type Page } from '@playwright/test';
import { openWithProgress, PROGRESS_KEY } from './helpers';

const progress = {
  level: 'apprentice', lastStyle: 'yagura',
  styles: {
    yagura: { games: 5, wins: 3, scolded: 2, tasksDone: ['yagura:castle', 'yagura:no-hint', 'yagura:win'], badges: ['first-win'] },
    shikenbisha: { games: 3, wins: 1, scolded: 0, tasksDone: ['shikenbisha:castle'], badges: [] },
  },
};

async function settings(page: Page, saved: object = progress) {
  await openWithProgress(page, saved);
  await page.getByRole('button', { name: '戦法・強さを変える' }).click();
  await expect(page.getByRole('heading', { name: '対局設定' })).toBeVisible();
}

test('叱られた戦法でも課題とばかもんを同じ行に表示し、免状を残す', async ({ page }) => {
  await settings(page);
  const row = page.getByRole('button', { name: /^矢倉/ });
  await expect(row.locator('.jr > em')).toHaveText(['3勝 5局', '課題 3/8・ばかもん 2回']);
  await expect(row.locator('.badge')).toHaveText(['初勝利']);
});

test('叱られていない戦法は課題を表示し、ばかもんを表示しない', async ({ page }) => {
  await settings(page);
  const row = page.getByRole('button', { name: /^四間飛車/ });
  await expect(row.locator('.jr > em')).toHaveText(['1勝 3局', '課題 1/8']);
  await expect(row).not.toContainText('ばかもん');
});

test('未対局の戦法も1行で課題の分母を表示する', async ({ page }) => {
  await settings(page, { level: 'apprentice', lastStyle: 'yagura', styles: {} });
  await expect(page.getByRole('button', { name: /^矢倉/ }).locator('.jr > em')).toHaveText(['未対局・課題 0/8']);
});

test('棒銀の分母は7、他の4戦法は8である', async ({ page }) => {
  await settings(page, { level: 'apprentice', lastStyle: 'yagura', styles: {} });
  // 実装と同じtasksForから期待値を生成せず、各戦法の仕様を固定する。
  for (const [name, text] of [
    ['矢倉', '未対局・課題 0/8'], ['四間飛車', '未対局・課題 0/8'],
    ['角換わり', '未対局・課題 0/8'], ['棒銀', '未対局・課題 0/7'], ['中飛車', '未対局・課題 0/8'],
  ]) await expect(page.getByRole('button', { name: new RegExp('^' + name) }).locator('.jr > em')).toHaveText([text]);
});

test('未知・重複の課題を表示数に含めず、保存データは削除しない', async ({ page }) => {
  const saved = {
    level: 'apprentice', lastStyle: 'bougin',
    styles: {
      bougin: { games: 12, wins: 4, scolded: 2, tasksDone: [
        'bougin:silver-guard', 'bougin:repel-silver', 'bougin:castle', 'bougin:no-scold',
        'bougin:no-bad', 'bougin:no-hint', 'bougin:win', 'bougin:retired-task', 'bougin:win',
      ], badges: [] },
      shikenbisha: { games: 2, wins: 0, scolded: 0, tasksDone: ['shikenbisha:castle', 'shikenbisha:retired-task'], badges: [] },
    },
  };
  await settings(page, saved);
  await expect(page.getByRole('button', { name: /^棒銀/ })).toContainText('課題 7/7・ばかもん 2回');
  await expect(page.getByRole('button', { name: /^四間飛車/ })).toContainText('課題 1/8');
  // 設定変更で実際に再保存しても、古い版の課題達成は失わない。
  await page.getByRole('button', { name: '門下生', exact: true }).click();
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PROGRESS_KEY);
  expect(stored.styles.bougin.tasksDone).toEqual(saved.styles.bougin.tasksDone);
  expect(stored.styles.shikenbisha.tasksDone).toEqual(saved.styles.shikenbisha.tasksDone);
});

for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}×${viewport.height}で成績行を増やさず、一覧の高さと説明の幅を保つ`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await settings(page);
    await page.evaluate(() => document.fonts.ready);
    const list = page.locator('.joseki-list');
    const measure = () => list.evaluate(el => ({
      height: el.getBoundingClientRect().height,
      rows: [...el.querySelectorAll('.joseki-btn')].map(row => ({
        height: row.getBoundingClientRect().height,
        lines: row.querySelectorAll('.jr > em').length,
        descWidth: row.querySelector('.jd')!.getBoundingClientRect().width,
        nowrap: [...row.querySelectorAll('.jr > em')].every(em => getComputedStyle(em).whiteSpace === 'nowrap'),
      })),
    }));
    const current = await measure();
    expect(current.rows.map(row => row.lines)).toEqual([2, 2, 1, 1, 1]);
    for (const row of current.rows) { expect(row.nowrap).toBe(true); expect(row.descWidth).toBeGreaterThanOrEqual(100); }
    // 同じフォント・幅で起点d74cf72の成績文字列に戻し、行追加による高さの退行を検出する。
    // 免状はそのまま残す。表示仕様の前後比較であり製品コードの分岐は変更しない。
    await list.evaluate(el => {
      const prior = [['3勝 5局', 'ばかもん 2回'], ['1勝 3局', '課題 1'], ['未対局'], ['未対局'], ['未対局']];
      [...el.querySelectorAll('.jr')].forEach((rec, index) => {
        rec.querySelectorAll(':scope > em').forEach(em => em.remove());
        rec.prepend(...prior[index].map(text => { const em = document.createElement('em'); em.textContent = text; return em; }));
      });
    });
    const before = await measure();
    expect(current.height).toBe(before.height);
    expect(current.rows.map(row => row.height)).toEqual(before.rows.map(row => row.height));
    test.info().annotations.push({ type: '一覧の高さ', description: JSON.stringify({ viewport, before, after: current }) });
  });
}
