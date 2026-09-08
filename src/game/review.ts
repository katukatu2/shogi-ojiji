// 振り返り: 一局の中で形勢が最も動いたプレイヤーの手を 3 つ選ぶ。純粋なロジック。
// 動いた量は評価値（センチポーン）の差ではなく「勝率」の差で測る。評価値は形勢が決まるほど膨らむので、
// 点数で比べると、もう負けている局面の一手（-1957 → -2538 など）が序盤の本当の分かれ目（0 → -300）に勝ってしまう。
// 勝率にすれば前者はほぼ 0 ポイント、後者は約 25 ポイントで、正しい順になる。

export interface MoveLog {
  ply: number; // 何手目（1 始まり、プレイヤーの手）
  movesBefore: string[]; // 指す前までの手順（USI）。局面の復元に使う
  usi: string; // 指した手
  kanji: string; // 表示用
  before: number | null; // 指す前の評価（先手視点）。エンジンが無ければ null
  after: number | null; // 指した後の評価
  level: number; // 反応の段階（1 = 何もなし）
  headline: string; // オジジの反応の見出し（無ければ空）
  why: string; // 説明（無ければ空）
  betterKanji: string; // 正解の手（無ければ空）
  betterUsi?: string; // 正解の手（USI。拡大表示で盤に印を付ける）
  praise: string; // 頷きの一言（無ければ空）
}

export interface KeyMoment {
  log: MoveLog;
  kind: 'blunder' | 'good'; // 形勢を落とした手か、上げた手か
  swing: number; // 動いた勝率（ポイント。正: 悪化、負: 好転）
  winBefore: number; // 指す前の勝率（先手視点、0〜100）
  winAfter: number; // 指した後の勝率
}

// 評価値（先手視点、センチポーン）→ 先手の勝率（0〜100）。Lichess が使う式と同じ
const WIN_K = 0.00368208;
export function winProb(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * cp)) - 1);
}

export const MIN_SWING = 8; // 勝率がこれ（ポイント）以上動いた手だけを候補にする。足りなければ 3 手にこだわらない
const TIE_STEP = 5; // 勝率の差がこの幅の中なら同程度とみなし、早い手を優先する（最初の間違いに価値がある）

// 形勢の言葉。勝率で区切る（先手視点）
export type Standing = 'winning' | 'even' | 'losing' | 'lost';
export function standing(win: number): Standing {
  if (win >= 65) return 'winning';
  if (win <= 10) return 'lost';
  if (win <= 35) return 'losing';
  return 'even';
}

// 最も大きく動いた手から最大 count 件。悪化した手を優先し、残りを好転した手で埋める（どちらも足切りを超えたものだけ）
export function keyMoments(logs: MoveLog[], count = 3): KeyMoment[] {
  const scored: KeyMoment[] = [];
  for (const log of logs) {
    if (log.before === null || log.after === null) continue;
    const winBefore = winProb(log.before);
    const winAfter = winProb(log.after);
    const swing = winBefore - winAfter;
    if (Math.abs(swing) < MIN_SWING) continue;
    scored.push({ log, kind: swing > 0 ? 'blunder' : 'good', swing, winBefore, winAfter });
  }
  // 同程度の差なら早い手が先（差を TIE_STEP 刻みに丸めてから比べる）
  const bucket = (m: KeyMoment) => Math.floor(Math.abs(m.swing) / TIE_STEP);
  const order = (a: KeyMoment, b: KeyMoment) => bucket(b) - bucket(a) || a.log.ply - b.log.ply;
  const blunders = scored.filter((m) => m.kind === 'blunder').sort(order);
  const goods = scored.filter((m) => m.kind === 'good').sort(order);
  const out: KeyMoment[] = [];
  for (const m of blunders) if (out.length < count) out.push(m);
  for (const m of goods) if (out.length < count) out.push(m);
  return out.sort((a, b) => a.log.ply - b.log.ply);
}

// 振り返りの一言（数字を並べず、何が起きたかを短く）。指す前と後の形勢で文を変える
export function momentCaption(m: KeyMoment): string {
  const from = standing(m.winBefore);
  const to = standing(m.winAfter);
  if (m.kind === 'good') {
    if (m.log.praise) return `好手。${m.log.praise}`;
    if (from === 'losing' || from === 'lost') return '好手じゃった。ここで盛り返した。';
    return '好手じゃった。ここで流れが来た。';
  }
  if (m.log.why) return m.log.why;
  const better = m.log.betterKanji ? `${m.log.betterKanji}が良かった。` : '';
  if (from === 'winning' && to !== 'winning') return `リードを手放した。${better}`;
  if (from === 'even' && (to === 'losing' || to === 'lost')) return `ここで形勢が傾いた。${better}`;
  if (from === 'losing' && to === 'lost') return `苦しかったが、ここで決まった。${better}`;
  return `ここで差が広がった。${better}`;
}
