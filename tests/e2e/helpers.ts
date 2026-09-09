// E2E テストの共通部品。画面の文言と構造は src/main.ts に合わせてある。
// - 成績は localStorage の ojiji.progress.v2（src/game/progress.ts）
// - 盤のマスは .board .cell が 9×9 を行優先で並ぶ（x = 9 - 筋、y = 段 - 1）
// - 開発サーバーでは window.__ojiji から対局の状態が取れる（main.ts の末尾。import.meta.env.DEV のときだけ）

import { expect, Locator, Page } from '@playwright/test';

export const PROGRESS_KEY = 'ojiji.progress.v2';

// オジジの応手を待つ時間。エンジンがあれば判定と手選びで数秒かかる
export const REPLY_TIMEOUT = 30_000;

// 「前回の設定で始める」を出すための保存内容
export function savedProgress(lastStyle: string, level: 'apprentice' | 'student' | 'master' = 'apprentice'): object {
  return { level, styles: {}, lastStyle };
}

// 盤のマスの index。７七 → 56、７六 → 47
export function cellIndex(file: number, rank: number): number {
  return (rank - 1) * 9 + (9 - file);
}

export function cell(page: Page, file: number, rank: number): Locator {
  return page.locator('.board .cell').nth(cellIndex(file, rank));
}

// 駒をタップして動かす（成りの選択が出る手には使わない）
export async function playMove(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await cell(page, from[0], from[1]).click();
  await cell(page, to[0], to[1]).click();
}

// 対局の状態（window.__ojiji 経由）
export interface GameSnapshot {
  moves: number; // 指された手の数（先手・後手の合計）
  hints: number;
  matta: number;
  badMoves: number;
  scolded: number;
  busy: boolean;
  result: string | null;
}

export function gameState(page: Page): Promise<GameSnapshot | null> {
  return page.evaluate(() => {
    interface Ojiji {
      game(): { pos: { moves: unknown[] }; hints: number; matta: number; badMoves: number; scolded: number; busy: boolean; result: string | null } | null;
    }
    const g = (window as unknown as { __ojiji?: Ojiji }).__ojiji?.game();
    if (!g) return null;
    return { moves: g.pos.moves.length, hints: g.hints, matta: g.matta, badMoves: g.badMoves, scolded: g.scolded, busy: g.busy, result: g.result };
  });
}

export async function movesCount(page: Page): Promise<number> {
  return (await gameState(page))?.moves ?? -1;
}

// 手数が n になるまで待つ（オジジの応手待ちに使う）
export async function waitForMoves(page: Page, n: number): Promise<void> {
  await expect.poll(() => movesCount(page), { timeout: REPLY_TIMEOUT, message: `手数が ${n} になるのを待つ` }).toBe(n);
}

// エンジンが使えない環境では「将棋エンジンが使えない環境です」の案内が画面下に固定で出て、操作ボタンに重なる。
// 出ていれば「わかった」で閉じる（案内は body 直下なので、閉じれば画面が変わっても出てこない）
export async function dismissEngineNotice(page: Page): Promise<void> {
  const ok = page.locator('.engine-notice').getByRole('button', { name: 'わかった' });
  if (await ok.isVisible()) await ok.click();
}

// アプリを開く。OJIJI_E2E_NO_ENGINE=1 なら、やねうら王のスクリプト（public/engine/yaneuraou.k-p.js）を読ませずに
// 「判定: 簡易」の環境を再現する（src/engine/ のモジュールまで止めないよう、ファイル名で絞る）
export async function open(page: Page): Promise<void> {
  if (process.env.OJIJI_E2E_NO_ENGINE) await page.route('**/engine/yaneuraou.k-p.js', (route) => route.abort());
  await page.goto('/');
  await dismissEngineNotice(page);
}

// 保存済みの設定がある状態で開く。addInitScript なので、この page の以後の読み込みでも同じ内容が入る
export async function openWithProgress(page: Page, progress: object): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [PROGRESS_KEY, JSON.stringify(progress)] as [string, string],
  );
  await open(page);
}

// 保存内容を読む
export function readProgress(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }, PROGRESS_KEY);
}

// 対局画面に入ったことを確かめる（上の帯の「対 ○○・△△」と、最終手の欄の「先手番（あなた）」）
export async function expectGameScreen(page: Page, title: string): Promise<void> {
  await expect(page.locator('.topbar').getByText(title)).toBeVisible();
  await expect(page.getByText('先手番（あなた）')).toBeVisible();
}

// 「前回の設定で始める」から棒銀・見習いの対局に入る（対局中のテストの入口）
export async function startBouginGame(page: Page): Promise<void> {
  await openWithProgress(page, savedProgress('bougin'));
  await page.getByRole('button', { name: '前回の設定で始める' }).click();
  await expectGameScreen(page, '対 棒銀・見習い');
  await waitForMoves(page, 0);
}

// 吹き出しが消えて、次の台詞を出せるようになるまで待つ。
// main.ts の showToast は、吹き出しが出ている間と消えてから 1.5 秒（BUBBLE_GAP_MS）は新しい台詞を出さない
export async function waitForQuiet(page: Page): Promise<void> {
  await expect(page.locator('.bubble')).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(1_600);
}

// 判定の表示（「判定: エンジン」「判定: 簡易」「判定: 準備中…」）。記録用
export function engineLabel(page: Page): Promise<string> {
  return page.locator('.topbar .engine').innerText();
}
