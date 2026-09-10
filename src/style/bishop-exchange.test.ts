import { expect, it } from 'vitest';
import { Position } from '../engine/position';
import { moveToUsi } from '../engine/notation';
import { bishopExchange } from './patterns';
import { Judge } from './judge';
import { Evaluator } from '../ai/engine';

// パターンの記録を検査するため、評価損による別の叱責は発生させない。
const flat: Evaluator = {
  analyze: async () => ({ cp: 0, mate: null, bestmove: null, pv: [], depth: 16 }),
  analyzeMulti: async () => [{ cp: 0, mate: null, bestmove: null, pv: [], depth: 16 }],
};

function replay(usi: string): Position {
  const pos = Position.initial();
  for (const text of usi.split(' ')) {
    const m = pos.legalMoves().find((m) => moveToUsi(m) === text);
    expect(m, text).toBeDefined();
    pos.apply(m!);
  }
  return pos;
}

it('製品の実棋譜: 桂で角を取るだけでは、角交換の課題IDを記録しない', async () => {
  const before = replay('2g2f 8c8d 6i7h 8d8e 2f2e 3c3d 2e2d 8e8f 2d2c+ 1c1d 8g8f 2b4d P*2b 8b8f P*8g 8f8c 2b2a+ 3a4b N*5f 5a6b');
  const move = before.legalMoves().find((m) => moveToUsi(m) === '5f4d')!;
  expect(before.get(1, 7)?.type).toBe('KA'); // 自分の角は８八に残る
  expect(move.piece).toBe('KE');
  const judge = new Judge(flat, { bad: [], good: [bishopExchange('bishop-exchange', '角交換')] });
  await judge.judge(before, move);
  expect(judge.firedIds().has('bishop-exchange')).toBe(false);
});

it.each([
  ['先手から角を交換する', '7g7f 3c3d', '8h2b+'],
  ['後手からの角交換を銀で取り返す', '7g7f 3c3d 2g2f 2b8h+', '7i8h'],
])('%sときは課題IDを記録する', async (_name, history, usi) => {
  const pos = replay(history);
  const move = pos.legalMoves().find((m) => moveToUsi(m) === usi)!;
  const judge = new Judge(flat, { bad: [], good: [bishopExchange('bishop-exchange', '角交換')] });
  await judge.judge(pos, move);
  expect(judge.firedIds().has('bishop-exchange')).toBe(true);
});
