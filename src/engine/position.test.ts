import { describe, it, expect } from 'vitest';
import { Position } from './position';
import { moveToUsi, usiToMove, moveToKanji } from './notation';
import { moveEq } from './types';

function play(pos: Position, ...usis: string[]): void {
  for (const u of usis) pos.apply(usiToMove(pos, u));
}

// 合法手であることを確かめてから指す（千日手の手順が本当に指せる手であることの保証）
function playLegal(pos: Position, ...usis: string[]): void {
  for (const u of usis) {
    const m = usiToMove(pos, u);
    expect(pos.legalMoves().some((l) => moveEq(l, m)), `${u} は合法手`).toBe(true);
    pos.apply(m);
  }
}

// 初期局面から飛車と玉を往復させる 4 手（指す前の局面に戻る）
const SHUTTLE = ['2h3h', '5a5b', '3h2h', '5b5a'];

// 先手の飛車が後手玉に王手を続けられる局面。玉は １一 と ２一 を往復し、飛車は １九 と ２九 から王手する
function perpetualBySente(): Position {
  const pos = Position.initial();
  pos.board.fill(null);
  pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
  pos.set(7, 8, { type: 'HI', color: 0 }); // ２九飛
  pos.set(8, 0, { type: 'OU', color: 1 }); // １一玉
  return pos;
}
const SENTE_CHECKS = ['2i1i', '1a2a', '1i2i', '2a1a'];
// 同じ局面で、先手の 1 手目だけ王手にならない往復（▲３九飛）
const SENTE_MIXED = ['2i3i', '1a2a', '3i2i', '2a1a'];

// 後手番から始まり、後手の飛車が先手玉（９九・８九を往復）に王手を続けられる局面
function perpetualByGote(): Position {
  const pos = Position.initial();
  pos.board.fill(null);
  pos.set(0, 8, { type: 'OU', color: 0 }); // ９九玉
  pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
  pos.set(1, 0, { type: 'HI', color: 1 }); // ８一飛
  pos.turn = 1;
  return pos;
}
const GOTE_CHECKS = ['8a9a', '9i8i', '9a8a', '8i9i'];

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

describe('SFEN', () => {
  it('初期局面と、駒を取った後の持ち駒・手番を書き出せる', () => {
    const pos = Position.initial();
    expect(pos.toSfen()).toBe('lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1');
    play(pos, '7g7f');
    expect(pos.toSfen()).toBe('lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2');
    play(pos, '3c3d', '8h2b+');
    expect(pos.toSfen()).toBe('lnsgkgsnl/1r5+B1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/7R1/LNSGKGSNL w B 4');
    // 手番を入れ替えた局面も書ける
    const flipped = pos.clone();
    flipped.turn = 0;
    expect(flipped.toSfen().split(' ')[1]).toBe('b');
  });
});

