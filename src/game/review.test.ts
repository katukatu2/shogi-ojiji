import { describe, it, expect } from 'vitest';
import { keyMoments, momentCaption, MoveLog } from './review';

function log(ply: number, before: number | null, after: number | null, extra: Partial<MoveLog> = {}): MoveLog {
  return { ply, movesBefore: [], usi: '7g7f', kanji: '▲７六歩', before, after, level: 1, headline: '', why: '', betterKanji: '', praise: '', ...extra };
}

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

  it('評価が無い手は無視し、動きが小さい手は選ばない', () => {
    expect(keyMoments([log(1, null, null), log(3, 0, -50)])).toEqual([]);
  });

  it('評価値は ±3000 で頭打ちにして比べる', () => {
    const m = keyMoments([log(1, 30000, 3000), log(3, 0, -500)]);
    expect(m.map((x) => x.log.ply)).toEqual([3]);
  });
});
