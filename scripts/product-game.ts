// 製品UIを初期局面から詰みまで操作する。CLIとPlaywrightの共通処理。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { Engine, EngineFactory } from '../src/ai/engine';
import { Position } from '../src/engine/position';
import { moveToUsi } from '../src/engine/notation';
import { PIECE_KANJI } from '../src/engine/types';

export async function runProductGame(page: Page, { url, out, maxPlies = 240 }: { url: string; out: string; maxPlies?: number }): Promise<void> {
  mkdirSync(out, { recursive: true });
  const require = createRequire(import.meta.url);
  const engine = new Engine(require('@mizarjp/yaneuraou.k-p') as EngineFactory, 1);
  page.setDefaultTimeout(30000);
  const pos = Position.initial();
  let playerBishopCapturedBishop = false;
  let playerBishopWasCaptured = false;
  const events: unknown[] = [];
  const boardSignature = () => pos.board.map((p) => p ? `${p.color}:${PIECE_KANJI[p.type]}` : '').join(',');
  const readBoard = () => page.locator('.board .cell').evaluateAll((cells) => cells.map((c) => {
    const p = c.querySelector('.piece');
    return p ? `${p.classList.contains('gote') ? 1 : 0}:${p.textContent}` : '';
  }).join(','));
  const cell = (x: number, y: number) => page.locator('.board .cell').nth(y * 9 + x);
  async function openResult(): Promise<void> {
    // 詰みはまず盤上で確認し、その後ユーザーが結果を開く二段階の動線。
    const next = page.getByRole('button', { name: 'オジジの一言を聞く', exact: true });
    await expect(next).toBeVisible();
    await page.screenshot({ path: join(out, 'mate.png') });
    await next.click();
    await expect(page.locator('.result')).toBeVisible();
  }
  try {
    await engine.init();
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller && crossOriginIsolated).catch(() => false)).toBe(true);
    expect(await page.evaluate(() => '__ojiji' in window)).toBe(false);
    await page.getByRole('button', { name: 'はじめる', exact: true }).click();
    await page.getByRole('button', { name: 'この設定で対局' }).click();
    await expect(page.locator('.topbar .engine')).toHaveText('判定: エンジン');
    expect(await readBoard()).toBe(boardSignature());
    const limit = maxPlies;
    for (let turn = 0; turn < limit / 2; turn++) {
      if (await page.locator('.result').isVisible()) break;
      if (await page.getByRole('button', { name: 'オジジの一言を聞く', exact: true }).isVisible()) { await openResult(); break; }
      await expect(page.getByRole('button', { name: 'ヒント', exact: true })).toBeEnabled();
      const legal = pos.legalMoves();
      const analysis = await engine.analyze(pos.moves.map(moveToUsi), { depth: 10 });
      const move = legal.find((m) => moveToUsi(m) === analysis.bestmove);
      if (!move) throw new Error(`No legal player move: ${analysis.bestmove}`);
      if (move.from) await cell(move.from.x, move.from.y).click();
      else await page.locator('.hand.sente .hp').filter({ hasText: PIECE_KANJI[move.piece] }).click();
      await expect(cell(move.to.x, move.to.y)).toHaveClass(/target/);
      await cell(move.to.x, move.to.y).click();
      if (legal.some((m) => m.from?.x === move.from?.x && m.from?.y === move.from?.y && m.to.x === move.to.x && m.to.y === move.to.y && m.promote !== move.promote)) {
        await page.getByRole('button', { name: move.promote ? '成る' : '成らない', exact: true }).click();
      }
      await expect.poll(async () => (await page.locator('.cutin').isVisible()) || (await page.locator('.result').isVisible()) || (await readBoard()) !== boardSignature()).toBe(true);
      if (await page.locator('.cutin').isVisible()) {
        events.push({ type: 'cutin', ply: pos.moves.length + 1, text: await page.locator('.cutin').innerText() });
        await page.getByRole('button', { name: 'このまま進む', exact: true }).click();
      }
      const victim = pos.get(move.to.x, move.to.y);
      if ((move.piece === 'KA' || move.piece === 'UM') && (victim?.type === 'KA' || victim?.type === 'UM')) playerBishopCapturedBishop = true;
      pos.apply(move);
      if (pos.isGameOver()) {
        await openResult();
        expect(await readBoard()).toBe(boardSignature());
        break;
      }
      await expect.poll(async () => (await page.getByRole('button', { name: 'オジジの一言を聞く', exact: true }).isVisible()) || (await page.locator('.topbar .status > span').first().textContent()) === `${pos.moves.length + 2}手目`).toBe(true);
      const actual = await readBoard();
      const replies = pos.legalMoves().filter((m) => {
        pos.apply(m);
        const matches = boardSignature() === actual;
        pos.undo();
        return matches;
      });
      expect(replies, '画面の応手を合法手から一意に復元できる').toHaveLength(1);
      const taken = pos.get(replies[0].to.x, replies[0].to.y);
      if (taken?.color === 0 && (taken.type === 'KA' || taken.type === 'UM')) playerBishopWasCaptured = true;
      pos.apply(replies[0]);
      const bubble = await page.locator('.bubble').isVisible() ? await page.locator('.bubble').innerText() : '';
      if (bubble) events.push({ type: 'bubble', ply: pos.moves.length, text: bubble });
      if (pos.moves.length % 10 === 0) console.log(`Product game: ${pos.moves.length} plies`);
    }
    await expect(page.locator('.result'), '上限までに投了を使わず終局する').toBeVisible();
    const result = await page.locator('.result').innerText();
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('ojiji.progress.v2')!));
    const endedByMate = pos.isGameOver() && pos.inCheck(pos.turn);
    expect(endedByMate, '実盤の合法手と王手から詰みを確認').toBe(true);
    expect(Object.values(progress.styles).reduce((n: number, s: any) => n + s.games, 0)).toBe(1);
    if (!playerBishopCapturedBishop && !playerBishopWasCaptured) {
      expect(progress.styles.yagura.tasksDone).not.toContain('yagura:bishop-exchange');
    }
    await page.screenshot({ path: join(out, 'result.png') });
    const decisive = page.locator('.result .moment').filter({ hasText: '決め手' });
    if (await decisive.count()) {
      await decisive.click();
      await expect(page.locator('.moment-view')).toBeVisible();
      await page.screenshot({ path: join(out, 'decisive.png') });
    }
    const report = { plies: pos.moves.length, moves: pos.moves.map(moveToUsi), endedByMate, winner: pos.turn === 0 ? 'ojiji' : 'player', decisive: await decisive.count(), playerBishopCapturedBishop, playerBishopWasCaptured, result, progress, events };
    writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ plies: report.plies, winner: report.winner, decisive: report.decisive, endedByMate }));
  } catch (error) {
    await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
    writeFileSync(join(out, 'failure.json'), JSON.stringify({ error: String(error), moves: pos.moves.map(moveToUsi), events }, null, 2) + '\n');
    throw error;
  } finally {
    engine.terminate();
  }
}
