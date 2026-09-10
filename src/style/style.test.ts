import { describe, it, expect } from 'vitest';
import { Position } from '../engine/position';
import { usiToMove, moveToUsi } from '../engine/notation';
import { Analysis, Evaluator } from '../ai/engine';
import { YAGURA } from './yagura';
import { STYLES } from './index';
import { choosePlanMove, planCandidates } from './plan';
import { Judge, severity, moveNature, bestCaptureGain } from './judge';
import { BAD_PATTERNS, GOOD_PATTERNS } from './patterns';

function play(pos: Position, ...usis: string[]): void {
  for (const u of usis) pos.apply(usiToMove(pos, u));
}

// 常に互角と答える偽エンジン（駒組みは全部「損なし」になる）
const flat: Evaluator = {
  analyze: async () => ({ cp: 0, mate: null, bestmove: null, pv: [], depth: 1 }),
  analyzeMulti: async () => [{ cp: 0, mate: null, bestmove: null, pv: [], depth: 1 }],
};

// 手順ごとに決まった評価を返す偽エンジン。SFEN で読まれたら 'sfen:' + SFEN をキーにする。
// 値を配列にすると MultiPV（最善・次善）として返す。
// 明示しない探索の深さは16。深さで表示の確かさを区分せず、記録として保持する。
function fakeEvaluator(table: Record<string, Partial<Analysis> | Partial<Analysis>[]>): Evaluator {
  const lookupAll = async (moves: string[], opts?: { sfen?: string }): Promise<Analysis[]> => {
    const key = opts?.sfen ? `sfen:${opts.sfen}` : moves.join(' ');
    const a = table[key];
    if (!a) throw new Error(`no fake analysis for "${key}"`);
    const list = Array.isArray(a) ? a : [a];
    return list.map((x) => ({ cp: 0, mate: null, bestmove: null, pv: [], depth: 16, ...x }));
  };
  return { analyze: async (m, o) => (await lookupAll(m, o))[0], analyzeMulti: lookupAll };
}