describe('千日手', () => {
  it('同一局面が 4 回現れたら千日手（3 回目までは成立しない）', () => {
    const pos = Position.initial();
    expect(pos.repetition()).toBe('none');
    playLegal(pos, ...SHUTTLE, ...SHUTTLE);
    expect(pos.repetition()).toBe('none'); // 3 回目
    playLegal(pos, ...SHUTTLE.slice(0, 3));
    expect(pos.repetition()).toBe('none'); // 盤は同じでも手番が違う
    playLegal(pos, SHUTTLE[3]);
    expect(pos.repetition()).toBe('draw'); // 4 回目
  });

  it('連続王手の千日手は、王手を続けた先手の負け', () => {
    const pos = perpetualBySente();
    playLegal(pos, ...SENTE_CHECKS, ...SENTE_CHECKS);
    expect(pos.repetition()).toBe('none');
    playLegal(pos, ...SENTE_CHECKS);
    expect(pos.inCheck(1)).toBe(false);
    expect(pos.repetition()).toBe('sente-loses');
  });

  it('連続王手の千日手は、王手を続けた後手の負け（後手番から始まる局面）', () => {
    const pos = perpetualByGote();
    playLegal(pos, ...GOTE_CHECKS, ...GOTE_CHECKS, ...GOTE_CHECKS);
    expect(pos.repetition()).toBe('gote-loses');
  });

  it('王手でない手が混じれば普通の千日手', () => {
    const pos = perpetualBySente();
    playLegal(pos, ...SENTE_MIXED, ...SENTE_MIXED, ...SENTE_MIXED);
    expect(pos.repetition()).toBe('draw');
  });

  it('undo で履歴が戻る', () => {
    const pos = Position.initial();
    playLegal(pos, ...SHUTTLE, ...SHUTTLE, ...SHUTTLE);
    expect(pos.repetition()).toBe('draw');
    pos.undo();
    expect(pos.repetition()).toBe('none');
    pos.undo();
    pos.undo();
    pos.undo();
    expect(pos.moves.length).toBe(8);
    playLegal(pos, '7g7f');
    expect(pos.repetition()).toBe('none');
    // 指し直せば同じように成立する
    pos.undo();
    playLegal(pos, ...SHUTTLE);
    expect(pos.repetition()).toBe('draw');
  });

  it('undo のあと別の手順を指すと、王手の記録も新しい手順のものになる', () => {
    const pos = perpetualBySente();
    const start = pos.key();
    playLegal(pos, ...SENTE_CHECKS, ...SENTE_CHECKS, ...SENTE_CHECKS);
    expect(pos.repetition()).toBe('sente-loses');
    for (let i = 0; i < 12; i++) pos.undo();
    expect(pos.key()).toBe(start);
    expect(pos.repetition()).toBe('none');
    playLegal(pos, ...SENTE_MIXED, ...SENTE_MIXED, ...SENTE_MIXED);
    expect(pos.repetition()).toBe('draw');
  });

  it('clone に履歴が引き継がれる（repetition() を一度も呼んでいなくても）', () => {
    const pos = Position.initial();
    playLegal(pos, ...SHUTTLE, ...SHUTTLE);
    const copy = pos.clone();
    playLegal(copy, ...SHUTTLE);
    expect(copy.repetition()).toBe('draw');
    // 元の局面は影響を受けない
    expect(pos.moves.length).toBe(8);
    expect(pos.repetition()).toBe('none');
    playLegal(pos, ...SHUTTLE);
    expect(pos.repetition()).toBe('draw');
  });

  it('clone の clone にも王手の記録が引き継がれる', () => {
    const pos = perpetualBySente();
    playLegal(pos, ...SENTE_CHECKS, ...SENTE_CHECKS);
    expect(pos.repetition()).toBe('none');
    const copy = pos.clone();
    playLegal(copy, ...SENTE_CHECKS.slice(0, 2));
    const copy2 = copy.clone();
    playLegal(copy2, ...SENTE_CHECKS.slice(2));
    expect(copy2.repetition()).toBe('sente-loses');
    expect(copy.repetition()).toBe('none');
  });

  it('repetition() は局面と手順を変えない', () => {
    const pos = Position.initial();
    const start = pos.key();
    playLegal(pos, ...SHUTTLE, '7g7f', '3c3d');
    const key = pos.key();
    const sfen = pos.toSfen();
    const legal = pos.legalMoves().length;
    expect(pos.repetition()).toBe('none');
    expect(pos.key()).toBe(key);
    expect(pos.toSfen()).toBe(sfen);
    expect(pos.legalMoves().length).toBe(legal);
    expect(pos.moves.length).toBe(6);
    for (let i = 0; i < 6; i++) pos.undo();
    expect(pos.key()).toBe(start);
    expect(pos.legalMoves().length).toBe(30);
  });
});

