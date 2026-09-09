import { describe, it, expect } from 'vitest';
import { keyMoments, momentCaption, momentLabel, winProb, standing, MoveLog, MIN_SWING, QUIET_SWING } from './review';

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
    // 段階 1（対局中は無言）で優勢から 15 ポイント以上落とした手には「黙っておったが」の前置きが付く
    expect(cap(600, 0)).toBe('勝っておったので黙っておったが、リードを手放した。');
    expect(cap(86, -113)).toBe('互角の中で少し損をした。'); // 互角 → 互角（勝率 58 → 40）
    expect(cap(1200, 500)).toBe('優勢は保ったが、少し緩んだ。'); // 優勢 → 優勢（勝率 99 → 86。15 ポイント未満なので前置き無し）
    expect(cap(830, 171)).toBe('勝っておったので黙っておったが、勝ちを危うくした。'); // 優勢 → 優勢だが 96 → 65 と大きく落ちた
    expect(cap(-400, -1500)).toBe('苦しかったが、ここで決まった。');
    expect(cap(-300, -500)).toBe('ここで差が広がった。'); // 劣勢 → 劣勢（勝率 25 → 14）
    expect(cap(-500, 0)).toBe('好手じゃった。ここで盛り返した。');
    expect(cap(0, 400)).toBe('好手じゃった。ここで流れが来た。');
    // 説明（why）は段階 2 以上の反応で付くもの。段階 4 の説明はそのまま使う
    expect(cap(0, -600, { why: '飛車を取られる', level: 4 })).toBe('飛車を取られる');
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
  it('決め手（次善なら勝ちが消えていた局面で最善を指した手）を 1 つ入れ、間違いは大きいものを最大 2 つ', () => {
    const logs = [
      log(23, 86, -113), // 勝率 58 → 40（18 ポイント）
      log(25, 26, -132), // 52 → 38（14 ポイント。勝った対局では足切り以下）
      log(31, 400, 380, { gap: 600 }), // 勝率 81 で最善を指した。次善なら 400-600 = -200 で勝率 32 に落ちる → 決め手
      log(37, 500, 480, { gap: 100 }), // 次善でも勝率 81 が残るので決め手ではない
      log(45, 830, 171), // 96 → 65（31 ポイント）
    ];
    const m = keyMoments(logs, 3, won);
    expect(m.map((x) => [x.log.ply, x.kind])).toEqual([[23, 'blunder'], [31, 'decisive'], [45, 'blunder']]);
    expect(momentLabel(m[0], won)).toBe('ヒヤリとした手');
    expect(momentLabel(m[1], won)).toBe('決め手');
    expect(momentCaption(m[1], won)).toContain('決め手');
  });

  // 以前は負けた対局でも残りの枠に決め手を入れていたが、決め手は勝った対局だけの札にした
  it('負けた対局では間違いだけを出し、決め手は入れない', () => {
    const logs = [
      log(5, 0, -300),
      log(29, 400, 380, { gap: 600 }), // 勝った対局なら決め手になる手
      log(21, -300, -900),
    ];
    const m = keyMoments(logs, 3);
    expect(m.map((x) => [x.log.ply, x.kind])).toEqual([[5, 'blunder'], [21, 'blunder']]);
    expect(momentLabel(m[0])).toBe('形勢を落とした手');
  });

  // 以前は「勝率 92% 超は決め手にしない」だったが、「次善でも勝率 50% を超えて勝ちが残る局面は決め手にしない」に置き換えた
  it('次善でも勝ちが残る局面や、最善を外した手は決め手にしない', () => {
    expect(keyMoments([log(31, 1500, 1480, { gap: 900 })], 3, won)).toEqual([]); // 次善 600 でも勝率 90
    expect(keyMoments([log(31, 300, 100, { gap: 900 })], 3, won).map((x) => x.kind)).toEqual(['blunder']);
  });
});

