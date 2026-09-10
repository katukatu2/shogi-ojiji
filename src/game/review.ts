// 振り返り: 一局の中で形勢が最も動いたプレイヤーの手を 3 つ選ぶ。純粋なロジック。
// 動いた量は評価値（センチポーン）の差ではなく「勝率」の差で測る。評価値は形勢が決まるほど膨らむので、
// 点数で比べると、もう負けている局面の一手（-1957 → -2538 など）が序盤の本当の分かれ目（0 → -300）に勝ってしまう。
// 勝率にすれば前者はほぼ 0 ポイント、後者は約 25 ポイントで、正しい順になる。
//
// 勝った対局では「決め手」を 1 つ入れる。勝率が上がった手ではなく（それは相手の間違いか読みの揺れ）、
// 「優勢の局面で、次善を指すと勝ちが消えていたところを、最善を指した」手。
// ただし取り返しや王手の逃げ方のように、他に指しようがない手は、次善との差が大きくても決め手と呼ばない
// （「ここを間違えると勝ちが消えておった」が嘘になる）。条件に合う手が無ければ決め手は出さない。
//
// 対局中に叱らなかった手は振り返りでも責めない。最善を指した手（playedBest）とヒントの手（hinted）は、
// あとで評価が下がっても「形勢を落とした手」に選ばない。逆に決め手は playedBest が付いた手だけに限る。

