import { describe, it, expect } from 'vitest';
import { keyMoments, momentCaption, winProb, standing, MoveLog, MIN_SWING } from './review';

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
