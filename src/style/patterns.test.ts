// 形だけの NG（minDrop 無し）が、戦いが始まった局面で誤爆しないことの確認。
// 中盤の戦術局面で「▲６八玉から囲え」と言うと、指せない手を勧めてしまう。

import { describe, it, expect } from 'vitest';
import { Position } from '../engine/position';
import { usiToMove, moveToUsi } from '../engine/notation';
import { BAD_PATTERNS, COMMON_BAD, PatternContext, BadPattern, isFighting, guarded, canMove } from './patterns';

function play(pos: Position, usis: string): void {
  for (const u of usis.split(' ')) pos.apply(usiToMove(pos, u));
}

// 局面と指し手から PatternContext を作る（pos は指した後まで進む）
function context(pos: Position, usi: string): PatternContext {
  const before = pos.clone();
  const move = usiToMove(pos, usi);
  pos.apply(move);
  return { before, move, after: pos };
}

const find = (id: string): BadPattern => BAD_PATTERNS.find((p) => p.id === id)!;

// 玉飛接近の誤爆の再現（2026-09-10 の指摘）。先手玉５八、後手のと金が７八、６八は後手の利き。
// ▲４八玉はと金から逃げる数少ない手で、勧められた▲６八玉は非合法
const FIGHT_LINE = [
  '7g7f 8c8d 2g2f 3c3d 2f2e 8d8e 3i3h 8e8f 3h2g 2b8h+ 2g2f 8h8i 5i6h N*7g',
  '6i5i 8i9i 6h5h 7g8i+ 5i6i 9i5e 7i7h B*9h 2f3e 8f8g+ 4g4f 8g7h',
].join(' ');

function fightPosition(): Position {
  const pos = Position.initial();
  play(pos, FIGHT_LINE);
  return pos;
}

describe('玉飛接近の誤爆（中盤の戦術局面）', () => {
  it('相手が自陣に成り込んだ局面の▲４八玉では発火しない', () => {
    const pos = fightPosition();
    // 勧めていた▲６八玉（5h6h）はそもそも指せない
    expect(pos.legalMoves().map(moveToUsi)).not.toContain('5h6h');
    expect(pos.legalMoves().map(moveToUsi)).toContain('5h4h');
    expect(find('king-near-rook').check(context(pos, '5h4h'))).toBeNull();
  });

  it('その局面はどの共通 NG も黙る', () => {
    const pos = fightPosition();
    const ctx = context(pos, '5h4h');
    for (const p of COMMON_BAD) expect(p.check(ctx)).toBeNull();
  });

  it('序盤の▲４八玉は今まで通り叱り、▲６八玉を勧める', () => {
    const pos = Position.initial();
    play(pos, '7g7f 8c8d');
    const why = find('king-near-rook').check(context(pos, '5i4h'));
    expect(why).toContain('飛車');
    expect(why).toContain('▲６八玉');
  });
});

describe('勧める手の合法性', () => {
  it('▲６八玉が自分の金で塞がっていれば、玉飛接近で具体手を出さない', () => {
    const pos = Position.initial();
    play(pos, '7g7f 8c8d 6i6h 3c3d');
    expect(pos.get(3, 7)?.type).toBe('KI'); // ６八に自分の金
    const why = find('king-near-rook').check(context(pos, '5i4h'));
    expect(why).toContain('飛車');
    expect(why).not.toContain('▲６八玉');
    expect(why).toContain('玉は左へ囲うのが筋じゃ');
  });

  it('▲６八玉が指せなければ、囲わず攻める咎めでも具体手を出さない', () => {
    const pos = Position.initial();
    play(pos, '2g2f 8c8d 2f2e 3c3d 3i3h 4c4d 3h2g 7a6b 2g3f 3a4b 7g7f 4a3b 6i6h 8d8e');
    const why = find('attack-without-castle').check(context(pos, '8h5e'));
    expect(why).toContain('裸');
    expect(why).not.toContain('▲６八玉');
    expect(why).toContain('まず玉を左へ囲え。');
  });

  it('canMove は指せる手だけ真を返す', () => {
    const pos = Position.initial();
    play(pos, '7g7f 8c8d');
    expect(canMove(pos, { x: 4, y: 8 }, { x: 3, y: 7 })).toBe(true); // ▲６八玉
    expect(canMove(pos, { x: 4, y: 8 }, { x: 4, y: 6 })).toBe(false); // ５七へは跳べない
    expect(canMove(fightPosition(), { x: 4, y: 7 }, { x: 3, y: 7 })).toBe(false); // ６八は後手の利き
  });
});

