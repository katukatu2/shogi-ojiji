import { describe, it, expect } from 'vitest';
import { keyMoments, momentCaption, momentLabel, winProb, standing, MoveLog, MIN_SWING } from './review';

function log(ply: number, before: number | null, after: number | null, extra: Partial<MoveLog> = {}): MoveLog {
  return { ply, movesBefore: [], usi: '7g7f', kanji: '▲７六歩', before, after, level: 1, headline: '', why: '', betterKanji: '', praise: '', ...extra };
}

describe('勝率', () => {
  it('互角は 50%、大きく離れると 0 / 100 に近づく', () => {
    expect(winProb(0)).toBeCloseTo(50, 5);
    expect(winProb(300)).toBeGreaterThan(70);
    expect(winProb(-300)).toBeLessThan(30);
    expect(winProb(-2000)).toBeLessThan(1);
    expect(winProb(30000)).toBeGreaterThan(99.9);
    expect(standing(50)).toBe('even');
    expect(standing(70)).toBe('winning');
    expect(standing(30)).toBe('losing');
    expect(standing(5)).toBe('lost');
  });
});

describe('振り返りの 3 手', () => {
  it('形勢を落とした手を大きい順に、足りなければ好転した手で埋め、手数順に並べる', () => {
    const logs = [
      log(1, 0, 10),
      log(3, 10, -400, { why: '角を取られる', level: 4 }),
      log(5, -400, -350),
      log(7, -350, 200, { praise: 'ほう' }),
      log(9, 200, -900, { why: '詰まされる', level: 5 }),
      log(11, -900, -950),
    ];
    const m = keyMoments(logs);
    expect(m.map((x) => x.log.ply)).toEqual([3, 7, 9]);
    expect(m.find((x) => x.log.ply === 7)?.kind).toBe('good');
    expect(momentCaption(m[0])).toBe('角を取られる');
    expect(momentCaption(m[1])).toContain('好手');
  });

  it('もう負けている局面の大きな点差より、序盤の小さな点差を選ぶ', () => {
    const logs = [
      log(5, 0, -300, { betterKanji: '▲２六歩' }), // 互角 → 劣勢（勝率 50 → 25）
      log(31, -1957, -2538), // 敗勢 → 敗勢（勝率 0.07 → 0.01）
      log(33, -2538, -3100),
    ];
    const m = keyMoments(logs);
    expect(m.map((x) => x.log.ply)).toEqual([5]);
    expect(m[0].swing).toBeGreaterThan(20);
    expect(momentCaption(m[0])).toBe('ここで形勢が傾いた。▲２六歩が良かった。');
  });

  it('説明文は指す前と後の形勢で変わる', () => {
    const cap = (before: number, after: number, extra: Partial<MoveLog> = {}) => momentCaption(keyMoments([log(1, before, after, extra)])[0]);
    expect(cap(600, 0)).toBe('リードを手放した。');
    expect(cap(86, -113)).toBe('互角の中で少し損をした。'); // 互角 → 互角（勝率 58 → 40）
    expect(cap(1200, 500)).toBe('優勢は保ったが、少し緩んだ。'); // 優勢 → 優勢（勝率 99 → 86）
    expect(cap(830, 171)).toBe('勝ちを危うくした。'); // 優勢 → 優勢だが 96 → 65 と大きく落ちた
    expect(cap(-400, -1500)).toBe('苦しかったが、ここで決まった。');
    expect(cap(-300, -500)).toBe('ここで差が広がった。'); // 劣勢 → 劣勢（勝率 25 → 14）
    expect(cap(-500, 0)).toBe('好手じゃった。ここで盛り返した。');
    expect(cap(0, 400)).toBe('好手じゃった。ここで流れが来た。');
    expect(cap(0, -600, { why: '飛車を取られる' })).toBe('飛車を取られる');
  });

  it('同程度の差なら早い手を優先し、足切り以下の手は 3 手に満たなくても入れない', () => {
    const logs = [
      log(21, 0, -260), // 勝率差 約 23
      log(9, 0, -250), // 約 22。同程度なので早い方が先
      log(15, 0, -60), // 約 5.5。足切り以下
    ];
    const m = keyMoments(logs);
    expect(m.map((x) => x.log.ply)).toEqual([9, 21]);
    expect(keyMoments([log(1, 0, -60)])).toEqual([]);
    expect(MIN_SWING).toBe(8);
  });

  it('評価が無い手は無視する', () => {
    expect(keyMoments([log(1, null, null), log(3, 0, -50)])).toEqual([]);
  });
});

describe('勝った対局の振り返り', () => {
  const won = { won: true };
  it('決め手（最善と次善の差が大きい局面で最善を指した手）を 1 つ入れ、間違いは大きいものを最大 2 つ', () => {
    const logs = [
      log(23, 86, -113), // 勝率 58 → 40（18 ポイント）
      log(25, 26, -132), // 52 → 38（14 ポイント。勝った対局では足切り以下）
      log(31, 400, 380, { gap: 600 }), // 最善を指した。次善なら 400-600 = -200 で勝率が大きく落ちる → 決め手
      log(37, 500, 480, { gap: 100 }), // 差が小さいので決め手ではない
      log(45, 830, 171), // 96 → 65（31 ポイント）
    ];
    const m = keyMoments(logs, 3, won);
    expect(m.map((x) => [x.log.ply, x.kind])).toEqual([[23, 'blunder'], [31, 'decisive'], [45, 'blunder']]);
    expect(momentLabel(m[0], won)).toBe('ヒヤリとした手');
    expect(momentLabel(m[1], won)).toBe('決め手');
    expect(momentCaption(m[1], won)).toContain('決め手');
  });

  it('負けた対局では間違いを優先し、決め手は残りの枠に入れる', () => {
    const logs = [
      log(5, 0, -300),
      log(9, 0, -20, { gap: 500 }), // 互角での決め手候補（次善なら勝率 50 → 14）
      log(21, -300, -900),
    ];
    const m = keyMoments(logs, 3);
    expect(m.map((x) => [x.log.ply, x.kind])).toEqual([[5, 'blunder'], [9, 'decisive'], [21, 'blunder']]);
    expect(momentLabel(m[0])).toBe('形勢を落とした手');
  });

  it('もう決まった局面（勝率 92% 超）や、最善を外した手は決め手にしない', () => {
    expect(keyMoments([log(1, 1500, 1480, { gap: 900 })], 3, won)).toEqual([]);
    expect(keyMoments([log(1, 300, 100, { gap: 900 })], 3, won).map((x) => x.kind)).toEqual(['blunder']);
  });
});
