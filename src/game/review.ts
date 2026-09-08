// 振り返り: 一局の中で形勢が最も動いたプレイヤーの手を 3 つ選ぶ。純粋なロジック。

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
  swing: number; // 動いた点数（正: 悪化、負: 好転）
}

const CLAMP = 3000;

function clamp(v: number): number {
  return Math.max(-CLAMP, Math.min(CLAMP, v));
}

// 最も大きく動いた手から最大 count 件。悪化した手を優先し、残りを好転した手で埋める
export function keyMoments(logs: MoveLog[], count = 3): KeyMoment[] {
  const scored: KeyMoment[] = [];
  for (const log of logs) {
    if (log.before === null || log.after === null) continue;
    const swing = clamp(log.before) - clamp(log.after);
    if (Math.abs(swing) < 100) continue;
    scored.push({ log, kind: swing > 0 ? 'blunder' : 'good', swing });
  }
  const blunders = scored.filter((m) => m.kind === 'blunder').sort((a, b) => b.swing - a.swing);
  const goods = scored.filter((m) => m.kind === 'good').sort((a, b) => a.swing - b.swing);
  const out: KeyMoment[] = [];
  for (const m of blunders) if (out.length < count) out.push(m);
  for (const m of goods) if (out.length < count) out.push(m);
  return out.sort((a, b) => a.log.ply - b.log.ply);
}

// 振り返りの一言（数字を並べず、何が起きたかを短く）
export function momentCaption(m: KeyMoment): string {
  if (m.kind === 'good') return m.log.praise ? `好手。${m.log.praise}` : '好手じゃった。ここで流れが来た。';
  if (m.log.why) return m.log.why;
  return m.log.betterKanji ? `ここは${m.log.betterKanji}じゃった。` : 'ここで形勢が傾いた。';
}