export interface MoveLog {
  ply: number; // 何手目（1 始まり、プレイヤーの手）
  movesBefore: string[]; // 指す前までの手順（USI）。局面の復元に使う
  usi: string; // 指した手
  kanji: string; // 表示用
  before: number | null; // 指す前の評価（先手視点）。エンジンが無ければ null
  after: number | null; // 指した後の評価
  gap?: number | null; // 指す前の局面での「最善手と次善手の評価の差」（先手視点、正の値）。決め手の判定に使う
  capture?: boolean; // 駒を取る手（指す前の盤で、移動先に相手の駒がある）
  recapture?: boolean; // 取り返し（直前にオジジが駒を取った地点に指す手）
  inCheck?: boolean; // 指す前に王手を受けていた
  legalCount?: number; // 指す前の合法手の数
  depth?: number | null; // 判定の読みの深さ（エンジンが無ければ null）
  playedBest?: boolean; // エンジンの最善手をそのまま指した
  hinted?: boolean; // ヒントで示された手を指した
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
export const DECISIVE_MIN_WIN = 65; // 決め手: 指す前の勝率がこれ以上（優勢）
export const DECISIVE_DRIFT = 3; // 決め手: 指した後の勝率が指す前からこれ以内。上がった手も読みの揺れとみなして除く
export const DECISIVE_SECOND_MAX = 50; // 決め手: 次善を指していたら勝率がこれ以下（勝ちが消えていた）
export const DECISIVE_MIN_PLY = 12; // 決め手: これ以下の手数（序盤）は除く
export const DECISIVE_CHECK_ESCAPES = 3; // 決め手: 王手を受けていて、逃げ方がこれ以下しか無い手は除く（強制された手）
export const QUIET_SWING = 15; // 段階 2 以下（軽い反応か無言）だった手が、これ以上勝率を落としていたら説明を形勢の文に差し替える
const TIE_STEP = 5; // 勝率の差がこの幅の中なら同程度とみなし、早い手を優先する（最初の間違いに価値がある）

// 形勢の言葉。勝率で区切る（先手視点）
export type Standing = 'winning' | 'even' | 'losing' | 'lost';
export function standing(win: number): Standing {
  if (win >= 65) return 'winning';
  if (win <= 10) return 'lost';
  if (win <= 35) return 'losing';
  return 'even';
}

// 決め手の候補なら「最善と次善の勝率差（ポイント）」を返し、違えば null。
// 優勢の局面で最善（から 3 ポイント以内）を指し、次善なら勝率 50% 以下に落ちていた手。
// 序盤、駒を取る手、取り返し、王手の逃げ方が少ない手は、他に選びようが無いので決め手にしない。
// 「最善を指した」と言い切る札なので、最善だったと記録で確かめられる手（playedBest）だけに限る
function decisiveGap(log: MoveLog, before: number, winBefore: number, winAfter: number): number | null {
  if (log.playedBest !== true) return null;
  if (typeof log.gap !== 'number' || !Number.isFinite(log.gap)) return null;
  if (log.ply <= DECISIVE_MIN_PLY) return null;
  if (log.capture === true || log.recapture === true) return null;
  if (log.inCheck === true && typeof log.legalCount === 'number' && log.legalCount <= DECISIVE_CHECK_ESCAPES) return null;
  if (winBefore < DECISIVE_MIN_WIN) return null;
  if (Math.abs(winBefore - winAfter) > DECISIVE_DRIFT) return null;
  const winSecond = winProb(before - log.gap);
  if (winSecond > DECISIVE_SECOND_MAX) return null;
  return winBefore - winSecond;
}

// 同じ手数の記録が複数あるときは、後の（実際に指した）方だけを残す。
// 指し直しや待ったで消えた手を振り返りに出さないため（画面側でも記録を消すが、二重の守り）
function lastPerPly(logs: MoveLog[]): MoveLog[] {
  const byPly = new Map<number, MoveLog>();
  for (const log of logs) byPly.set(log.ply, log);
  return [...byPly.values()];
}

// 最も大きく動いた手から最大 count 件。悪化した手を優先し、残りを好転した手で埋める（どちらも足切りを超えたものだけ）。
// 勝った対局は、決め手 1 つ（あれば） → 間違い（最大 2 つ、足切り高め）→ 好手 の順。負けた対局に決め手は無い
export function keyMoments(logs: MoveLog[], count = 3, opts: ReviewOptions = {}): KeyMoment[] {
  const won = opts.won === true;
  const minSwing = won ? MIN_SWING_WON : MIN_SWING;
  const scored: KeyMoment[] = [];
  let decisive: KeyMoment | null = null;
  for (const log of lastPerPly(logs)) {
    if (log.before === null || log.after === null) continue;
    const winBefore = winProb(log.before);
    const winAfter = winProb(log.after);
    const swing = winBefore - winAfter;
    if (won) {
      // 決め手の候補が複数あれば、次善との差が最も大きい手
      const gapPts = decisiveGap(log, log.before, winBefore, winAfter);
      if (gapPts !== null && (!decisive || gapPts > decisive.gapPts!)) {
        decisive = { log, kind: 'decisive', swing, winBefore, winAfter, gapPts };
      }
    }
    if (Math.abs(swing) < minSwing) continue;
    const kind: MomentKind = swing > 0 ? 'blunder' : 'good';
    // 最善を指した手とヒントの手は、対局中に叱っていないので、あとで評価が下がっても責めない
    if (kind === 'blunder' && (log.playedBest === true || log.hinted === true)) continue;
    scored.push({ log, kind, swing, winBefore, winAfter });
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
  if (decisive) push(decisive);
  const maxBlunders = won ? MAX_BLUNDERS_WON : count;
  let n = 0;
  for (const m of blunders) if (n < maxBlunders) { push(m); n++; }
  for (const m of goods) push(m);
  return out.sort((a, b) => a.log.ply - b.log.ply);
}

// 振り返りの一言（数字を並べず、何が起きたかを短く）。指す前と後の形勢で文を変える。
// 対局中の説明（why）は段階 3 以上ならそのまま使う。段階 2 以下は「ワシならこう打つな」程度の軽い反応か無言なので、
// 勝率を大きく落とした手にはその説明を使わず、形勢の文で言い直す。前置きは対局中に何と言ったかで変える。
// 段階 1（無言）で優勢だったなら「勝っておったので黙っておったが、」、段階 2（軽く言った）なら「実は大きな損じゃった。」
export function momentCaption(m: KeyMoment, opts: ReviewOptions = {}): string {
  const from = standing(m.winBefore);
  const to = standing(m.winAfter);
  if (m.kind === 'decisive') return '決め手じゃ。ここを間違えると勝ちが消えておった。';
  if (m.kind === 'good') {
    if (m.log.praise) return `好手。${m.log.praise}`;
    if (from === 'losing' || from === 'lost') return '好手じゃった。ここで盛り返した。';
    return '好手じゃった。ここで流れが来た。';
  }
  const quiet = m.log.level <= 2 && m.swing >= QUIET_SWING;
  if (m.log.why && !quiet) return m.log.why;
  let head = '';
  if (quiet && m.log.level === 2) head = 'ワシならこう打つと言ったが、実は大きな損じゃった。';
  else if (quiet && from === 'winning') head = '勝っておったので黙っておったが、';
  const better = m.log.betterKanji ? `${m.log.betterKanji}が良かった。` : '';
  if (from === 'winning' && to === 'winning') return m.swing >= 20 ? `${head}勝ちを危うくした。${better}` : `${head}優勢は保ったが、少し緩んだ。${better}`;
  if (from === 'winning') return `${head}リードを手放した。${better}`;
  if (from === 'even' && to === 'even') return `${head}互角の中で少し損をした。${better}`;
  if (from === 'even') return `${head}ここで形勢が傾いた。${better}`;
  if (from === 'losing' && to === 'lost') return `${head}苦しかったが、ここで決まった。${better}`;
  if (opts.won) return `${head}危ない手じゃった。${better}`;
  return `${head}ここで差が広がった。${better}`;
}

// カードや拡大表示の札に出す言葉
export function momentLabel(m: KeyMoment, opts: ReviewOptions = {}): string {
  if (m.kind === 'decisive') return '決め手';
  if (m.kind === 'good') return '好手';
  return opts.won ? 'ヒヤリとした手' : '形勢を落とした手';
}
