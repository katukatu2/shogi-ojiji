import { expect, it } from 'vitest';
import { Position } from '../engine/position';
import { moveToUsi } from '../engine/notation';
import { planComment } from './plan';
import { SHIKENBISHA } from './shikenbisha';
import { NAKABISHA } from './nakabisha';
import { YAGURA } from './yagura';
import { PieceType } from '../engine/types';

const beforeSilver = '7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i3h 8b4b 3h2g 5a6b 2g2f';

it.each([SHIKENBISHA, NAKABISHA])('$name: 実棋譜で銀が先に７二へ上がっても、美濃完成とは言わない', (style) => {
  const pos = Position.initial();
  for (const usi of beforeSilver.split(' ')) {
    const m = pos.legalMoves().find((m) => moveToUsi(m) === usi);
    expect(m, usi).toBeDefined();
    pos.apply(m!);
  }
  const silver = pos.legalMoves().find((m) => moveToUsi(m) === '7a7b')!;
  pos.apply(silver);
  expect(pos.findKing(1)).toEqual({ x: 3, y: 1 }); // 玉は６二に残る
  expect(planComment(style, pos, silver)).not.toContain('完成');
});

function castle(pieces: [number, number, PieceType][]): Position {
  const pos = Position.initial();
  pos.board.fill(null);
  pos.set(4, 8, { type: 'OU', color: 0 });
  for (const [file, rank, type] of pieces) pos.set(9 - file, rank - 1, { type, color: 1 });
  pos.turn = 1;
  return pos;
}

it.each([SHIKENBISHA, NAKABISHA])('$name: 玉と金銀が揃ってから銀を上がれば、完成を伝える', (style) => {
  const pos = castle([[8, 2, 'OU'], [7, 1, 'GI'], [6, 1, 'KI'], [5, 2, 'KI']]);
  const silver = pos.legalMoves().find((m) => moveToUsi(m) === '7a7b')!;
  expect(silver).toBeDefined();
  pos.apply(silver);
  expect(planComment(style, pos, silver)).toContain('完成');
  // 玉だけでなく金も必要。他方の色の銀や、王手中の形を完成とは呼ばない。
  pos.set(4, 1, null);
  expect(planComment(style, pos, silver)).not.toContain('完成');
  pos.set(4, 1, { type: 'KI', color: 1 });
  pos.set(2, 1, { type: 'GI', color: 0 });
  expect(planComment(style, pos, silver)).not.toContain('完成');
  pos.set(2, 1, { type: 'GI', color: 1 });
  pos.set(1, 7, { type: 'HI', color: 0 });
  expect(pos.inCheck(1)).toBe(true);
  expect(planComment(style, pos, silver)).not.toContain('完成');
});

it.each([true, false])('矢倉も玉を２二に移すだけで完成と断定しない（金銀が揃う: %s）', (guards) => {
  const pos = castle([[3, 1, 'OU'], [3, 2, 'KI'], [4, 3, 'KI'], ...(guards ? [[3, 3, 'GI'] as [number, number, PieceType]] : [])]);
  const king = pos.legalMoves().find((m) => moveToUsi(m) === '3a2b')!;
  expect(king).toBeDefined();
  pos.apply(king);
  expect(planComment(YAGURA, pos, king)!.includes('完成')).toBe(guards);
});