describe('isFighting の 4 条件', () => {
  // 先手玉５八・先手飛２八だけの簡単な盤に、相手の駒を置いて試す
  function bare(): Position {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 7, { type: 'OU', color: 0 }); // ５八玉
    pos.set(7, 7, { type: 'HI', color: 0 }); // ２八飛
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    return pos;
  }
  const ctxOf = (pos: Position, usi: string) => context(pos.clone(), usi);

  it('相手の駒が自陣（七〜九段）に成り込んでいれば真', () => {
    const pos = bare();
    pos.set(0, 6, { type: 'TO', color: 1 }); // ９七と（玉から遠い）
    expect(isFighting(ctxOf(pos, '5h4h'))).toBe(true);
  });

  it('自陣に届いていない成り駒だけなら偽', () => {
    const pos = bare();
    pos.set(0, 5, { type: 'TO', color: 1 }); // ９六と（六段目）
    expect(isFighting(ctxOf(pos, '5h4h'))).toBe(false);
  });

  it('自玉が王手されていれば真', () => {
    const pos = bare();
    pos.set(4, 3, { type: 'HI', color: 1 }); // ５四飛の王手
    expect(isFighting(ctxOf(pos, '5h4h'))).toBe(true);
  });

  it('指した手が相手の駒を取る手なら真', () => {
    const pos = bare();
    pos.set(5, 7, { type: 'GI', color: 1 }); // ４八銀（取れる）
    expect(isFighting(ctxOf(pos, '5h4h'))).toBe(true);
  });

  it('自玉の周囲 2 マスに相手の駒があれば真、3 マス離れていれば偽', () => {
    const near = bare();
    near.set(2, 5, { type: 'GI', color: 1 }); // ７六銀（筋の差 2・段の差 2）
    expect(isFighting(ctxOf(near, '5h4h'))).toBe(true);
    const far = bare();
    far.set(1, 5, { type: 'GI', color: 1 }); // ８六銀（筋の差 3）
    expect(isFighting(ctxOf(far, '5h4h'))).toBe(false);
  });
});

describe('guarded の共通化', () => {
  it('guarded は id・headline・minDrop をそのまま残す', () => {
    const src: BadPattern = { id: 'x', headline: 'y', minDrop: 150, check: () => 'z' };
    const g = guarded(src);
    expect(g.id).toBe('x');
    expect(g.headline).toBe('y');
    expect(g.minDrop).toBe(150);
    expect(find('pawn-in-front-of-king').minDrop).toBe(150);
    expect(find('king-near-rook').minDrop).toBeUndefined();
  });

  it('囲わずに攻める咎めも guard で止まる', () => {
    const pos = Position.initial();
    play(pos, '2g2f 8c8d 2f2e 3c3d 3i3h 4c4d 3h2g 7a6b 2g3f 3a4b 7g7f 4a3b');
    // guard が無ければ叱る形
    expect(find('attack-without-castle').check(context(pos.clone(), '8h5e'))).toContain('裸');
    // 後手が６七に成り込んでいれば黙る（角の道 ８八→５五 は塞がない位置）
    const fighting = pos.clone();
    fighting.set(3, 6, { type: 'TO', color: 1 }); // ６七と
    expect(find('attack-without-castle').check(context(fighting, '8h5e'))).toBeNull();
  });

  it('玉頭の歩も guard で止まる（玉の隣まで相手の駒が来ている）', () => {
    // ８八玉・８七歩・７八金。後手の銀の位置だけ変える
    function castled(sx: number, sy: number): Position {
      const pos = Position.initial();
      pos.board.fill(null);
      pos.set(1, 7, { type: 'OU', color: 0 }); // ８八玉
      pos.set(1, 6, { type: 'FU', color: 0 }); // ８七歩
      pos.set(2, 7, { type: 'KI', color: 0 }); // ７八金
      pos.set(7, 1, { type: 'OU', color: 1 }); // ２二玉
      pos.set(sx, sy, { type: 'GI', color: 1 });
      return pos;
    }
    // ７五銀（玉から 3 段離れている）なら今まで通り形が当てはまる
    expect(find('pawn-in-front-of-king').check(context(castled(2, 4), '8g8f'))).toContain('玉頭');
    // ７六銀（玉の周囲 2 マス）まで来ていれば、形の説教はしない
    expect(find('pawn-in-front-of-king').check(context(castled(2, 5), '8g8f'))).toBeNull();
  });
});
