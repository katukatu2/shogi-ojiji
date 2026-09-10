import { it, expect } from 'vitest';
import { Judge } from './judge';
import { Position } from '../engine/position';
import { usiToMove, moveToUsi } from '../engine/notation';
import type { Analysis, Evaluator } from '../ai/engine';
import { moveToKanji } from '../engine/notation';

async function replyVerdict(pos: Position, played: string, best: string, reply: string) {
  const analyze = async (moves: string[]): Promise<Analysis> => ({
    cp: moves.at(-1) === played ? -1400 : 0, bestmove: moves.at(-1) === played ? reply : best,
    mate: null, pv: moves.at(-1) === played ? [reply] : [best], depth: 16,
  });
  return (await new Judge({ analyze, analyzeMulti: async (moves) => [await analyze(moves)] }, { bad: [], good: [] })
    .judge(pos, usiToMove(pos, played))).verdict;
}

it('守り駒が釘付けで取り返せない角を、交換とは説明しない', async () => {
  const pos = Position.initial(); pos.board.fill(null);
  pos.set(4, 8, { type: 'OU', color: 0 });
  pos.set(4, 7, { type: 'GI', color: 0 }); // ５八銀は５筋の飛車で釘付け
  pos.set(5, 6, { type: 'KA', color: 0 });
  pos.set(0, 6, { type: 'FU', color: 0 });
  pos.set(0, 0, { type: 'OU', color: 1 });
  pos.set(4, 0, { type: 'HI', color: 1 });
  pos.set(6, 5, { type: 'KA', color: 1 });
  const after = pos.clone(); after.apply(usiToMove(after, '9g9f')); after.apply(usiToMove(after, '3f4g'));
  expect(after.legalMoves().map(moveToUsi)).not.toContain('5h4g');
  const verdict = await replyVerdict(pos, '9g9f', '4g3f', '3f4g');
  expect(verdict?.why).toContain('角を取られる');
  expect(verdict?.why).not.toContain('取り返せば');
});

it.each([false, true])('相手の打ち駒は盤上の同種駒との区別が必要なときだけ打を付ける: %s', async (ambiguous) => {
  const pos = Position.initial(); pos.board.fill(null);
  pos.set(4, 8, { type: 'OU', color: 0 });
  pos.set(0, 6, { type: 'FU', color: 0 });
  pos.set(0, 0, { type: 'OU', color: 1 });
  pos.hands[1].KI = 1;
  if (ambiguous) pos.set(4, 6, { type: 'KI', color: 1 });
  const after = pos.clone(); after.apply(usiToMove(after, '9g9f'));
  const reply = usiToMove(after, 'G*4h');
  expect(after.legalMoves().map(moveToUsi)).toContain('G*4h');
  const notation = moveToKanji(reply, 1, after.moves.at(-1)!, after);
  expect(notation).toBe(ambiguous ? '△４八金打' : '△４八金');
  const verdict = await replyVerdict(pos, '9g9f', '5i6i', 'G*4h');
  expect(verdict?.why).toContain(`指した▲９六歩には、${notation}で王手されて苦しい。`);
  if (!ambiguous) expect(verdict?.why).not.toContain('△４八金打');
});

it('と金の取りを「とと」とせず、指した手への応手と明記する', async () => {
  const pos = Position.initial(); pos.board.fill(null);
  pos.set(4, 8, { type: 'OU', color: 0 });
  pos.set(0, 6, { type: 'FU', color: 0 });
  pos.set(5, 6, { type: 'GI', color: 0 });
  pos.set(0, 0, { type: 'OU', color: 1 });
  pos.set(5, 5, { type: 'TO', color: 1 });
  const verdict = await replyVerdict(pos, '9g9f', '4g3f', '4f4g');
  expect(verdict?.why).toContain('指した▲９六歩には、△４七と金で銀を取られる。');
  expect(verdict?.why).not.toContain('とと');
});

// Claudeが採取した実際の棋譜。評価値は説明文の分岐を固定し、取り返しの可否は実盤から検証する。
const cases = [
  {
    name: '銀と飛車に守られた８八角',
    before: '7g7f 8c8d 2g2f 8d8e 2f2e 3c3d 3i3h 9c9d 3h2g 8e8f',
    played: '2g3f', best: '8g8f', reply: '2b8h+', cp: -121, after: -1306,
    expected: '取り返せば角の交換になる', misleading: '角を取られる',
  },
  {
    name: '馬で銀を取っても同玉と取り返せる２八銀',
    before: '7g7f 8c8d 6g6f 3c3d 2h6h 4c4d 5i4h 3a4b 4h3h 4a3b 1g1f 1c1d 3h2h 5a4a 4i5h 4b3c 7i7h 5c5d 9g9f 9c9d 7h6g 2b3a 3g3f 8d8e 8i7g 7a6b 6i7h 3a6d 2h3h 6d1i+ 6g5f L*5a 3i2h 8e8f',
    played: '5h4h', best: '8g8f', reply: '1i2h', cp: -670, after: -2430,
    expected: '取り返せるので一方的な駒損ではない', misleading: '銀を取られる',
  },
];

it.each(cases)('$name を一方的な損や無関係な正解による救出として説明しない', async (sample) => {
  const pos = Position.initial();
  for (const usi of sample.before.split(' ')) pos.apply(usiToMove(pos, usi));
  const snapshot = pos.clone();
  const after = pos.clone();
  after.apply(usiToMove(after, sample.played));
  const reply = usiToMove(after, sample.reply);
  expect(after.legalMoves().map(moveToUsi)).toContain(sample.reply);
  after.apply(reply);
  expect(after.legalMoves().some((m) => m.to.x === reply.to.x && m.to.y === reply.to.y)).toBe(true);
  const analyze = async (moves: string[]): Promise<Analysis> => {
    const isPlayed = moves.join(' ') === sample.before + ' ' + sample.played;
    return { cp: isPlayed ? sample.after : sample.cp, bestmove: isPlayed ? sample.reply : sample.best,
      mate: null, pv: isPlayed ? [sample.reply] : [sample.best], depth: 16 };
  };
  const evaluator: Evaluator = { analyze, analyzeMulti: async (moves) => [await analyze(moves)] };
  const verdict = (await new Judge(evaluator, { bad: [], good: [] }).judge(pos, usiToMove(pos, sample.played))).verdict;
  expect(verdict).not.toBeNull();
  expect(verdict!.why).toContain(sample.expected);
  expect(verdict!.why).not.toContain(sample.misleading);
  expect(verdict!.why).not.toContain('タダでは取られん');
  expect(pos.board).toEqual(snapshot.board);
  expect(pos.moves).toEqual(snapshot.moves);
});