describe('オジジの矢倉の駒組み', () => {
  it.each(YAGURA.plans.map((v) => [v.name, v.moves] as const))('%s: 先手が当たり障りのない手を続ければ矢倉囲いが完成する', async (_name, moves) => {
    const pos = Position.initial();
    const state = { done: new Set<string>() };
    // 先手は当たり障りのない手を繰り返す
    const idle = ['9g9f', '1g1f', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h'];
    for (const u of idle) {
      play(pos, u);
      const m = await choosePlanMove(pos, moves, state, { evaluator: flat });
      if (!m) break;
      pos.apply(m);
    }
    const king = pos.findKing(1)!;
    expect(`${9 - king.x}${'abcdefghi'[king.y]}`).toBe('2b');
    expect(pos.get(6, 2)?.type).toBe('GI'); // ３三銀
    expect(pos.get(6, 1)?.type).toBe('KI'); // ３二金
    expect(pos.get(5, 2)?.type).toBe('KI'); // ４三金
    expect(pos.get(5, 3)?.type).toBe('FU'); // ４四歩
    // 全ての plan の手が実際に指された（使われない手が混ざっていない）
    expect(state.done.size).toBe(moves.length);
  });

  it('plan の手は今の局面で合法なものだけ候補になる', () => {
    const pos = Position.initial();
    play(pos, '7g7f');
    const cands = planCandidates(pos, YAGURA.plans[0].moves, { done: new Set() }).map(moveToUsi);
    expect(cands[0]).toBe('8c8d');
    expect(cands).not.toContain('4b3c'); // 銀がまだ４二にいない
  });

  it('エンジンが「損」と言う駒組みの手は避ける', async () => {
    const pos = Position.initial();
    play(pos, '7g7f');
    // 8c8d は 300 点損、3c3d は問題なし、という偽の評価
    const ev = fakeEvaluator({
      '7g7f': { cp: 0 },
      '7g7f 8c8d': { cp: 300 },
      '7g7f 3c3d': { cp: 10 },
    });
    const m = await choosePlanMove(pos, YAGURA.plans[0].moves, { done: new Set() }, { evaluator: ev });
    expect(m && moveToUsi(m)).toBe('3c3d');
  });
});

describe('矢倉相手の NG パターン', () => {
  const find = (id: string) => BAD_PATTERNS.find((p) => p.id === id)!;

  it('玉を囲わずに攻め駒を二枚前に出すと叱る', () => {
    const pos = Position.initial();
    play(pos, '2g2f', '8c8d', '2f2e', '3c3d', '3i3h', '4c4d', '3h2g', '7a6b', '2g3f', '3a4b', '7g7f', '4a3b');
    const before = pos.clone();
    const move = usiToMove(pos, '8h5e'); // 角も前線へ
    pos.apply(move);
    const why = find('attack-without-castle').check({ before, move, after: pos });
    expect(why).toContain('裸');
  });

  it('囲ってから攻める分には叱らない', () => {
    const pos = Position.initial();
    play(pos, '5i6h', '8c8d', '6h7h', '3c3d', '3i3h', '4c4d', '3h2g', '7a6b', '2g3f', '3a4b', '7g7f', '4a3b');
    const before = pos.clone();
    const move = usiToMove(pos, '8h5e');
    pos.apply(move);
    expect(find('attack-without-castle').check({ before, move, after: pos })).toBeNull();
  });

  it('飛車の隣に玉を寄せると叱る', () => {
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d');
    const before = pos.clone();
    const move = usiToMove(pos, '5i4h');
    pos.apply(move);
    expect(find('king-near-rook').check({ before, move, after: pos })).toContain('飛車');
    // 左へ動かすのは問題なし
    pos.undo();
    const left = usiToMove(pos, '5i6h');
    pos.apply(left);
    expect(find('king-near-rook').check({ before, move: left, after: pos })).toBeNull();
  });

  it('角交換をすると頷く', () => {
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const before = pos.clone();
    const move = usiToMove(pos, '8h2b+');
    pos.apply(move);
    const good = GOOD_PATTERNS.find((p) => p.id === 'bishop-exchange')!;
    expect(good.check({ before, move, after: pos })).toContain('角交換');
  });
});

describe('総合判定', () => {
  it('NG パターンは一局に一度だけ叱る', async () => {
    const judge = new Judge(null);
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d');
    const first = await judge.judge(pos, usiToMove(pos, '5i4h'));
    expect(first.verdict?.kind).toBe('pattern');
    const second = await judge.judge(pos, usiToMove(pos, '5i4h'));
    expect(second.verdict).toBeNull();
  });

  it('エンジンで評価値が落ちる手は叱り、落ちない良い手は頷く', async () => {
    const table = {
      '7g7f 3c3d': { cp: 20, bestmove: '2g2f' },
      '7g7f 3c3d 8h5e': { cp: -700, bestmove: '2b5e', pv: ['2b5e'] },
      '7g7f 3c3d 8h2b+': { cp: 40, bestmove: '3a2b' },
    };
    const judge = new Judge(fakeEvaluator(table));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const bad = await judge.judge(pos, usiToMove(pos, '8h5e'));
    expect(bad.verdict?.kind).toBe('eval');
    expect(bad.verdict?.why).toContain('△同角で角を取られる'); // 取られる駒の名前を入れる
    expect(bad.verdict?.evalLine).toBe(['形勢の目安', '候補 ▲２六歩 → 互角', '指した ▲５五角 → 後手優勢'].join('\n'));
    const good = await judge.judge(pos, usiToMove(pos, '8h2b+'));
    expect(good.verdict).toBeNull();
    expect(good.praise?.comment).toContain('角交換');
  });
});

describe('玉頭の歩・端攻めの判定', () => {
  // 先手玉８八、８七歩。後手の銀が近くにいる形を手で作る
  function castledPosition(goteSilverAt: { x: number; y: number }): Position {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(1, 7, { type: 'OU', color: 0 }); // ８八玉
    pos.set(1, 6, { type: 'FU', color: 0 }); // ８七歩
    pos.set(2, 7, { type: 'KI', color: 0 }); // ７八金
    pos.set(7, 1, { type: 'OU', color: 1 }); // ２二玉
    pos.set(goteSilverAt.x, goteSilverAt.y, { type: 'GI', color: 1 });
    return pos;
  }
  const find = (id: string) => BAD_PATTERNS.find((p) => p.id === id)!;

  it('銀の頭を叩く歩は「玉頭の歩」として扱わない', () => {
    const pos = castledPosition({ x: 1, y: 4 }); // ８五銀
    const before = pos.clone();
    const move = usiToMove(pos, '8g8f');
    pos.apply(move);
    expect(find('pawn-in-front-of-king').check({ before, move, after: pos })).toBeNull();
  });

  it('攻め駒が迫っているのに玉頭の歩を突くと形は当てはまる', () => {
    const pos = castledPosition({ x: 2, y: 4 }); // ７五銀
    const before = pos.clone();
    const move = usiToMove(pos, '8g8f');
    pos.apply(move);
    expect(find('pawn-in-front-of-king').check({ before, move, after: pos })).toContain('玉頭');
  });

  it('形が当てはまっても、エンジンが問題なしと言えば叱らない', async () => {
    const pos = castledPosition({ x: 2, y: 4 });
    const moves = pos.moves.map(moveToUsi).join(' ');
    const ok = new Judge(fakeEvaluator({ [moves]: { cp: 50 }, [(moves + ' 8g8f').trim()]: { cp: 30 } }));
    const j = await ok.judge(pos, usiToMove(pos, '8g8f'));
    expect(j.verdict).toBeNull();
    // 講釈は正解が受けの手のときだけなので、最善手に▲７九金（受け）を置く
    const bad = new Judge(fakeEvaluator({ [moves]: { cp: 50, bestmove: '7h7i' }, [(moves + ' 8g8f').trim()]: { cp: -200 } }));
    const j2 = await bad.judge(pos, usiToMove(pos, '8g8f'));
    expect(j2.verdict?.kind).toBe('pattern');
    expect(j2.verdict?.headline).toContain('玉頭');
  });

  it('形が当てはまっても、正解が受けと関係ない手なら講釈しない（普通の説明に落とす）', async () => {
    // 玉頭の歩の形は同じだが、エンジンの最善は▲３四飛（攻め）。「玉の前の歩は最後の盾じゃ」は的外れになる
    const pos = castledPosition({ x: 2, y: 4 });
    pos.set(6, 7, { type: 'HI', color: 0 }); // ３八飛
    const moves = pos.moves.map(moveToUsi).join(' ');
    const judge = new Judge(fakeEvaluator({
      [moves]: { cp: 50, bestmove: '3h3d' },
      [(moves + ' 3h3d').trim()]: { cp: 50 },
      [(moves + ' 8g8f').trim()]: { cp: -400 },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '8g8f'));
    expect(moveNature(pos, usiToMove(pos, '3h3d'))).toBe('attack');
    expect(j.verdict?.kind).toBe('eval');
    expect(j.verdict?.headline).not.toContain('玉頭');
    expect(j.verdict?.why).not.toContain('最後の盾');
  });

  it('エンジンが無い環境では玉頭の歩の形だけでは叱らない', async () => {
    const pos = castledPosition({ x: 2, y: 4 });
    const j = await new Judge(null).judge(pos, usiToMove(pos, '8g8f'));
    expect(j.verdict).toBeNull();
  });

  it('端攻めは、オジジの玉が寄っている側だけ褒める', () => {
    const good = GOOD_PATTERNS.find((p) => p.id === 'edge-attack')!;
    // 玉が５一のまま
    const pos = Position.initial();
    play(pos, '1g1f', '8c8d', '1f1e', '3c3d');
    const before = pos.clone();
    const move = usiToMove(pos, '1e1d');
    pos.apply(move);
    expect(good.check({ before, move, after: pos })).toBeNull();
    // 玉が２二にいれば１筋の端攻めを認める
    pos.undo();
    pos.set(4, 0, null);
    pos.set(7, 1, { type: 'OU', color: 1 });
    pos.set(7, 0, null);
    const before2 = pos.clone();
    pos.apply(move);
    expect(good.check({ before: before2, move, after: pos })).toContain('端');
  });
});

describe('2026-09-04 のプレイ感想への修正', () => {
  const bad = (id: string) => BAD_PATTERNS.find((p) => p.id === id)!;
  const good = (id: string) => GOOD_PATTERNS.find((p) => p.id === id)!;

  it('四間飛車に組むとき、玉が右へ行っても玉飛接近とは言わない', () => {
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d', '6g6f', '3c3d', '2h6h', '4c4d');
    const before = pos.clone();
    const move = usiToMove(pos, '5i4h');
    pos.apply(move);
    expect(bad('king-near-rook').check({ before, move, after: pos })).toBeNull();
  });

  it('居飛車のまま玉を右へ寄せれば玉飛接近', () => {
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d');
    const before = pos.clone();
    const move = usiToMove(pos, '5i4h');
    pos.apply(move);
    expect(bad('king-near-rook').check({ before, move, after: pos })).toContain('飛車');
  });

  it('囲いの途中（初期配置の金銀が隣にいるだけ）では「囲いができた」と言わない', () => {
    const pos = Position.initial();
    play(pos, '5i6h', '8c8d', '6h7h', '3c3d');
    // ▲７八玉の時点: 隣は６九金・７九銀（どちらも初期配置）
    pos.undo();
    pos.undo();
    const before = pos.clone();
    const move = usiToMove(pos, '6h7h');
    pos.apply(move);
    expect(good('castled').check({ before, move, after: pos })).toBeNull();
  });

  it('矢倉囲い完成の▲８八玉と、美濃囲い完成の▲２八玉は認める', () => {
    // 矢倉: ７八金・６七金・７七銀のあとで玉が８八へ
    const y = Position.initial();
    play(y, '7g7f', '8c8d', '6i7h', '3c3d', '5i6i', '4c4d', '4i5h', '7a6b', '5h6g', '3a4b', '7i6h', '4a3b', '6h7g', '5a4a', '8h7i', '5c5d', '6i7i', '6a5b');
    const yb = y.clone();
    const ym = usiToMove(y, '7i8h');
    y.apply(ym);
    expect(good('castled').check({ before: yb, move: ym, after: y })).toContain('囲い');
    // 美濃: ６八飛、３八銀、５八金、玉が４八→３九→２八
    const mino = Position.initial();
    play(mino, '7g7f', '8c8d', '6g6f', '3c3d', '2h6h', '4c4d', '5i4h', '7a6b', '3i3h', '3a4b', '4i5h', '4a3b', '4h3i', '5a4a');
    const mb = mino.clone();
    const mm = usiToMove(mino, '3i2h');
    mino.apply(mm);
    expect(good('castled').check({ before: mb, move: mm, after: mino })).toContain('囲い');
  });

  it('王手を受ける場面では、相手の次の手ではなく受け方の悪さを説明する', async () => {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(4, 0, { type: 'HI', color: 1 }); // ５一飛（王手）
    pos.set(0, 0, { type: 'OU', color: 1 }); // ９一玉
    pos.set(3, 8, { type: 'KI', color: 0 }); // ６九金
    pos.set(2, 6, { type: 'FU', color: 0 }); // ７七歩
    expect(pos.inCheck(0)).toBe(true);
    const judge = new Judge(fakeEvaluator({
      '': { cp: 0, bestmove: '5i4i' },
      '6i5h': { cp: -500, bestmove: '5a5h+', pv: ['5a5h+'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '6i5h'));
    expect(j.verdict?.kind).toBe('eval');
    expect(j.verdict?.why).toContain('王手の受け方');
    expect(j.verdict?.why).toContain('▲４九玉');
  });

  it('相手の応手が駒を取る手なら「取られて」と言う', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 20, bestmove: '2g2f' },
      '7g7f 3c3d 8h5e': { cp: -700, bestmove: '2b5e', pv: ['2b5e'] },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '8h5e'));
    expect(j.verdict?.why).toContain('△同角で角を取られる');
  });
});

describe('説明文: 相手の次の手より、逃した手を先に言う', () => {
  it('駒が取れる手を逃したら「▲○○で△が取れた」と言う', async () => {
    // ▲５五角が△２二角を取れる局面（角道が通っている）
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d', '2g2f', '4a3b');
    // 先手番。▲２二角成（8h2b+）で角が取れるのに ▲１六歩 を指したという設定
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d 2g2f 4a3b': { cp: 300, bestmove: '8h2b+' },
      '7g7f 3c3d 2g2f 4a3b 1g1f': { cp: -50, bestmove: '2b8h+', pv: ['2b8h+'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict?.kind).toBe('eval');
    expect(j.verdict?.why.startsWith('▲２二角成で角が取れた。')).toBe(true);
    // 取る手は成る手より先に見る（△８八角成は「角を取られる」）
    expect(j.verdict?.why).toContain('指した▲１六歩には、△８八角成の応手がある。取り返せば角の交換になる。');
  });

  it('取られそうな駒を放置したら「手当てすべき」と言う', async () => {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    pos.set(2, 4, { type: 'GI', color: 0 }); // ７五銀（後手の歩に当たっている）
    pos.set(2, 3, { type: 'FU', color: 1 }); // ７四歩
    pos.set(8, 6, { type: 'FU', color: 0 }); // １七歩
    const judge = new Judge(fakeEvaluator({
      '': { cp: 0, bestmove: '7e6f' },
      '1g1f': { cp: -500, bestmove: '7d7e', pv: ['7d7e'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict?.why).toContain('７五の銀が取られそうじゃった。▲６六銀と手当てすべき。');
  });
});

describe('正解と指した手の形勢を並べる', () => {
  it('正解を指したあとの局面も評価して二行で出す', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 20, bestmove: '2g2f' },
      '7g7f 3c3d 2g2f': { cp: 60 },
      '7g7f 3c3d 8h5e': { cp: -700, bestmove: '2b5e', pv: ['2b5e'] },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '8h5e'));
    expect(j.verdict?.evalLine).toBe(['形勢の目安', '候補 ▲２六歩 → 互角', '指した ▲５五角 → 後手優勢'].join('\n'));
  });
});

describe('角交換の頷きは序盤だけ', () => {
  it('終盤に角を取っても角交換とは言わない', () => {
    const pos = Position.initial();
    // 25 手以上進んだ体にする
    for (let i = 0; i < 25; i++) pos.moves.push({ from: null, to: { x: 0, y: 0 }, piece: 'FU', promote: false });
    play(pos, '7g7f', '3c3d');
    const before = pos.clone();
    const move = usiToMove(pos, '8h2b+');
    pos.apply(move);
    const good = GOOD_PATTERNS.find((p) => p.id === 'bishop-exchange')!;
    expect(good.check({ before, move, after: pos })).toBeNull();
  });
});

describe('5 段階の反応', () => {
  const a = (cp: number): Analysis => ({ cp, mate: null, bestmove: null, pv: [], depth: 10 });

  it('勝勢のままなら段階 2 止まり。ただし大きく落とせば段階 3', () => {
    expect(severity(a(2300), a(2100))).toBe(2); // 小さな損は「良い手じゃな。だがワシなら」
    expect(severity(a(2300), a(2250))).toBe(1);
    // 596 点も落とした手を「良い手じゃな」とは呼ばない（勝っていても段階 3。カットインは出ない）
    expect(severity(a(2300), a(1704))).toBe(3);
    expect(severity(a(2300), a(600))).toBe(3); // 落ち幅が大きくても、勝っている間は段階 3 止まり
  });

  it('先手よしのまま少し損ねると 2、互角へ落ちる程度は黙る、はっきり損ねると 3', () => {
    expect(severity(a(400), a(200))).toBe(2);
    expect(severity(a(50), a(-100))).toBe(1);
    expect(severity(a(200), a(-140))).toBe(3);
  });

  it('互角以上から後手よしに転落すると 4、決定的に崩れると 5', () => {
    expect(severity(a(100), a(-250))).toBe(4);
    expect(severity(a(0), a(-720))).toBe(4);
    expect(severity(a(0), a(-1300))).toBe(5);
  });

  it('段階 2 の文は「ワシなら〜じゃ」', async () => {
    // 落ち幅は 300 点未満にする（それ以上落とすと、勝勢でも段階 3）
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 2300, bestmove: '2g2f' },
      '7g7f 3c3d 2g2f': { cp: 2300 },
      '7g7f 3c3d 1g1f': { cp: 2100, bestmove: '8c8d' },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict?.level).toBe(2);
    expect(j.verdict?.headline).toBe('良い手じゃな。だがワシならこう打つな。');
    expect(j.verdict?.why).toContain('ワシなら▲２六歩じゃ');
  });

  it('勝勢でも大きく落とした手は「良い手じゃな」ではなく「むう…」', async () => {
    // 2300 → 1704（596 点落ち）。勝っているのでカットインは出さないが、良い手とも呼ばない
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 2300, bestmove: '2g2f' },
      '7g7f 3c3d 2g2f': { cp: 2300 },
      '7g7f 3c3d 1g1f': { cp: 1704, bestmove: '8c8d' },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict?.level).toBe(3);
    expect(j.verdict?.headline).toBe('むう…');
  });

  it('形だけの NG は段階 4、詰み絡みは段階 5', async () => {
    const judge = new Judge(null);
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d');
    const j = await judge.judge(pos, usiToMove(pos, '5i4h'));
    expect(j.verdict?.level).toBe(4);
  });
});

