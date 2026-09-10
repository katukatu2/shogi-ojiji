import { describe, it, expect } from 'vitest';
import { Position } from './position';
import { moveToKanji, usiToKanji, usiToMove, usiToSq } from './notation';
import { Color, HandPiece, Move, PieceType } from './types';

// 駒は USI の座標（'3d' = ３四）で置く
function put(pos: Position, sq: string, type: PieceType, color: Color): void {
  const { x, y } = usiToSq(sq);
  pos.set(x, y, { type, color });
}

// 玉だけの盤（先手 ５九、後手 ５一）。先手番
function bare(): Position {
  const pos = Position.initial();
  pos.board.fill(null);
  put(pos, '5i', 'OU', 0);
  put(pos, '5a', 'OU', 1);
  return pos;
}

function drop(piece: HandPiece, sq: string): Move {
  return { from: null, to: usiToSq(sq), piece, promote: false };
}

// 盤上の駒を動かす手（USI の座標で書く）
function step(piece: PieceType, from: string, to: string, promote = false): Move {
  return { from: usiToSq(from), to: usiToSq(to), piece, promote };
}

describe('moveToKanji の「打」', () => {
  it('局面を渡さなければ、打つ手には今まで通り「打」を付ける（後方互換）', () => {
    expect(moveToKanji(drop('FU', '3d'), 0)).toBe('▲３四歩打');
    expect(moveToKanji(drop('GI', '5f'), 1, null)).toBe('△５六銀打');
    expect(moveToKanji(drop('KI', '4h'), 0, null, null)).toBe('▲４八金打');
  });

  it('歩: 同じ筋に歩が無い盤へ打つ → 動ける歩が無いので「打」なし', () => {
    const pos = bare();
    pos.hands[0].FU = 1;
    expect(moveToKanji(drop('FU', '3d'), 0, null, pos)).toBe('▲３四歩');
  });

  it('歩: と金がその地点へ動けても、歩とは別の駒なので「打」なし', () => {
    const pos = bare();
    put(pos, '3e', 'TO', 0); // ３五のと金は３四へ動ける
    pos.hands[0].FU = 1;
    expect(moveToKanji(drop('FU', '3d'), 0, null, pos)).toBe('▲３四歩');
  });

  it('香: 盤上の香が動ける地点へ打てば「打」、遮られていれば付けない', () => {
    const pos = bare();
    put(pos, '3i', 'KY', 0); // ３九の香は３四まで通っている
    pos.hands[0].KY = 1;
    expect(moveToKanji(drop('KY', '3d'), 0, null, pos)).toBe('▲３四香打');
    put(pos, '3f', 'FU', 1); // ３六に後手の歩。香は３六までしか進めない
    expect(moveToKanji(drop('KY', '3d'), 0, null, pos)).toBe('▲３四香');
  });

  it('桂: 跳べる地点なら「打」、跳べない地点なら付けない', () => {
    const pos = bare();
    put(pos, '3f', 'KE', 0); // ３六の桂は４四と２四へ跳べる
    pos.hands[0].KE = 1;
    expect(moveToKanji(drop('KE', '4d'), 0, null, pos)).toBe('▲４四桂打');
    expect(moveToKanji(drop('KE', '3d'), 0, null, pos)).toBe('▲３四桂');
  });

  it('銀: 動ける地点なら「打」、動けない地点なら付けない', () => {
    const pos = bare();
    put(pos, '4e', 'GI', 0); // ４五の銀は３四へ動けるが、４三へは動けない
    pos.hands[0].GI = 1;
    expect(moveToKanji(drop('GI', '3d'), 0, null, pos)).toBe('▲３四銀打');
    expect(moveToKanji(drop('GI', '4c'), 0, null, pos)).toBe('▲４三銀');
  });

  it('金: 動ける地点なら「打」、動けない地点なら付けない', () => {
    const pos = bare();
    put(pos, '4e', 'KI', 0); // ４五の金は５五へ動けるが、３三へは動けない
    pos.hands[0].KI = 1;
    expect(moveToKanji(drop('KI', '5e'), 0, null, pos)).toBe('▲５五金打');
    expect(moveToKanji(drop('KI', '3c'), 0, null, pos)).toBe('▲３三金');
  });

  it('角: 利いている地点なら「打」、利いていない地点なら付けない', () => {
    const pos = bare();
    put(pos, '8h', 'KA', 0); // ８八の角は５五に利いているが、５六には利いていない
    pos.hands[0].KA = 1;
    expect(moveToKanji(drop('KA', '5e'), 0, null, pos)).toBe('▲５五角打');
    expect(moveToKanji(drop('KA', '5f'), 0, null, pos)).toBe('▲５六角');
  });

  it('飛: 利いている地点なら「打」、利いていない地点なら付けない', () => {
    const pos = bare();
    put(pos, '2h', 'HI', 0); // ２八の飛は２四に利いているが、３四には利いていない
    pos.hands[0].HI = 1;
    expect(moveToKanji(drop('HI', '2d'), 0, null, pos)).toBe('▲２四飛打');
    expect(moveToKanji(drop('HI', '3d'), 0, null, pos)).toBe('▲３四飛');
  });

  it('後手の打つ手も同じ（△、後手の駒の向きで判定する）', () => {
    const pos = bare();
    pos.turn = 1;
    put(pos, '6e', 'GI', 1); // ６五の後手銀は前（５六）へ動けるが、真後ろ（６四）へは動けない
    pos.hands[1].GI = 1;
    expect(moveToKanji(drop('GI', '5f'), 1, null, pos)).toBe('△５六銀打');
    expect(moveToKanji(drop('GI', '6d'), 1, null, pos)).toBe('△６四銀');
  });

  it('局面の手番が color と違っても（相手の応手を表示するときなど）その側の駒で判定し、局面を壊さない', () => {
    const pos = bare(); // 先手番のまま後手の手を表記する
    put(pos, '6e', 'GI', 1);
    pos.hands[1].GI = 1;
    const key = pos.key();
    expect(moveToKanji(drop('GI', '5f'), 1, null, pos)).toBe('△５六銀打');
    expect(moveToKanji(drop('GI', '6d'), 1, null, pos)).toBe('△６四銀');
    expect(pos.turn).toBe(0);
    expect(pos.key()).toBe(key);
  });

  it('釘付けで動けない駒は数えない（合法手で判定する）', () => {
    const pos = bare();
    put(pos, '5h', 'GI', 0); // ５八の銀は４七へ動ける
    pos.hands[0].GI = 1;
    expect(moveToKanji(drop('GI', '4g'), 0, null, pos)).toBe('▲４七銀打');
    put(pos, '5b', 'HI', 1); // ５二の飛が５八の銀を玉に釘付けにする → 銀は４七へ動けない
    expect(moveToKanji(drop('GI', '4g'), 0, null, pos)).toBe('▲４七銀');
  });

  it('局面を渡しても「同」と「成」はこれまで通り', () => {
    const pos = Position.initial();
    const m1 = usiToMove(pos, '7g7f');
    expect(moveToKanji(m1, 0, null, pos)).toBe('▲７六歩');
    pos.apply(m1);
    const m2 = usiToMove(pos, '3c3d');
    expect(moveToKanji(m2, 1, m1, pos)).toBe('△３四歩');
    pos.apply(m2);
    const m3 = usiToMove(pos, '8h2b+');
    expect(moveToKanji(m3, 0, m2, pos)).toBe('▲２二角成');
    pos.apply(m3);
    const m4 = usiToMove(pos, '3a2b');
    expect(moveToKanji(m4, 1, m3, pos)).toBe('△同銀');
  });

  it('usiToKanji は局面を持っているので「打」も慣習に従う', () => {
    const pos = bare();
    pos.hands[0].GI = 1;
    expect(usiToKanji('S*3d', pos, 0)).toBe('▲３四銀');
    put(pos, '4e', 'GI', 0); // ４五の銀が３四へ動ける
    expect(usiToKanji('S*3d', pos, 0)).toBe('▲３四銀打');
    expect(usiToKanji('5i5h', pos, 0)).toBe('▲５八玉');
  });
});

