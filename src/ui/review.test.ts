import { expect, it } from 'vitest';
import { reviewEvaluation } from './review';

it.each([
  [50, 75, '互角 → 互角'],
  [253, 252, '先手よし → 先手よし'],
  [60, -701, '互角 → 後手優勢'],
  [3001, -3001, '先手勝勢 → 後手勝勢'],
  [null, null, '判定なし → 判定なし'],
] as const)('振り返りの評価%s→%sは共通の形勢表現で示す', (before, after, expected) => {
  expect(reviewEvaluation(before, after)).toBe(`形勢の目安（先手視点）: ${expected}`);
});