describe('詰みの見逃しは短い詰みだけ', () => {
  const mate = (n: number, best: string): Partial<Analysis> => ({ cp: n > 0 ? 30000 - n : -30000 - n, mate: n, bestmove: best, pv: [best] });

  it('15 手詰めを見逃しても、勝勢のままなら何も言わない', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': mate(15, '2g2f'),
      '7g7f 3c3d 1g1f': { cp: 3000, bestmove: '8c8d' },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict).toBeNull();
  });

  it('3 手詰めの見逃しは「詰みを見逃すな」', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': mate(3, '2g2f'),
      '7g7f 3c3d 2g2f': { cp: 29997 },
      '7g7f 3c3d 1g1f': { cp: 500, bestmove: '8c8d' },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict?.kind).toBe('mate-missed');
    expect(j.verdict?.why).toContain('3手で詰んでおった');
  });

  it('長い詰みを許す手は、落ち幅で判断する（互角から 15 手詰めを許せば段階 5）', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 0, bestmove: '2g2f' },
      '7g7f 3c3d 2g2f': { cp: 0 },
      '7g7f 3c3d 1g1f': mate(-15, '8c8d'),
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict?.kind).toBe('eval');
    expect(j.verdict?.level).toBe(5);
  });
});

describe('攻めるべきか受けるべきか', () => {
  // 画像の局面に近い形: 先手玉７九、後手玉２二。▲３五桂打（攻め）が正解で ▲８八金（受け）を指した
  function position(): Position {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(2, 8, { type: 'OU', color: 0 }); // ７九玉
    pos.set(2, 7, { type: 'KI', color: 0 }); // ７八金
    pos.set(3, 7, { type: 'KA', color: 0 }); // ６八角
    pos.set(1, 5, { type: 'FU', color: 0 }); // ８六歩
    pos.set(7, 5, { type: 'HI', color: 0 }); // ２六飛
    pos.set(7, 1, { type: 'OU', color: 1 }); // ２二玉
    pos.set(6, 1, { type: 'KI', color: 1 }); // ３二金
    pos.set(7, 2, { type: 'FU', color: 1 }); // ２三歩（飛車の利きを止める）
    pos.set(3, 1, { type: 'HI', color: 1 }); // ６二飛
    pos.set(3, 3, { type: 'KA', color: 1 }); // ６四角
    pos.hands[0].KE = 1;
    pos.hands[0].KI = 1;
    return pos;
  }

  it('手の性質を攻めと受けに分ける', () => {
    const pos = position();
    expect(moveNature(pos, usiToMove(pos, 'N*3e'))).toBe('attack');
    expect(moveNature(pos, usiToMove(pos, 'G*8h'))).toBe('defend');
  });

  it('攻めるべきところで受けたら「受けている場合ではない」と言う', async () => {
    const pos = position();
    const judge = new Judge(fakeEvaluator({
      '': { cp: 1135, bestmove: 'N*3e' },
      'N*3e': { cp: 1135 },
      'G*8h': { cp: -527, bestmove: '6d3g+', pv: ['6d3g+'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, 'G*8h'));
    expect(j.verdict?.why.startsWith('受けている場合ではない。▲３五桂と攻める方が速い。')).toBe(true);
    expect(j.verdict?.why).toContain('指した▲８八金打には、△３七角成で成り込まれる');
    expect(j.verdict?.why).not.toContain('ここは▲３五桂じゃ');
  });
});

describe('敗勢と最善手では言わない', () => {
  it('指す前が -1000 より悪ければ、さらに落ちても何も言わない', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: -1470, bestmove: '2g2f' },
      '7g7f 3c3d 1g1f': { cp: -1990, bestmove: '8c8d', pv: ['8c8d'] },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict).toBeNull();
  });

  it('エンジンの最善手（ヒントの手）を指したなら、あとで評価が下がっても言わない', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 100, bestmove: '1g1f' },
      '7g7f 3c3d 1g1f': { cp: -600, bestmove: '8c8d', pv: ['8c8d'] },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict).toBeNull();
  });

  it('すでに後手よしの局面でさらに落ちても、転落扱い（段階 4）にはしない', () => {
    const a = (cp: number): Analysis => ({ cp, mate: null, bestmove: null, pv: [], depth: 10 });
    expect(severity(a(-300), a(-650))).toBe(3);
  });
});