describe('moveToKanji の「不成」', () => {
  it('成れるのに成らなければ「不成」、成れば「成」（局面は要らない）', () => {
    expect(moveToKanji(step('KA', '8h', '2b'), 0)).toBe('▲２二角不成');
    expect(moveToKanji(step('KA', '8h', '2b', true), 0)).toBe('▲２二角成');
  });

  it('銀が敵陣へ入る手（▲３三銀不成／▲３三銀成）', () => {
    expect(moveToKanji(step('GI', '3d', '3c'), 0)).toBe('▲３三銀不成');
    expect(moveToKanji(step('GI', '3d', '3c', true), 0)).toBe('▲３三銀成');
  });

  it('敵陣から出る手にも付く（動かす前が敵陣なら成れる）', () => {
    expect(moveToKanji(step('KA', '2b', '8h'), 0)).toBe('▲８八角不成');
    expect(moveToKanji(step('GI', '3c', '3d'), 0)).toBe('▲３四銀不成');
  });

  it('敵陣に掛からない手には付かない', () => {
    expect(moveToKanji(step('GI', '5h', '5g'), 0)).toBe('▲５七銀');
    expect(moveToKanji(step('FU', '7g', '7f'), 0)).toBe('▲７六歩');
    expect(moveToKanji(step('GI', '3e', '3d'), 0)).toBe('▲３四銀'); // 四段目は敵陣の一つ手前
  });

  it('成れない駒（金・玉）には付かない', () => {
    expect(moveToKanji(step('KI', '3c', '3b'), 0)).toBe('▲３二金');
    expect(moveToKanji(step('OU', '3c', '3b'), 0)).toBe('▲３二玉');
  });

  it('既に成っている駒には付かない', () => {
    expect(moveToKanji(step('TO', '3c', '3b'), 0)).toBe('▲３二と金');
    expect(moveToKanji(step('NG', '3c', '3b'), 0)).toBe('▲３二成銀');
    expect(moveToKanji(step('UM', '3c', '3b'), 0)).toBe('▲３二馬');
    expect(moveToKanji(step('RY', '3c', '3b'), 0)).toBe('▲３二龍');
  });

  it('後手は七〜九段が敵陣', () => {
    expect(moveToKanji(step('GI', '7f', '7g'), 1)).toBe('△７七銀不成');
    expect(moveToKanji(step('GI', '7g', '7f'), 1)).toBe('△７六銀不成'); // 七段目から出る手
    expect(moveToKanji(step('GI', '7e', '7f'), 1)).toBe('△７六銀'); // 六段目は敵陣の一つ手前
    expect(moveToKanji(step('GI', '3d', '3c'), 1)).toBe('△３三銀'); // 先手の敵陣では成れない
  });

  it('打つ手には付かない（打った駒は成れない）', () => {
    const pos = bare();
    pos.hands[0].GI = 1;
    expect(moveToKanji(drop('GI', '3c'), 0)).toBe('▲３三銀打');
    expect(moveToKanji(drop('GI', '3c'), 0, null, pos)).toBe('▲３三銀');
  });

  it('「同」と一緒でも付く', () => {
    const prev = step('GI', '2c', '3c');
    expect(moveToKanji(step('KA', '8h', '3c'), 0, prev)).toBe('▲同角不成');
  });
});
