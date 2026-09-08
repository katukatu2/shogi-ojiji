import { describe, it, expect } from 'vitest';
import { Position } from './position';
import { moveToUsi, usiToMove, moveToKanji } from './notation';

function play(pos: Position, ...usis: string[]): void {
  for (const u of usis) pos.apply(usiToMove(pos, u));
}

describe('Position', () => {
  it('初期局面の先手は30手の合法手を持つ', () => {
    const pos = Position.initial();
    expect(pos.legalMoves().length).toBe(30);
  });

  it('apply と undo で局面が元に戻る', () => {
    const pos = Position.initial();
    const key = pos.key();
    play(pos, '7g7f', '3c3d', '8h2b+');
    expect(pos.hands[0].KA).toBe(1);
    pos.undo();
    pos.undo();
    pos.undo();
    expect(pos.key()).toBe(key);
  });

  it('二歩は打てない', () => {
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d', '8h2b+', '3a2b');
    // 先手は角を持っている。歩は持っていないので確認用に持ち駒を細工
    pos.hands[0].FU = 1;
    const drops = pos.legalMoves().filter((m) => m.from === null && m.piece === 'FU');
    // 全ての筋に自分の歩がある → 打てる場所は 0
    expect(drops.length).toBe(0);
  });

  it('王手を放置する手は合法手に含まれない', () => {
    const pos = Position.initial();
    // 角交換のあと、先手が角を打って王手した局面を作る
    play(pos, '7g7f', '3c3d', '8h2b+', '3a2b', '5i5h', '5a4b');
    pos.hands[0].KA = 1;
    play(pos, 'B*3c');
    expect(pos.inCheck(1)).toBe(true);
    for (const m of pos.legalMoves()) {
      pos.apply(m);
      expect(pos.inCheck(1)).toBe(false);
      pos.undo();
    }
  });

  it('行き所のない駒への不成は生成されない', () => {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 });
    pos.set(4, 0, { type: 'OU', color: 1 });
    pos.set(0, 1, { type: 'FU', color: 0 });
    const moves = pos.legalMoves().filter((m) => m.piece === 'FU');
    expect(moves.length).toBe(1);
    expect(moves[0].promote).toBe(true);
  });

  it('詰みを検出する（頭金）', () => {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 });
    pos.set(4, 0, { type: 'OU', color: 1 });
    pos.set(4, 2, { type: 'KI', color: 0 });
    pos.hands[0].KI = 1;
    play(pos, 'G*5b');
    expect(pos.turn).toBe(1);
    expect(pos.isCheckmate()).toBe(true);
  });

  it('打ち歩詰めは禁止', () => {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 });
    pos.set(0, 0, { type: 'OU', color: 1 });
    // 9一玉に対し 9二歩打ちで詰む形（8一・8二を金で押さえる）
    pos.set(1, 0, { type: 'KI', color: 0 });
    pos.set(1, 1, { type: 'KI', color: 0 });
    pos.set(1, 2, { type: 'KI', color: 0 });
    pos.hands[0].FU = 1;
    const drop = pos.legalMoves().find((m) => moveToUsi(m) === 'P*9b');
    expect(drop).toBeUndefined();
  });
});

describe('notation', () => {
  it('USI と漢字表記の変換', () => {
    const pos = Position.initial();
    const m = usiToMove(pos, '7g7f');
    expect(moveToUsi(m)).toBe('7g7f');
    expect(moveToKanji(m, 0)).toBe('▲７六歩');
    pos.apply(m);
    const m2 = usiToMove(pos, '8c8d');
    expect(moveToKanji(m2, 1)).toBe('△８四歩');
  });
});