describe('対局中の小言', () => {
  it('読みより良い手には「ほう」と言い、連発はしない', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 0, bestmove: '2g2f' },
      '7g7f 3c3d 1g1f': { cp: 200 },
      '7g7f 3c3d 1g1f 8c8d': { cp: 200, bestmove: '2g2f' },
      '7g7f 3c3d 1g1f 8c8d 9g9f': { cp: 400 },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const first = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(first.praise?.comment).toContain('ほう');
    play(pos, '1g1f', '8c8d');
    const second = await judge.judge(pos, usiToMove(pos, '9g9f'));
    expect(second.praise).toBeNull();
  });

  it('オジジの独り言は plan の手に対応している', () => {
    for (const key of Object.keys(YAGURA.planComments!)) {
      const inPlans = YAGURA.plans.some((v) => v.moves.includes(key));
      const inReactions = (YAGURA.reactions ?? []).some((r) => r.moves.includes(key));
      expect(inPlans || inReactions).toBe(true);
    }
  });
});

describe('詰ました手', () => {
  it('どの手で詰ましても叱らず、頷く', async () => {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    pos.set(4, 2, { type: 'KI', color: 0 }); // ５三金
    pos.set(5, 0, { type: 'KY', color: 1 }); // ４一香（後手玉の逃げ道を自分で塞いでいる）
    pos.set(3, 0, { type: 'KY', color: 1 }); // ６一香
    pos.hands[0].KI = 1;
    pos.hands[0].HI = 1;
    // ▲５二金打も ▲５二飛打も詰み。エンジンが「正解は金打」と言っても叱らない
    const judge = new Judge(fakeEvaluator({
      '': { cp: 29999, mate: 1, bestmove: 'G*5b' },
      'R*5b': { cp: -30000, mate: 0 },
    }));
    const j = await judge.judge(pos, usiToMove(pos, 'R*5b'));
    expect(j.verdict).toBeNull();
    expect(j.praise?.comment).toContain('見事');
  });
});