describe('持将棋', () => {
  // 宣言法の条件（両玉が敵陣・手番側は王手されていない・玉以外の駒が敵陣に 10 枚以上）を
  // 両方が満たし、先手・後手ともちょうど 24 点の局面。先手番
  function enteredBoth(): Position {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(8, 2, { type: 'OU', color: 0 }); // １三玉（敵陣）
    pos.set(0, 6, { type: 'OU', color: 1 }); // ９七玉（敵陣）
    // 先手: 敵陣（一・二段）に金 4・銀 4・飛・角の 10 枚（18 点）＋持ち駒の桂 4・香 2（6 点）= 24 点
    for (const x of [0, 1, 2, 3]) pos.set(x, 0, { type: 'KI', color: 0 });
    for (const x of [4, 5, 6, 7]) pos.set(x, 0, { type: 'GI', color: 0 });
    pos.set(6, 1, { type: 'HI', color: 0 });
    pos.set(7, 1, { type: 'KA', color: 0 });
    pos.hands[0] = { FU: 0, KY: 2, KE: 4, GI: 0, KI: 0, KA: 0, HI: 0 };
    // 後手: 敵陣（七・八・九段）に龍・馬・と金 4・歩 4 の 10 枚（18 点）＋持ち駒の歩 6（6 点）= 24 点
    pos.set(1, 8, { type: 'RY', color: 1 });
    pos.set(2, 8, { type: 'UM', color: 1 });
    for (const x of [3, 4, 5, 6]) pos.set(x, 8, { type: 'TO', color: 1 });
    for (const x of [1, 2, 3, 4]) pos.set(x, 7, { type: 'FU', color: 1 });
    pos.hands[1] = { FU: 6, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
    return pos;
  }

  it('宣言の条件がそろい、両方 24 点以上なら引き分け', () => {
    const pos = enteredBoth();
    expect(pos.inCheck(0)).toBe(false);
    expect(pos.inCheck(1)).toBe(false);
    expect(pos.enteringKing()).toBe('draw');
    pos.hands[0].FU = 3;
    expect(pos.enteringKing()).toBe('draw');
  });

  it('片方が 24 点未満ならその側の負け（玉は数えない）', () => {
    const pos = enteredBoth();
    pos.hands[1].FU = 5; // 後手 23 点
    expect(pos.enteringKing()).toBe('gote-loses');
    pos.hands[1].FU = 6;
    pos.hands[0].KY = 1; // 先手 23 点
    expect(pos.enteringKing()).toBe('sente-loses');
  });

  it('手番側が王手されていたら判定しない（王手されている側は宣言できない）', () => {
    const pos = enteredBoth();
    pos.set(8, 0, { type: 'KY', color: 1 }); // １一香が１三の先手玉に王手
    expect(pos.inCheck(0)).toBe(true);
    expect(pos.enteringKing()).toBe('none');
    // 手番が後手に移れば、後手は王手されていないので判定する
    pos.turn = 1;
    expect(pos.inCheck(1)).toBe(false);
    expect(pos.enteringKing()).toBe('draw');
  });

  it('敵陣の駒が 9 枚なら判定しない（点数が足りなくても言わない）', () => {
    const pos = enteredBoth();
    pos.set(7, 0, null);
    pos.set(7, 3, { type: 'GI', color: 0 }); // 銀を２四へ動かす（点数は 24 点のまま、敵陣は 9 枚）
    expect(pos.enteringKing()).toBe('none');
    pos.hands[1].FU = 0; // 後手が 18 点でも言わない
    expect(pos.enteringKing()).toBe('none');
    // 銀を敵陣へ戻せば 10 枚に戻る
    pos.set(7, 3, null);
    pos.set(7, 0, { type: 'GI', color: 0 });
    expect(pos.enteringKing()).toBe('gote-loses');
  });

  it('後手の敵陣の駒が 9 枚でも判定しない', () => {
    const pos = enteredBoth();
    pos.set(4, 7, null);
    pos.set(4, 5, { type: 'FU', color: 1 }); // ５六へ（敵陣の外）
    expect(pos.enteringKing()).toBe('none');
  });

  it('片方の玉しか敵陣に入っていなければ判定しない', () => {
    const pos = enteredBoth();
    pos.set(8, 2, null);
    pos.set(8, 3, { type: 'OU', color: 0 }); // １四玉（敵陣の一つ手前）
    pos.hands[1].FU = 0; // 点数が足りなくても言わない
    expect(pos.enteringKing()).toBe('none');
    pos.set(8, 3, null);
    pos.set(8, 2, { type: 'OU', color: 0 });
    pos.set(0, 6, null);
    pos.set(0, 5, { type: 'OU', color: 1 }); // ９六玉
    expect(pos.enteringKing()).toBe('none');
    expect(Position.initial().enteringKing()).toBe('none');
  });

  it('玉が敵陣に入った瞬間には成立しない（駒が付いていっていないので対局は続く）', () => {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(8, 2, { type: 'OU', color: 0 }); // １三玉
    pos.set(0, 6, { type: 'OU', color: 1 }); // ９七玉
    pos.hands[0] = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 4, KA: 2, HI: 2 }; // 24 点
    pos.hands[1] = { FU: 9, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 3 }; // 24 点
    expect(pos.enteringKing()).toBe('none');
  });
});

describe('手数の上限', () => {
  it('MAX_PLIES は 400 で、400 手に達したら isTooLong', () => {
    expect(Position.MAX_PLIES).toBe(400);
    const pos = Position.initial();
    for (let i = 0; i < 99; i++) play(pos, ...SHUTTLE);
    play(pos, ...SHUTTLE.slice(0, 3));
    expect(pos.moves.length).toBe(399);
    expect(pos.isTooLong()).toBe(false);
    play(pos, SHUTTLE[3]);
    expect(pos.isTooLong()).toBe(true);
    pos.undo();
    expect(pos.isTooLong()).toBe(false);
  });
});
