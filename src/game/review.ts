// 振り返り: 一局の中で形勢が最も動いたプレイヤーの手を 3 つ選ぶ。純粋なロジック。
// 動いた量は評価値（センチポーン）の差ではなく「勝率」の差で測る。評価値は形勢が決まるほど膨らむので、
// 点数で比べると、もう負けている局面の一手（-1957 → -2538 など）が序盤の本当の分かれ目（0 → -300）に勝ってしまう。
// 勝率にすれば前者はほぼ 0 ポイント、後者は約 25 ポイントで、正しい順になる。
//
// 勝った対局では「決め手」を 1 つ入れる。勝率が上がった手ではなく（それは相手の間違いか読みの揺れ）、
// 「最善と次善の差が大きい局面で、最善を指した」手。間違えると勝ちが消えていた手が、勝ちにつなげた手。

export interface MoveLog {
  ply: number; // 何手目（1 始まり、プレイヤーの手）
  movesBefore: string[]; // 指す前までの手順（USI）。局面の復元に使う
  usi: string; // 指した手
  kanji: string; // 表示用
  before: number | null; // 指す前の評価（先手視点）。エンジンが無ければ null
  after: number | null; // 指した後の評価
  gap?: number | null; // 指す前の局面での「最善手と次善手の評価の差」（先手視点、正の値）。決め手の判定に使う
  level: number; // 反応の段階（1 = 何もなし）
  headline: string; // オジジの反応の見出し（無ければ空）
  why: string; // 説明（無ければ空）
  betterKanji: string; // 正解の手（無ければ空）
  betterUsi?: string; // 正解の手（USI。拡大表示で盤に印を付ける）
  praise: string; // 頷きの一言（無ければ空）
}

export type MomentKind = 'blunder' | 'good' | 'decisive';

export interface KeyMoment {
  log: MoveLog;
  kind: MomentKind; // 形勢を落とした手 / 上げた手 / 決め手
  swing: number; // 動いた勝率（ポイント。正: 悪化、負: 好転）
  winBefore: number; // 指す前の勝率（先手視点、0〜100）
  winAfter: number; // 指した後の勝率
  gapPts?: number; // 決め手: 最善と次善の勝率差（ポイント）
}

export interface ReviewOptions {
  won?: boolean; // プレイヤーが勝った対局か。勝った対局は間違いを控えめにし、決め手を入れる
}

// 評価値（先手視点、センチポーン）→ 先手の勝率（0〜100）。Lichess が使う式と同じ
const WIN_K = 0.00368208;
export function winProb(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * cp)) - 1);
}

export const MIN_SWING = 8; // 勝率がこれ（ポイント）以上動いた手だけを候補にする。足りなければ 3 手にこだわらない
export const MIN_SWING_WON = 15; // 勝った対局では、間違いはこれ以上動いた手だけ
export const MAX_BLUNDERS_WON = 2; // 勝った対局で見せる間違いの数
export const DECISIVE_GAP = 12; // 決め手: 最善と次善の勝率差がこれ以上
export const DECISIVE_LOSS = 3; // 決め手: 指した手が最善からこれ以内の損
const TIE_STEP = 5; // 勝率の差がこの幅の中なら同程度とみなし、早い手を優先する（最初の間違いに価値がある）

// 形勢の言葉。勝率で区切る（先手視点）
export type Standing = 'winning' | 'even' | 'losing' | 'lost';
export function standing(win: number): Standing {
  if (win >= 65) return 'winning';
  if (win <= 10) return 'lost';
  if (win <= 35) return 'losing';
  return 'even';
}