describe('決め手の条件', () => {
  const won = { won: true };
  // 30 手目、勝率 80% → 79%、次善（377-490 = -113）なら勝率 40%、駒を取らない手
  const base = log(30, 377, 360, { gap: 490 });

  it('条件に合う手（30 手目、勝率 80% → 79%、次善なら 40%、取らない手）は決め手になる', () => {
    const m = keyMoments([base], 3, won);
    expect(m.map((x) => [x.log.ply, x.kind])).toEqual([[30, 'decisive']]);
    expect(m[0].winBefore).toBeCloseTo(80, 0);
    expect(m[0].winAfter).toBeCloseTo(79, 0);
    expect(m[0].gapPts).toBeGreaterThan(40);
    expect(momentLabel(m[0], won)).toBe('決め手');
    expect(momentCaption(m[0], won)).toBe('決め手じゃ。ここを間違えると勝ちが消えておった。');
  });

  it('取り返しは決め手にしない', () => {
    expect(keyMoments([{ ...base, recapture: true }], 3, won)).toEqual([]);
  });

  it('駒を取る手は決め手にしない', () => {
    expect(keyMoments([{ ...base, capture: true }], 3, won)).toEqual([]);
    expect(keyMoments([{ ...base, capture: false, recapture: false }], 3, won).map((x) => x.kind)).toEqual(['decisive']);
  });

  it('勝率 58% の局面は決め手にしない（優勢でない）', () => {
    // 86 → 80（勝率 58 → 57）。次善なら -314 で勝率 24 だが、そもそも勝っていない
    expect(keyMoments([log(30, 86, 80, { gap: 400 })], 3, won)).toEqual([]);
  });

  it('序盤 12 手以内は決め手にしない', () => {
    expect(keyMoments([{ ...base, ply: 12 }], 3, won)).toEqual([]);
    expect(keyMoments([{ ...base, ply: 1 }], 3, won)).toEqual([]);
    expect(keyMoments([{ ...base, ply: 13 }], 3, won).map((x) => x.kind)).toEqual(['decisive']);
  });

  it('王手の逃げ方が 3 手以下しか無い手は決め手にしない', () => {
    expect(keyMoments([{ ...base, inCheck: true, legalCount: 3 }], 3, won)).toEqual([]);
    expect(keyMoments([{ ...base, inCheck: true, legalCount: 1 }], 3, won)).toEqual([]);
    // 逃げ方が 4 つ以上あれば選んだ手として認める。王手でなければ合法手が少なくても構わない
    expect(keyMoments([{ ...base, inCheck: true, legalCount: 4 }], 3, won).map((x) => x.kind)).toEqual(['decisive']);
    expect(keyMoments([{ ...base, inCheck: false, legalCount: 2 }], 3, won).map((x) => x.kind)).toEqual(['decisive']);
  });

  it('次善でも勝率 50% を超える局面は決め手にしない', () => {
    // 次善 377-300 = 77 で勝率 57。間違えても勝ちは消えていない
    expect(keyMoments([{ ...base, gap: 300 }], 3, won)).toEqual([]);
  });

  it('指した後の勝率が指す前から 3 ポイントを超えて動いた手は、上がった手も決め手にしない', () => {
    expect(keyMoments([{ ...base, after: 300 }], 3, won)).toEqual([]); // 80 → 75（最善を外した）
    expect(keyMoments([{ ...base, after: 500 }], 3, won)).toEqual([]); // 80 → 86（読みの揺れ）
  });

  it('次善との差が無ければ決め手にしない', () => {
    expect(keyMoments([{ ...base, gap: null }], 3, won)).toEqual([]);
    expect(keyMoments([{ ...base, gap: undefined }], 3, won)).toEqual([]);
  });

  it('負けた対局では決め手を出さない', () => {
    expect(keyMoments([base], 3)).toEqual([]);
    expect(keyMoments([base], 3, { won: false })).toEqual([]);
  });

  it('候補が複数あれば次善との差が最大の手を 1 つだけ入れ、条件に合う手が無ければ 2 枚でも構わない', () => {
    const bigger = log(40, 377, 360, { gap: 700 }); // 次善なら -323 で勝率 23。base（40%）より差が大きい
    const m = keyMoments([base, bigger, log(20, 600, 0)], 3, won);
    expect(m.map((x) => [x.log.ply, x.kind])).toEqual([[20, 'blunder'], [40, 'decisive']]);
    // 決め手は 1 つだけ。残りは間違い 2 つで、好手は入らない
    const full = keyMoments([base, log(20, 600, 0), log(24, 830, 171), log(26, 86, -113), log(28, 0, 400)], 3, won);
    expect(full.map((x) => [x.log.ply, x.kind])).toEqual([[20, 'blunder'], [24, 'blunder'], [30, 'decisive']]);
    // 決め手の条件に合う手が無ければ、間違いだけの 2 枚
    const two = keyMoments([log(20, 600, 0), log(40, 86, -113)], 3, won);
    expect(two.map((x) => [x.log.ply, x.kind])).toEqual([[20, 'blunder'], [40, 'blunder']]);
  });
});

describe('説明文の差し替え', () => {
  const won = { won: true };
  const light = { level: 2, headline: '良い手じゃな。だがワシならこう打つな。', why: 'ワシなら▲２六歩と受けるな。', betterKanji: '▲２六歩' };

  it('段階 2 の説明は、勝率差 15 以上なら形勢の文に差し替え、優勢だったなら「勝っておったので黙っておったが、」を付ける', () => {
    expect(QUIET_SWING).toBe(15);
    const m = keyMoments([log(20, 600, 0, light)], 3, won); // 勝率 90 → 50
    expect(momentCaption(m[0], won)).toBe('勝っておったので黙っておったが、リードを手放した。▲２六歩が良かった。');
    const kept = keyMoments([log(20, 830, 171, light)], 3, won); // 96 → 65（優勢は保った）
    expect(momentCaption(kept[0], won)).toBe('勝っておったので黙っておったが、勝ちを危うくした。▲２六歩が良かった。');
    expect(momentLabel(m[0], won)).toBe('ヒヤリとした手');
  });

  it('段階 2 でも勝率差 15 未満なら説明をそのまま使う', () => {
    const m = keyMoments([log(20, 1200, 500, light)]); // 99 → 86（13 ポイント。負けた対局の足切り 8 は超える）
    expect(momentCaption(m[0])).toBe('ワシなら▲２六歩と受けるな。');
  });

  it('段階 2 で互角から落とした手は前置き無しで形勢の文', () => {
    const m = keyMoments([log(20, 86, -113, light)], 3, won); // 58 → 40（18 ポイント）
    expect(momentCaption(m[0], won)).toBe('互角の中で少し損をした。▲２六歩が良かった。');
    const lost = keyMoments([log(20, 0, -400, light)]); // 50 → 24
    expect(momentCaption(lost[0])).toBe('ここで形勢が傾いた。▲２六歩が良かった。');
  });

  it('段階 3 以上の説明はそのまま使う', () => {
    const scold = { level: 4, why: 'それは悪手じゃろう。角を取られる。', betterKanji: '▲２六歩' };
    const m = keyMoments([log(20, 600, 0, scold)], 3, won);
    expect(momentCaption(m[0], won)).toBe('それは悪手じゃろう。角を取られる。');
    const soft = keyMoments([log(20, 600, 0, { level: 3, why: 'むう…。角を取られる。' })], 3, won);
    expect(momentCaption(soft[0], won)).toBe('むう…。角を取られる。');
  });
});