describe('100 局の自動対局で見つかった直し', () => {
  it('段階 2「良い手じゃな」は指したあとも先手よし以上のときだけ', () => {
    const a = (cp: number): Analysis => ({ cp, mate: null, bestmove: null, pv: [], depth: 10 });
    expect(severity(a(160), a(-10))).toBe(1); // 互角に落ちた手を「良い手」とは呼ばない
    expect(severity(a(400), a(200))).toBe(2);
    expect(severity(a(120), a(30))).toBe(1); // 小さな落ち幅は黙る
  });

  it('歩を取れた程度では「歩が取れた」と言わず、相手の狙いを先に言う', async () => {
    // 後手が８六に歩を打ち込んだ形。▲同歩が正解なのに ▲３八銀 とした
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d', '2g2f', '8d8e', '2f2e', '8e8f');
    const judge = new Judge(fakeEvaluator({
      '7g7f 8c8d 2g2f 8d8e 2f2e 8e8f': { cp: 0, bestmove: '8g8f' },
      '7g7f 8c8d 2g2f 8d8e 2f2e 8e8f 8g8f': { cp: 0 },
      '7g7f 8c8d 2g2f 8d8e 2f2e 8e8f 3i3h': { cp: -900, bestmove: '8f8g+', pv: ['8f8g+'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '3i3h'));
    expect(j.verdict?.why.startsWith('指した▲３八銀には、△８七歩成で成り込まれる。')).toBe(true);
    expect(j.verdict?.why).not.toContain('歩が取れた');
  });

  it('成れるのに成らなかった手は「成るべき」と言う', async () => {
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 });
    pos.set(0, 0, { type: 'OU', color: 1 });
    pos.set(6, 4, { type: 'KE', color: 0 }); // ３五桂
    pos.set(5, 2, { type: 'KI', color: 1 }); // ４三金（桂で取れる）
    pos.set(8, 6, { type: 'FU', color: 0 });
    const judge = new Judge(fakeEvaluator({
      '': { cp: 300, bestmove: '3e4c+' },
      '3e4c+': { cp: 300 },
      '3e4c': { cp: -100, bestmove: '9a9b' },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '3e4c'));
    expect(j.verdict?.why).toContain('成らない手はない。▲４三桂成と成るべきじゃ。');
  });

  it('正解を指した後の評価で判定をやり直す（正解の方が悪ければ言わない）', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 100, bestmove: '2g2f' },
      '7g7f 3c3d 2g2f': { cp: -400 }, // 深く読むと正解の方が悪かった
      '7g7f 3c3d 1g1f': { cp: -350, bestmove: '8c8d', pv: ['8c8d'] },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict).toBeNull();
  });
});

describe('よくある仕掛けへの受け', () => {
  it('▲２五歩と飛車先を伸ばされたら、駒組みより先に△３三角', async () => {
    const pos = Position.initial();
    play(pos, '2g2f', '8c8d', '2f2e', '3c3d', '7g7f');
    const m = await choosePlanMove(pos, YAGURA.plans[0].moves, { done: new Set(['FU:8c8d', 'FU:3c3d']) }, { evaluator: flat, reactions: YAGURA.reactions });
    expect(m && moveToUsi(m)).toBe('2b3c');
  });

  it('▲９六歩には△９四歩で位を取らせない', async () => {
    const pos = Position.initial();
    play(pos, '9g9f', '8c8d', '7g7f');
    const m = await choosePlanMove(pos, YAGURA.plans[0].moves, { done: new Set(['FU:8c8d']) }, { evaluator: flat, reactions: YAGURA.reactions });
    expect(m && moveToUsi(m)).toBe('9c9d');
  });

  it('受けが不要なら普通に駒組みを進める', async () => {
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d', '6g6f');
    const m = await choosePlanMove(pos, YAGURA.plans[0].moves, { done: new Set(['FU:8c8d']) }, { evaluator: flat, reactions: YAGURA.reactions });
    expect(m && moveToUsi(m)).toBe('3c3d');
  });

  it('受けの手を指しても、そのあと矢倉囲いは完成する', async () => {
    const pos = Position.initial();
    const state = { done: new Set<string>() };
    const idle = ['2g2f', '2f2e', '9g9f', '1g1f', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h', '5h5i', '5i5h'];
    for (const u of idle) {
      play(pos, u);
      const m = await choosePlanMove(pos, YAGURA.plans[0].moves, state, { evaluator: flat, reactions: YAGURA.reactions });
      if (!m) break;
      pos.apply(m);
    }
    const king = pos.findKing(1)!;
    expect(`${9 - king.x}${'abcdefghi'[king.y]}`).toBe('2b');
    expect(pos.get(6, 2)?.color).toBe(1); // ３三に角か銀がいる
  });
});

describe('各戦法の駒組み', () => {
  // 先手は角道を開け、角を取られたら取り返し、あとは当たり障りのない手（玉の往復）を繰り返す
  const wanted = ['7g7f', '9g9f', '1g1f', '7i8h'];
  function idleMove(pos: Position, played: Set<string>): void {
    const legal = pos.legalMoves();
    for (const u of wanted) {
      if (played.has(u)) continue;
      const m = legal.find((l) => moveToUsi(l) === u);
      if (m) { played.add(u); pos.apply(m); return; }
    }
    const k = legal.find((l) => l.piece === 'OU' && (moveToUsi(l) === '5i5h' || moveToUsi(l) === '5h5i'));
    pos.apply(k ?? legal[0]);
  }
  const cases = STYLES.flatMap((st) => st.plans.map((v) => [`${st.name}/${v.name}`, st, v.moves] as const));

  it.each(cases)('%s: 相手が待っていれば plan の手を全部指せる', async (_name, style, moves) => {
    const pos = Position.initial();
    const state = { done: new Set<string>() };
    const played = new Set<string>();
    for (let i = 0; i < 26; i++) {
      idleMove(pos, played);
      const m = await choosePlanMove(pos, moves, state, { evaluator: flat, reactions: style.reactions });
      if (!m) break;
      pos.apply(m);
    }
    const undone = moves.filter((e) => !state.done.has(e));
    expect(undone).toEqual([]);
  });

  it.each(STYLES.map((st) => [st.name, st] as const))('%s: 独り言の手は plan か受けにある', (_name, style) => {
    for (const key of Object.keys(style.planComments ?? {})) {
      const inPlans = style.plans.some((v) => v.moves.includes(key));
      const inReactions = (style.reactions ?? []).some((r) => r.moves.includes(key));
      expect(inPlans || inReactions, key).toBe(true);
    }
    expect(style.lessons.length).toBeGreaterThan(2);
    expect(style.winLine.length).toBeGreaterThan(0);
  });
});

describe('判定の補助情報', () => {
  it('最善と次善の差（gap）を振り返り用に返す', async () => {
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const ev = fakeEvaluator({
      '7g7f 3c3d': [{ cp: 50, bestmove: '2g2f' }, { cp: -200, bestmove: '1g1f' }],
      '7g7f 3c3d 2g2f': { cp: 40 },
    });
    const judge = new Judge(ev, { analyzeMs: 10 });
    const j = await judge.judge(pos, usiToMove(pos, '2g2f'));
    expect(j.analysis?.gap).toBe(250);
  });

  it('最善手が相手の狙いの手を指せなくするなら「△○○を防ぐ手」と言う', async () => {
    // 後手の角が３三から８八をにらんでいる（手番を渡すと△８八角成で大損）。
    // 正解の▲６六歩は角道をふさぐので△８八角成が非合法になる → 「△８八角成を防ぐ手」
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(8, 6, { type: 'FU', color: 0 }); // １七歩
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    pos.set(6, 2, { type: 'KA', color: 1 }); // ３三角
    pos.hands[0].FU = 1;
    const flipped = pos.clone();
    flipped.turn = 1;
    const ev = fakeEvaluator({
      '': { cp: 0, bestmove: 'P*6f' },
      'P*6f': { cp: 0 },
      '1g1f': { cp: -400, pv: ['5a4b'] }, // 相手の応手は静かな手（「取られる」の説明は出さない）
      [`sfen:${flipped.toSfen()}`]: { cp: -600, bestmove: '3c8h+' },
    });
    const judge = new Judge(ev, { analyzeMs: 10 });
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict?.level).toBeGreaterThanOrEqual(4);
    expect(j.verdict?.why).toBe('その手は形勢をはっきり損ねる。ここは▲６六歩と△８八角成を防ぐ手じゃ。');
  });

  it('正解を指しても相手の狙いの手が指せるなら「防ぐ手」とは言わない', async () => {
    // ▲７六歩 △８四歩 のあと、正解の▲２六歩を指しても △８五歩 は指せる（応手が変わるだけ）。
    // 「△８五歩を防ぐ手」は嘘なので、盤の形から狙いを言う
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d');
    const flipped = pos.clone();
    flipped.turn = 1;
    const ev = fakeEvaluator({
      '7g7f 8c8d': [{ cp: 0, bestmove: '2g2f' }, { cp: -500, bestmove: '1g1f' }],
      '7g7f 8c8d 1g1f': { cp: -800, pv: ['8d8e'] },
      '7g7f 8c8d 2g2f': { cp: 0, pv: ['3c3d'] },
      [`sfen:${flipped.toSfen()}`]: { cp: -900, bestmove: '8d8e' },
    });
    const judge = new Judge(ev, { analyzeMs: 10 });
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    // 「その手は…」で始めて「ここは…」で終える（主語が入れ替わらないように）
    expect(j.verdict?.why).toBe('その手は形勢をはっきり損ねる。ここは▲２六歩と駒を働かせる手じゃ。');
    expect(j.verdict?.why).not.toContain('防ぐ手');
  });
});