// 最も大きく動いた手から最大 count 件。悪化した手を優先し、残りを好転した手で埋める（どちらも足切りを超えたものだけ）。
// 勝った対局は、決め手 1 つ → 間違い（最大 2 つ、足切り高め）→ 好手 の順
export function keyMoments(logs: MoveLog[], count = 3, opts: ReviewOptions = {}): KeyMoment[] {
  const won = opts.won === true;
  const minSwing = won ? MIN_SWING_WON : MIN_SWING;
  const scored: KeyMoment[] = [];
  let decisive: KeyMoment | null = null;
  for (const log of logs) {
    if (log.before === null || log.after === null) continue;
    const winBefore = winProb(log.before);
    const winAfter = winProb(log.after);
    const swing = winBefore - winAfter;
    // 決め手の候補: 最善を（ほぼ）指していて、次善だと勝率が大きく落ちた局面。もう決まった局面（勝率 92% 超）は除く
    if (log.gap !== null && log.gap !== undefined && log.gap > 0 && swing <= DECISIVE_LOSS && winBefore <= 92 && winBefore >= 35) {
      const gapPts = winBefore - winProb(log.before - log.gap);
      if (gapPts >= DECISIVE_GAP && (!decisive || gapPts > decisive.gapPts!)) {
        decisive = { log, kind: 'decisive', swing, winBefore, winAfter, gapPts };
      }
    }
    if (Math.abs(swing) < minSwing) continue;
    scored.push({ log, kind: swing > 0 ? 'blunder' : 'good', swing, winBefore, winAfter });
  }
  // 同程度の差なら早い手が先（差を TIE_STEP 刻みに丸めてから比べる）
  const bucket = (m: KeyMoment) => Math.floor(Math.abs(m.swing) / TIE_STEP);
  const order = (a: KeyMoment, b: KeyMoment) => bucket(b) - bucket(a) || a.log.ply - b.log.ply;
  const blunders = scored.filter((m) => m.kind === 'blunder').sort(order);
  const goods = scored.filter((m) => m.kind === 'good').sort(order);
  const out: KeyMoment[] = [];
  const used = new Set<number>();
  const push = (m: KeyMoment) => {
    if (out.length < count && !used.has(m.log.ply)) {
      out.push(m);
      used.add(m.log.ply);
    }
  };
  if (won && decisive) push(decisive);
  const maxBlunders = won ? MAX_BLUNDERS_WON : count;
  let n = 0;
  for (const m of blunders) if (n < maxBlunders) { push(m); n++; }
  if (!won && decisive) push(decisive);
  for (const m of goods) push(m);
  return out.sort((a, b) => a.log.ply - b.log.ply);
}

// 振り返りの一言（数字を並べず、何が起きたかを短く）。指す前と後の形勢で文を変える
export function momentCaption(m: KeyMoment, opts: ReviewOptions = {}): string {
  const from = standing(m.winBefore);
  const to = standing(m.winAfter);
  if (m.kind === 'decisive') return '決め手じゃ。ここを間違えると勝ちが消えておった。';
  if (m.kind === 'good') {
    if (m.log.praise) return `好手。${m.log.praise}`;
    if (from === 'losing' || from === 'lost') return '好手じゃった。ここで盛り返した。';
    return '好手じゃった。ここで流れが来た。';
  }
  if (m.log.why) return m.log.why;
  const better = m.log.betterKanji ? `${m.log.betterKanji}が良かった。` : '';
  if (from === 'winning' && to === 'winning') return m.swing >= 20 ? `勝ちを危うくした。${better}` : `優勢は保ったが、少し緩んだ。${better}`;
  if (from === 'winning') return `リードを手放した。${better}`;
  if (from === 'even' && to === 'even') return `互角の中で少し損をした。${better}`;
  if (from === 'even') return `ここで形勢が傾いた。${better}`;
  if (from === 'losing' && to === 'lost') return `苦しかったが、ここで決まった。${better}`;
  if (opts.won) return `危ない手じゃった。${better}`;
  return `ここで差が広がった。${better}`;
}

// カードや拡大表示の札に出す言葉
export function momentLabel(m: KeyMoment, opts: ReviewOptions = {}): string {
  if (m.kind === 'decisive') return '決め手';
  if (m.kind === 'good') return '好手';
  return opts.won ? 'ヒヤリとした手' : '形勢を落とした手';
}