describe('形勢は言葉で示し、探索の深さは記録に残す', () => {
  // ▲７六歩 △３四歩 のあと ▲５五角 とした（△同角でタダ）。正解は ▲２六歩 という設定。指す前の読みの深さだけ変える
  function tableWithDepth(depth: number) {
    return {
      '7g7f 3c3d': { cp: 20, bestmove: '2g2f', depth },
      '7g7f 3c3d 2g2f': { cp: 60 },
      '7g7f 3c3d 8h5e': { cp: -700, bestmove: '2b5e', pv: ['2b5e'] },
    };
  }

  it('指す前の読みの深さを analysis.depth に残す（叱らない手でも）', async () => {
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': [{ cp: 50, bestmove: '2g2f', depth: 7 }, { cp: -200, bestmove: '1g1f', depth: 7 }],
      '7g7f 3c3d 2g2f': { cp: 40, depth: 12 },
    }), { analyzeMs: 10 });
    const j = await judge.judge(pos, usiToMove(pos, '2g2f'));
    expect(j.verdict).toBeNull();
    expect(j.analysis?.depth).toBe(7);
  });

  it.each([3, 12, 13, 14, 17, 20])('深さ%sでも、形勢の目安として同じ表示を使う', async (depth) => {
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await new Judge(fakeEvaluator(tableWithDepth(depth))).judge(pos, usiToMove(pos, '8h5e'));
    expect(j.verdict?.kind).toBe('eval');
    expect(j.verdict?.evalLine).toBe(['形勢の目安', '候補 ▲２六歩 → 互角', '指した ▲５五角 → 後手優勢'].join('\n'));
    expect(j.analysis?.depth).toBe(depth);
    expect(j.analysis?.before).toBe(60);
    expect(j.analysis?.after).toBe(-700);
  });

  it.each([[17, 50, 75, '互角'], [13, 253, 252, '先手よし']] as const)('再査読の深さ%s・評価%s→%sの揺れを過剰な精度で表示しない', async (depth, a, b, expected) => {
    for (const cp of [a, b]) {
      const pos = Position.initial();
      play(pos, '7g7f', '3c3d');
      const table = tableWithDepth(depth);
      table['7g7f 3c3d 2g2f'].cp = cp;
      const j = await new Judge(fakeEvaluator(table)).judge(pos, usiToMove(pos, '8h5e'));
      expect(j.verdict?.evalLine).toBe(['形勢の目安', `候補 ▲２六歩 → ${expected}`, '指した ▲５五角 → 後手優勢'].join('\n'));
      expect(j.analysis?.before).toBe(cp); // 判定や振り返り用の値は丸めない
    }
  });
});

describe('正解ならなぜ助かるか', () => {
  it('タダで取られる手に対し、正解を指せばその駒が取られないなら「▲○○なら角は取られん」と言う', async () => {
    // ▲７六歩 △３四歩 のあと ▲５五角 は △同角 でタダ。正解は角道を止める ▲６六歩 で、指した後は後手にタダで取れる駒がない
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const afterBetter = pos.clone();
    play(afterBetter, '6g6f');
    expect(bestCaptureGain(afterBetter, 1).gain).toBeLessThan(3);
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 20, bestmove: '6g6f' },
      '7g7f 3c3d 6g6f': { cp: 20 },
      '7g7f 3c3d 8h5e': { cp: -700, bestmove: '2b5e', pv: ['2b5e'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '8h5e'));
    expect(j.verdict?.kind).toBe('eval');
    expect(j.verdict?.level).toBe(4);
    expect(j.verdict?.why).toBe('指した▲５五角には、△同角で角を取られる。形勢がはっきり悪くなる。▲６六歩なら角は取られん。');
    expect(j.verdict?.why).not.toContain('ここは▲６六歩じゃ');
  });

  it('正解を指しても駒が取られるままなら、今まで通り「ここは▲○○じゃ」', async () => {
    // ５五角が５四歩に当たっている。正解は角を見捨てて ▲２三歩成 と攻める手（指した後も角はタダで取られる）
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    pos.set(4, 4, { type: 'KA', color: 0 }); // ５五角
    pos.set(4, 3, { type: 'FU', color: 1 }); // ５四歩（角に当たっている）
    pos.set(7, 3, { type: 'FU', color: 0 }); // ２四歩（成れる）
    pos.set(8, 6, { type: 'FU', color: 0 }); // １七歩
    const afterBetter = pos.clone();
    play(afterBetter, '2d2c+');
    expect(bestCaptureGain(afterBetter, 1).gain).toBeGreaterThanOrEqual(3);
    const judge = new Judge(fakeEvaluator({
      '': { cp: 300, bestmove: '2d2c+' },
      '2d2c+': { cp: 300 },
      '1g1f': { cp: -500, bestmove: '5d5e', pv: ['5d5e'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict?.kind).toBe('eval');
    expect(j.verdict?.why).toBe('指した▲１六歩には、△５五歩で角を取られる。形勢がはっきり悪くなる。ここは▲２三歩成じゃ。');
    expect(j.verdict?.why).not.toContain('取られん');
  });

  it('王手を受ける分岐と、逃した手（手当てすべき）の分岐の文は変えない', async () => {
    // 王手を受ける場面: ▲５八金 は △同飛不成 と取られ、正解 ▲４九玉 なら取られる駒はないが、文は「王手の受け方が悪い」のまま
    // （△５一飛は５八が敵陣なので、成らなければ棋譜の慣習どおり「不成」が付く）
    const check = Position.initial();
    check.board.fill(null);
    check.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    check.set(4, 0, { type: 'HI', color: 1 }); // ５一飛（王手）
    check.set(0, 0, { type: 'OU', color: 1 }); // ９一玉
    check.set(3, 8, { type: 'KI', color: 0 }); // ６九金
    check.set(2, 6, { type: 'FU', color: 0 }); // ７七歩
    expect(check.inCheck(0)).toBe(true);
    const afterKing = check.clone();
    play(afterKing, '5i4i');
    expect(bestCaptureGain(afterKing, 1).gain).toBeLessThan(3);
    const j1 = await new Judge(fakeEvaluator({
      '': { cp: 0, bestmove: '5i4i' },
      '5i4i': { cp: 0 },
      '6i5h': { cp: -500, bestmove: '5a5h', pv: ['5a5h'] },
    })).judge(check, usiToMove(check, '6i5h'));
    // 取られる駒の名前（judge-fixes）と「不成」（notation）の両方が入る
    expect(j1.verdict?.why).toBe('王手の受け方が悪い。指した▲５八金には、△同飛不成の応手がある。取り返せるので一方的な駒損ではないが、交換後の形勢まで読む必要がある。ここは▲４九玉じゃ。');

    // 取られそうな駒を放置した場面: 「手当てすべき」の文のまま
    const hang = Position.initial();
    hang.board.fill(null);
    hang.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    hang.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    hang.set(2, 4, { type: 'GI', color: 0 }); // ７五銀（後手の歩に当たっている）
    hang.set(2, 3, { type: 'FU', color: 1 }); // ７四歩
    hang.set(8, 6, { type: 'FU', color: 0 }); // １七歩
    const j2 = await new Judge(fakeEvaluator({
      '': { cp: 0, bestmove: '7e6f' },
      '7e6f': { cp: 0 },
      '1g1f': { cp: -500, bestmove: '7d7e', pv: ['7d7e'] },
    })).judge(hang, usiToMove(hang, '1g1f'));
    // 同じ事件（７五の銀が取られる）を二度言わない
    expect(j2.verdict?.why).toBe('７五の銀が取られそうじゃった。▲６六銀と手当てすべき。');
    expect(j2.verdict?.why).not.toContain('取られん');
  });
});

describe('振り返りの数字と判定を合わせる', () => {
  it('正解を読み直したら、振り返りの「指す前」もその値に揃える', async () => {
    // 指す前は +20 だが、正解 ▲２六歩 を指した後は +60。振り返りに残すのは「正解の実力」の +60
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 20, bestmove: '2g2f' },
      '7g7f 3c3d 2g2f': { cp: 60 },
      '7g7f 3c3d 8h5e': { cp: -700, bestmove: '2b5e', pv: ['2b5e'] },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '8h5e'));
    expect(j.analysis?.before).toBe(60);
    expect(j.analysis?.after).toBe(-700);
    expect(j.analysis?.better && moveToUsi(j.analysis.better)).toBe('2g2f');
  });

  it('読み直して叱るのをやめた手は、振り返りでも正解を勧めない', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 100, bestmove: '2g2f' },
      '7g7f 3c3d 2g2f': { cp: -400 }, // 深く読むと正解の方が悪かった
      '7g7f 3c3d 1g1f': { cp: -350, bestmove: '8c8d', pv: ['8c8d'] },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const j = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(j.verdict).toBeNull();
    expect(j.analysis?.before).toBe(-400);
    expect(j.analysis?.better).toBeNull(); // エンジン自身が「悪い」と言った手を振り返りで勧めない
  });

  it('指した手が最善手だったかを analysis.playedBest に残す', async () => {
    const table = {
      '7g7f 3c3d': { cp: 50, bestmove: '2g2f' },
      '7g7f 3c3d 2g2f': { cp: 40 },
      '7g7f 3c3d 1g1f': { cp: 30, bestmove: '8c8d' },
    };
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const best = await new Judge(fakeEvaluator(table)).judge(pos, usiToMove(pos, '2g2f'));
    expect(best.analysis?.playedBest).toBe(true);
    const other = await new Judge(fakeEvaluator(table)).judge(pos, usiToMove(pos, '1g1f'));
    expect(other.analysis?.playedBest).toBe(false);
  });
});

describe('取られる・取り返される・取られん の言い分け', () => {
  it('同等以上の駒を取った後の取り返しは「駒損」ではなく「交換」と言う', async () => {
    // ▲５五銀と角を取り、△同歩と取り返される形。角銀交換であって「銀を取られる」ではない
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(3, 5, { type: 'GI', color: 0 }); // ６六銀
    pos.set(8, 6, { type: 'FU', color: 0 }); // １七歩
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    pos.set(4, 4, { type: 'KA', color: 1 }); // ５五角
    pos.set(4, 3, { type: 'FU', color: 1 }); // ５四歩
    const judge = new Judge(fakeEvaluator({
      '': { cp: 300, bestmove: '1g1f' },
      '1g1f': { cp: 300 },
      '6f5e': { cp: -100, bestmove: '5d5e', pv: ['5d5e'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '6f5e'));
    expect(j.verdict?.why.startsWith('指した▲５五銀には、△同歩で取り返されて角銀交換になる。')).toBe(true);
    expect(j.verdict?.why).not.toContain('銀を取られる');
  });

  it('取り返しでなくても、同等以上の駒を取っていれば「交換」と言い添える', async () => {
    // ▲２四歩と飛車を取り、離れた８八の角を△３三角に取られる形。飛角交換であって一方的な駒損ではない
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(1, 7, { type: 'KA', color: 0 }); // ８八角
    pos.set(7, 4, { type: 'FU', color: 0 }); // ２五歩
    pos.set(8, 6, { type: 'FU', color: 0 }); // １七歩
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    pos.set(6, 2, { type: 'KA', color: 1 }); // ３三角
    pos.set(7, 3, { type: 'HI', color: 1 }); // ２四飛
    const judge = new Judge(fakeEvaluator({
      '': { cp: 300, bestmove: '1g1f' },
      '1g1f': { cp: 300 },
      '2e2d': { cp: -100, bestmove: '3c8h+', pv: ['3c8h+'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '2e2d'));
    expect(j.verdict?.why.startsWith('指した▲２四歩には、△８八角成で角を取られ、飛角交換になる。')).toBe(true);
  });

  it('正解を指しても取り自体が残るなら「タダでは取られん」と言う', async () => {
    // ８八角は７九銀が守っている。▲７八銀と離れると△８八角成でタダ。
    // 正解の▲１六歩なら守りは残るが、△８八角成という手自体は指せる
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(1, 7, { type: 'KA', color: 0 }); // ８八角
    pos.set(2, 8, { type: 'GI', color: 0 }); // ７九銀（８八を守っている）
    pos.set(8, 6, { type: 'FU', color: 0 }); // １七歩
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    pos.set(6, 2, { type: 'KA', color: 1 }); // ３三角
    const judge = new Judge(fakeEvaluator({
      '': { cp: 100, bestmove: '1g1f' },
      '1g1f': { cp: 100 },
      '7i7h': { cp: -400, bestmove: '3c8h+', pv: ['3c8h+'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '7i7h'));
    expect(j.verdict?.why).toBe('指した▲７八銀には、△８八角成で角を取られる。形勢がはっきり悪くなる。▲１六歩なら角はタダでは取られん。');
  });
});

describe('形だけのラベルを付けない', () => {
  it('取られそうな駒を逃がす手は「受け」ではなく「手当て」と言う', async () => {
    // ８八飛が△３三角ににらまれているのに、▲２四歩と銀を取りに行った。
    // 正解の▲７八飛は形だけ見れば「受け」だが、言うべきは飛車が取られそうだったこと
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(4, 8, { type: 'OU', color: 0 }); // ５九玉
    pos.set(1, 7, { type: 'HI', color: 0 }); // ８八飛
    pos.set(7, 4, { type: 'FU', color: 0 }); // ２五歩
    pos.set(4, 0, { type: 'OU', color: 1 }); // ５一玉
    pos.set(6, 2, { type: 'KA', color: 1 }); // ３三角（８八の飛車をにらんでいる）
    pos.set(7, 3, { type: 'GI', color: 1 }); // ２四銀（▲同歩と取れる）
    expect(moveNature(pos, usiToMove(pos, '8h7h'))).toBe('defend');
    expect(moveNature(pos, usiToMove(pos, '2e2d'))).toBe('attack');
    const judge = new Judge(fakeEvaluator({
      '': { cp: 200, bestmove: '8h7h' },
      '8h7h': { cp: 200 },
      '2e2d': { cp: -300, bestmove: '3c8h+', pv: ['3c8h+'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, '2e2d'));
    expect(j.verdict?.why).toBe('８八の飛が取られそうじゃった。▲７八飛と手当てすべき。');
    expect(j.verdict?.why).not.toContain('受けるのが先');
  });

  it('「攻める方が速い」と言えるのは、正解を指した後も先手が悪くないときだけ', async () => {
    // 「攻めるべきか受けるべきか」と同じ局面。正解を指しても後手よしなら「攻める方が速い」とは言わない
    const pos = Position.initial();
    pos.board.fill(null);
    pos.set(2, 8, { type: 'OU', color: 0 }); // ７九玉
    pos.set(2, 7, { type: 'KI', color: 0 }); // ７八金
    pos.set(3, 7, { type: 'KA', color: 0 }); // ６八角
    pos.set(1, 5, { type: 'FU', color: 0 }); // ８六歩
    pos.set(7, 5, { type: 'HI', color: 0 }); // ２六飛
    pos.set(7, 1, { type: 'OU', color: 1 }); // ２二玉
    pos.set(6, 1, { type: 'KI', color: 1 }); // ３二金
    pos.set(7, 2, { type: 'FU', color: 1 }); // ２三歩
    pos.set(3, 1, { type: 'HI', color: 1 }); // ６二飛
    pos.set(3, 3, { type: 'KA', color: 1 }); // ６四角
    pos.hands[0].KE = 1;
    pos.hands[0].KI = 1;
    const judge = new Judge(fakeEvaluator({
      '': { cp: -200, bestmove: 'N*3e' },
      'N*3e': { cp: -200 }, // 正解を指しても後手よし
      'G*8h': { cp: -800, bestmove: '6d3g+', pv: ['6d3g+'] },
    }));
    const j = await judge.judge(pos, usiToMove(pos, 'G*8h'));
    expect(j.verdict?.why.startsWith('受けている場合ではない。▲３五桂の方がまだ良い。')).toBe(true);
    expect(j.verdict?.why).not.toContain('攻める方が速い');
  });
});

describe('待ったで判定の記憶も戻す', () => {
  it('snapshot / restore で「一局に一度だけ」の形をもう一度叱れる', async () => {
    const judge = new Judge(null);
    const pos = Position.initial();
    play(pos, '7g7f', '8c8d');
    const snap = judge.snapshot();
    const first = await judge.judge(pos, usiToMove(pos, '5i4h'));
    expect(first.verdict?.kind).toBe('pattern');
    expect(judge.firedIds().has('king-near-rook')).toBe(true);
    judge.restore(snap);
    expect(judge.firedIds().has('king-near-rook')).toBe(false);
    const again = await judge.judge(pos, usiToMove(pos, '5i4h'));
    expect(again.verdict?.kind).toBe('pattern');
  });

  it('「このまま進む」の記憶と「ほう」の間隔も戻る', async () => {
    const judge = new Judge(fakeEvaluator({
      '7g7f 3c3d': { cp: 0, bestmove: '2g2f' },
      '7g7f 3c3d 1g1f': { cp: 200 },
      '7g7f 3c3d 1g1f 8c8d': { cp: 200, bestmove: '2g2f' },
      '7g7f 3c3d 1g1f 8c8d 9g9f': { cp: 400 },
    }));
    const pos = Position.initial();
    play(pos, '7g7f', '3c3d');
    const snap = judge.snapshot();
    const first = await judge.judge(pos, usiToMove(pos, '1g1f'));
    expect(first.praise?.comment).toContain('ほう');
    judge.ignore('mate');
    expect(judge.snapshot().ignored).toContain('mate');
    judge.restore(snap);
    expect(judge.snapshot().ignored).not.toContain('mate');
    play(pos, '1g1f', '8c8d');
    // 記憶を戻したので、間隔を空けずにもう一度「ほう」と言える
    const second = await judge.judge(pos, usiToMove(pos, '9g9f'));
    expect(second.praise?.comment).toContain('ほう');
  });
});
