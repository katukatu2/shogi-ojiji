import { Position } from '../engine/position';
import { Move, PIECE_VALUE, PieceType, PIECE_KANJI, PIECE_NAME, Color } from '../engine/types';
import { moveToUsi, usiToMove, moveToKanji, sqToKanji } from '../engine/notation';
import { findMateInOne } from '../ai/search';
import { Analysis, Evaluator } from '../ai/engine';
import { BAD_PATTERNS, GOOD_PATTERNS, PatternContext, BadPattern, GoodPattern } from './patterns';

export interface JudgeOptions {
  analyzeMs?: number;
  bad?: BadPattern[]; // 戦法ごとの NG の形（省略時は矢倉向けの既定）
  good?: GoodPattern[]; // 戦法ごとの良い形
}

export type VerdictKind = 'pattern' | 'blunder' | 'mate-missed' | 'mate-allowed' | 'eval';

// 「ばかもーん！」で止める判定
// 反応の強さ。2・3 は吹き出しで流し、4 は静かなカットイン、5 は「ばかもーん！」
export type Level = 2 | 3 | 4 | 5;

export interface Verdict {
  kind: VerdictKind;
  level: Level;
  headline: string; // 一言（画面の見出し）
  why: string; // 説教の本文
  better: Move | null; // 盤上でハイライトする正解の手
  evalLine?: string; // 「形勢 +120 → -350」のような一行
  ignoreKey?: string; // 「このまま進む」を選んだとき同じ叱責を繰り返さないためのキー
  usedPurpose?: boolean; // 内部用: why が「最善手の狙い」の説明を含む（判定後に、相手の狙いを読んで言い換える）
}

// engineVerdict が why に埋める印。judge() が「最善手の狙い」の文に置き換える
const PURPOSE_MARK = '{{purpose}}';
const THREAT_DROP = 150; // 相手に手番を渡すとこれ以上損する（先手視点）なら「狙いがある」とみなす

// 良い手への一言（無言の頷きに添える）
export interface Praise {
  comment: string;
}

export interface Judgement {
  verdict: Verdict | null;
  praise: Praise | null;
  // 振り返り用: 指す前と指した後の評価（先手視点）。エンジンが無いときは null。
  // gap は指す前の局面での最善手と次善手の評価の差（正の値。次善が読めなければ null）。「決め手」の判定に使う。
  // depth は指す前の読みの深さ（数字の確からしさの目安。記録に残す）
  analysis?: { before: number; after: number; better: Move | null; gap: number | null; depth: number };
}

// 駒がタダで取られると判断する損失のしきい値（香車以上）。エンジンが無いときの簡易判定用
const HANG_THRESHOLD = 3;

// エンジン評価で反応を決める基準（先手視点の点数）
export const LEVEL2_DROP = 150; // これ以上落ちたら「だがワシならこう打つ」
export const LEVEL2_MIN_AFTER = 150; // 段階 2 は指したあとも先手よし以上のときだけ（悪い手を「良い手」と呼ばない）
export const EVAL_DROP = 300; // これ以上落ちたら「むう…」以上
export const LEVEL4_DROP = 700; // 形勢に関係なく、これ以上落ちたら「悪手」
export const LEVEL5_DROP = 1200; // これ以上落ちたら「ばかもーん！」
export const STILL_GOOD = 500; // 指したあともこれ以上なら、どれだけ落ちても段階 2 止まり
export const TURNED_BAD = -150; // 指したあとこれ未満なら「後手よし」に転落
export const SURPRISE_GAIN = 150; // 読みよりこれ以上良くなった手には「ほう」
export const SURPRISE_INTERVAL = 6; // 「ほう」は何手か空けて言う
export const EVAL_HOPELESS = -1000; // 指す前にこれより悪ければ（後手優勢以上）、何を指しても言わない
export const MATE_MISSED_MAX = 3; // この手数以内の詰みを見逃したときだけ「詰みを見逃すな」（長い詰みは初心者に見えない）
export const MATE_ALLOWED_MAX = 5; // この手数以内で詰まされる手だけ「詰まされるぞ」。長い詰みは形勢の落ち幅で判断
export const SHALLOW_DEPTH = 8; // 指す前の読みがこれより浅ければ、形勢の数字に「目安」と添える（浅い読みの数字を確かなものと思わせない）
const EVAL_CLAMP = 3000;

// 落ち幅と、落ちた結果の形勢から段階を決める（1 は反応なし）
export function severity(before: Analysis, after: Analysis): 1 | Level {
  const b = clampCp(before);
  const a = clampCp(after);
  const drop = b - a;
  if (a >= STILL_GOOD) return drop >= LEVEL2_DROP ? 2 : 1; // 勝っているうちは責めない
  if (drop >= LEVEL5_DROP) return 5;
  if (drop >= LEVEL4_DROP || (drop >= EVAL_DROP && b >= TURNED_BAD && a < TURNED_BAD)) return 4;
  if (drop >= EVAL_DROP) return 3;
  if (drop >= LEVEL2_DROP && a >= LEVEL2_MIN_AFTER) return 2;
  return 1;
}

export const LEVEL_HEADLINE: Record<Level, string> = {
  2: '良い手じゃな。だがワシならこう打つな。',
  3: 'むう…',
  4: 'それは悪手じゃろう',
  5: 'ばかもーん！',
};

const ANALYZE_MS = 400;

// by 側が今すぐ取れる駒のうち、いちばん得な取り方の得点を返す
export function bestCaptureGain(pos: Position, by: Color): { gain: number; target: Move | null; victim: PieceType | null } {
  const saved = pos.turn;
  pos.turn = by;
  let best = { gain: 0, target: null as Move | null, victim: null as PieceType | null };
  for (const m of pos.legalMoves()) {
    const victim = pos.get(m.to.x, m.to.y);
    if (!victim || victim.type === 'OU') continue;
    pos.apply(m);
    const defended = pos.isAttacked(m.to.x, m.to.y, (1 - by) as Color);
    pos.undo();
    const gain = PIECE_VALUE[victim.type] - (defended ? PIECE_VALUE[m.piece as PieceType] : 0);
    if (gain > best.gain) best = { gain, target: m, victim: victim.type };
  }
  pos.turn = saved;
  return best;
}

export function formatCp(a: Analysis): string {
  if (a.mate !== null) return a.mate > 0 ? `先手${a.mate}手詰` : `後手${-a.mate}手詰`;
  const v = Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, a.cp));
  return (v > 0 ? '+' : '') + String(v);
}

// 形勢を言葉にする（先手視点）
export function describeSide(a: Analysis): string {
  if (a.mate !== null) return a.mate > 0 ? '先手勝ち' : '後手勝ち';
  const v = a.cp;
  if (v >= 1500) return '先手勝勢';
  if (v >= 500) return '先手優勢';
  if (v >= 150) return '先手よし';
  if (v > -150) return '互角';
  if (v > -500) return '後手よし';
  if (v > -1500) return '後手優勢';
  return '後手勝勢';
}

function clampCp(a: Analysis): number {
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, a.cp));
}

// 読みが浅ければ「（読み N 手・目安）」。十分な深さなら空
function depthNote(a: Analysis): string {
  return a.depth < SHALLOW_DEPTH ? `（読み ${a.depth} 手・目安）` : '';
}

// 正解 better を指したあと、後手にタダ同然（香車以上の得）で取れる駒が残らないか
function savesFromCapture(pos: Position, better: Move): boolean {
  pos.apply(better);
  try {
    return bestCaptureGain(pos, 1).gain < HANG_THRESHOLD;
  } finally {
    pos.undo();
  }
}

export class Judge {
  private ignored = new Set<string>();
  private fired = new Set<string>(); // 一局に一度だけ反応するパターン
  private cache = new Map<string, Promise<Analysis[]>>();
  private lastSurprise = -100; // 「ほう」と言った手数

  private analyzeMs: number;
  private bad: BadPattern[];
  private good: GoodPattern[];

  constructor(private evaluator: Evaluator | null = null, opts: JudgeOptions | number = {}) {
    const o: JudgeOptions = typeof opts === 'number' ? { analyzeMs: opts } : opts;
    this.analyzeMs = o.analyzeMs ?? ANALYZE_MS;
    this.bad = o.bad ?? BAD_PATTERNS;
    this.good = o.good ?? GOOD_PATTERNS;
  }

  setEvaluator(e: Evaluator | null): void {
    this.evaluator = e;
    this.cache.clear();
  }

  hasEvaluator(): boolean {
    return this.evaluator !== null;
  }

  ignore(key: string | undefined): void {
    if (key) this.ignored.add(key);
  }

  // この一局で反応した形の id（課題の達成判定に使う）
  firedIds(): ReadonlySet<string> {
    return this.fired;
  }

  // 相手が考えている間に、次の局面を先読みしておく
  prefetch(pos: Position): void {
    if (this.evaluator) void this.evalOf(pos).catch(() => undefined);
  }

  // 局面の評価（キャッシュつき）。オジジの手選びにも使う
  evalOf(pos: Position): Promise<Analysis> {
    return this.evalLines(pos).then((lines) => lines[0]);
  }

  // 最善と次善（MultiPV 2）。次善は「決め手」の判定に使う。読めなければ 1 本だけ
  evalLines(pos: Position): Promise<Analysis[]> {
    if (!this.evaluator) return Promise.reject(new Error('no evaluator'));
    const key = pos.key();
    let p = this.cache.get(key);
    if (!p) {
      const moves = pos.moves.map(moveToUsi);
      p = this.evaluator.analyzeMulti(moves, { movetime: this.analyzeMs, multipv: 2 }).then((lines) => {
        if (lines.length === 0) throw new Error('no analysis');
        return lines;
      });
      this.cache.set(key, p);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  // 相手に手番を渡したら何をされるか（先手番の局面を後手番として読む）。読めなければ null
  private async threatOf(pos: Position): Promise<{ move: Move; analysis: Analysis } | null> {
    if (!this.evaluator) return null;
    const flipped = pos.clone();
    flipped.turn = 1;
    try {
      const a = await this.evaluator.analyze([], { sfen: flipped.toSfen(), movetime: this.analyzeMs });
      const move = a.bestmove ? safeMove(flipped, a.bestmove) : null;
      return move ? { move, analysis: a } : null;
    } catch {
      return null;
    }
  }

  // 最善手の狙いを言う。相手の狙い（手番を渡したときの最善）があり、最善手を指すとその狙いが消えるなら「○○を防ぐ手」。
  // afterBest は最善手を指した後の読み（相手の応手 pv[0] が狙いと違えば、狙いは消えたとみなす）
  private async purposeOf(pos: Position, best: Move, before: Analysis, afterBest: Analysis | null): Promise<string> {
    if (moveNature(pos, best) !== 'attack') {
      const threat = await this.threatOf(pos);
      if (threat && clampCp(threat.analysis) <= clampCp(before) - THREAT_DROP) {
        const reply = afterBest?.pv[0] ?? null;
        if (reply !== moveToUsi(threat.move)) {
          return `ここは${moveToKanji(best, 0, null, pos)}と${moveToKanji(threat.move, 1, null, pos)}を防ぐ手じゃ。`;
        }
      }
    }
    return describeBestPurpose(pos, best);
  }

  // pos は先手番の局面（手を指す前）。move は指そうとしている手。
  async judge(pos: Position, move: Move): Promise<Judgement> {
    const none: Judgement = { verdict: null, praise: null };

    // 詰ました手は判定しない（どの詰め方でも詰みは詰み）
    pos.apply(move);
    const mated = pos.isGameOver();
    pos.undo();
    if (mated) return { ...none, praise: { comment: '詰みか。……見事じゃ。' } };

    // 形で分かる NG と良い手
    const beforePos = pos.clone();
    pos.apply(move);
    const ctx: PatternContext = { before: beforePos, move, after: pos };
    let hard: { p: BadPattern; why: string } | null = null; // 形だけで叱る
    let soft: { p: BadPattern; why: string } | null = null; // エンジンの裏付けが要る
    let good: Praise | null = null;
    let goodId: string | null = null;
    try {
      for (const p of this.bad) {
        if (this.fired.has(p.id)) continue;
        const why = p.check(ctx);
        if (!why) continue;
        if (p.minDrop === undefined) {
          hard = { p, why };
          break;
        }
        if (!soft) soft = { p, why };
      }
      if (!hard) {
        for (const p of this.good) {
          if (this.fired.has(p.id)) continue;
          const comment = p.check(ctx);
          if (comment) {
            good = { comment };
            goodId = p.id;
            break;
          }
        }
      }
    } finally {
      pos.undo();
    }
    if (hard) {
      this.fired.add(hard.p.id);
      return { ...none, verdict: { kind: 'pattern', level: 4, headline: hard.p.headline, why: hard.why, better: null, ignoreKey: `pattern:${hard.p.id}` } };
    }

    const praise = (): Judgement => {
      if (goodId) this.fired.add(goodId);
      return { ...none, praise: good };
    };

    if (!this.evaluator) {
      const tactical = this.tactical(pos, move);
      return tactical ? { ...none, verdict: tactical } : praise();
    }

    let before: Analysis;
    let after: Analysis;
    let second: Analysis | null = null;
    try {
      const lines = await this.evalLines(pos);
      before = lines[0];
      second = lines[1] ?? null;
      pos.apply(move);
      try {
        after = await this.evalOf(pos);
      } finally {
        pos.undo();
      }
    } catch {
      const tactical = this.tactical(pos, move);
      return tactical ? { ...none, verdict: tactical } : praise();
    }

    if (soft && clampCp(before) > EVAL_HOPELESS && before.bestmove !== moveToUsi(move)) {
      const drop = clampCp(before) - clampCp(after);
      if (drop >= soft.p.minDrop!) {
        this.fired.add(soft.p.id);
        const better = before.bestmove && before.bestmove !== moveToUsi(move) ? safeMove(pos, before.bestmove) : null;
        return {
          ...none,
          verdict: {
            kind: 'pattern',
            level: Math.max(3, severity(before, after)) as Level,
            headline: soft.p.headline,
            why: soft.why + (better ? `ここは${moveToKanji(better, 0, null, pos)}じゃ。` : ''),
            better,
            evalLine: await this.compareLine(pos, move, better, before, after),
            ignoreKey: `pattern:${soft.p.id}`,
          },
        };
      }
    }

    const analysis = {
      before: before.cp,
      after: after.cp,
      better: before.bestmove && before.bestmove !== moveToUsi(move) ? safeMove(pos, before.bestmove) : null,
      gap: second && second.mate === null && before.mate === null ? Math.max(0, clampCp(before) - clampCp(second)) : null,
      depth: before.depth,
    };
    let verdict = this.engineVerdict(pos, move, before, after);
    let afterBest: Analysis | null = null;
    if (verdict && verdict.kind === 'eval' && verdict.better) {
      // 「正解を指した後」の局面も同じ条件で評価し、その値で判定をやり直す。
      // 表示する二つの数字と反応の強さが食い違わないようにするため
      pos.apply(verdict.better);
      try {
        afterBest = await this.evalOf(pos);
      } catch {
        afterBest = null;
      } finally {
        pos.undo();
      }
      if (afterBest) verdict = this.engineVerdict(pos, move, { ...before, cp: afterBest.cp, mate: afterBest.mate }, after);
    }
    if (verdict && verdict.usedPurpose && verdict.better) {
      // 最善手の狙いを、相手の狙いを読んでから言う
      verdict.why = verdict.why.replace(PURPOSE_MARK, await this.purposeOf(pos, verdict.better, before, afterBest));
    } else if (verdict && verdict.why.includes(PURPOSE_MARK)) {
      verdict.why = verdict.why.replace(PURPOSE_MARK, describeBestPurpose(pos, verdict.better));
    }
    if (verdict) {
      verdict.evalLine = await this.compareLine(pos, move, verdict.better, before, after);
      return { ...none, verdict, analysis };
    }
    // 形の一言がなく、エンジンの読みより良かった手には「ほう」と言う（連発しない）
    if (!good && clampCp(after) - clampCp(before) >= SURPRISE_GAIN && pos.moves.length - this.lastSurprise >= SURPRISE_INTERVAL) {
      this.lastSurprise = pos.moves.length;
      return { ...none, praise: { comment: 'ほう。わしの読みより良い手じゃ。' }, analysis };
    }
    return { ...praise(), analysis };
  }

  // 「正解 ▲○○ → 形勢 +350（先手よし）」「指した ▲△△ → 形勢 -120（後手よし）」の二行。
  // 指す前の読みが浅ければ 1 行目の末尾に「（読み N 手・目安）」と添える
  private async compareLine(pos: Position, move: Move, better: Move | null, before: Analysis, after: Analysis): Promise<string> {
    const note = depthNote(before);
    const playedLine = `指した ${moveToKanji(move, 0, null, pos)} → 形勢 ${formatCp(after)}（${describeSide(after)}）`;
    if (!better) return `形勢 ${formatCp(before)} → ${formatCp(after)}（${describeSide(after)}）${note}`;
    // 正解を指したあとの局面も同じ条件で評価する（無理なら指す前の評価で代用）
    let best: Analysis = before;
    pos.apply(better);
    try {
      best = await this.evalOf(pos);
    } catch {
      best = before;
    } finally {
      pos.undo();
    }
    return `正解 ${moveToKanji(better, 0, null, pos)} → 形勢 ${formatCp(best)}（${describeSide(best)}）${note}
${playedLine}`;
  }

  // エンジンの評価値の落ち方で叱るかどうかを決める
  private engineVerdict(pos: Position, move: Move, before: Analysis, after: Analysis): Verdict | null {
    // エンジンの最善手（ヒントで示す手）を指したなら、あとで深く読んで評価が下がっても責めない
    if (before.bestmove === moveToUsi(move)) return null;
    // すでに負けている局面では、何を指しても評価が下がるので言わない
    if (clampCp(before) <= EVAL_HOPELESS) return null;
    const evalLine = `形勢 ${formatCp(before)} → ${formatCp(after)}`;
    const better = before.bestmove && before.bestmove !== moveToUsi(move) ? safeMove(pos, before.bestmove) : null;

    // 詰みを見逃した
    if (before.mate !== null && before.mate > 0 && before.mate <= MATE_MISSED_MAX && !(after.mate !== null && after.mate > 0) && better) {
      return {
        kind: 'mate-missed',
        level: 5,
        headline: '詰みを見逃すな！',
        why: `${moveToKanji(better, 0, null, pos)}から後手玉は${before.mate}手で詰んでおった。王手をかけて相手の逃げ道を全部ふさぐ、それが詰みじゃ。`,
        better,
        evalLine,
      };
    }

    // 相手の最善の応手と、その性質（取る・王手・成る）を調べる
    const wasInCheck = pos.inCheck(0);
    pos.apply(move);
    const threat = after.pv[0] ? safeMove(pos, after.pv[0]) : null;
    const threatKind = threat ? classify(pos, threat, 0) : 'other';
    pos.undo();
    const threatText = threat ? moveToKanji(threat, 1, move) : '';
    const betterText = better ? `ここは${moveToKanji(better, 0, null, pos)}じゃ。` : '';

    // 詰まされる
    if (after.mate !== null && after.mate < 0 && -after.mate <= MATE_ALLOWED_MAX && !(before.mate !== null && before.mate < 0)) {
      if (this.ignored.has('mate')) return null;
      return {
        kind: 'mate-allowed',
        level: 5,
        headline: '詰まされるぞ！',
        why: `その手では${threatText || '相手の攻め'}以下、先手玉が${-after.mate}手で詰む。自分の玉の周りに敵の駒が迫ったら、まず受けを考えるのじゃ。${betterText}`,
        better,
        evalLine,
        ignoreKey: 'mate',
      };
    }

    const level = severity(before, after);
    if (level === 1) return null;

    // 指すべきだった手（エンジンの最善）が何をする手だったか
    const missed = better ? describeMissed(pos, better, move) : null;

    // 相手の応手による損（取られる・王手される・成り込まれる）
    let consequence = '';
    const threatVictim = threat ? (() => { pos.apply(move); const v = pos.get(threat.to.x, threat.to.y); pos.undo(); return v; })() : null;
    // 相手の応手でタダ同然に取られる駒の種類（香車以上）。無ければ null
    const hangs = threatKind === 'capture' && threatVictim && PIECE_VALUE[threatVictim.type] >= HANG_THRESHOLD ? threatVictim.type : null;
    if (threat?.promote) consequence = `その手は${threatText}と成り込まれる。`;
    else if (hangs) consequence = `その手は${threatText}と取られる。`;
    else if (threatKind === 'check') consequence = `その手は${threatText}と王手されて苦しい。`;

    const degree = level === 5 ? '決定的に' : 'はっきり';
    let why: string;
    if (level === 2) {
      why = better ? `ワシなら${moveToKanji(better, 0, null, pos)}じゃ。${missed ?? ''}` : '悪くはない。';
    } else if (wasInCheck) {
      why = `王手の受け方が悪い。${consequence}${betterText}`;
    } else if (missed) {
      // 「相手の次の手」より「指すべき手を逃した」ことを先に言う
      const tail = better && missed.includes(moveToKanji(better, 0, null, pos)) ? '' : betterText;
      why = `${missed}${consequence ? `しかも${consequence}` : ''}${tail}`;
    } else if (consequence) {
      // 取られる手なら、正解を指せばその駒が助かるかも言う（正解でも取られるままなら今まで通り「ここは▲○○じゃ」）
      const rescue = hangs && better && savesFromCapture(pos, better) ? `${moveToKanji(better, 0, null, pos)}なら${PIECE_NAME[hangs]}は取られん。` : betterText;
      why = `${consequence}形勢が${degree}悪くなる。${rescue}`;
    } else {
      why = `${PURPOSE_MARK}形勢を${degree}損ねる手じゃ。`;
    }
    return {
      kind: 'eval',
      level,
      headline: LEVEL_HEADLINE[level],
      why,
      better,
      evalLine,
      usedPurpose: why.includes(PURPOSE_MARK),
    };
  }

  // エンジンが使えないときの簡易判定（駒損・一手詰め）
  private tactical(pos: Position, move: Move): Verdict | null {
    const usi = moveToUsi(move);
    const opp = (1 - pos.turn) as Color;

    const mate = findMateInOne(pos);
    if (mate && moveToUsi(mate) !== usi) {
      pos.apply(move);
      const stillMate = pos.inCheck(opp) && pos.legalMoves().length === 0;
      pos.undo();
      if (!stillMate) {
        return {
          kind: 'mate-missed',
          level: 5,
          headline: '詰みを見逃すな！',
          why: `${moveToKanji(mate, 0, null, pos)}で後手玉は詰んでおった。王手をかけて相手の逃げ道を全部ふさぐ、それが詰みじゃ。`,
          better: mate,
        };
      }
    }

    const before = bestCaptureGain(pos, opp);
    const captured = pos.get(move.to.x, move.to.y);
    const capturedValue = captured ? PIECE_VALUE[captured.type] : 0;

    pos.apply(move);
    const oppMate = findMateInOne(pos);
    const after = bestCaptureGain(pos, opp);
    pos.undo();

    if (oppMate && !this.ignored.has('mate')) {
      return {
        kind: 'mate-allowed',
        level: 5,
        headline: '詰まされるぞ！',
        why: `その手では${moveToKanji(oppMate, 1)}で先手玉が詰む。自分の玉の周りに敵の駒が迫ったら、まず受けを考えるのじゃ。`,
        better: null,
        ignoreKey: 'mate',
      };
    }

    const net = after.gain - capturedValue;
    if (after.target && net >= HANG_THRESHOLD && after.gain > before.gain) {
      const t = after.target.to;
      const victimType = after.victim!;
      const key = `hang:${t.x},${t.y}:${victimType}`;
      if (this.ignored.has(key)) return null;
      const moved = move.to.x === t.x && move.to.y === t.y;
      const name = `${sqToKanji(t)}の${PIECE_NAME[victimType]}`;
      const why = moved
        ? `${name}は${moveToKanji(after.target, 1)}とタダで取られる。駒を動かす前に、その場所に相手の利きがないか必ず確かめるのじゃ。`
        : `${name}が${moveToKanji(after.target, 1)}と取られてしまう。その手で守りが外れたのが分かるか。動かす前に、残された駒が大丈夫か見るのじゃ。`;
      return { kind: 'blunder', level: net >= 8 ? 5 : 4, headline: '駒を取られるぞ！', why, better: null, ignoreKey: key };
    }

    return null;
  }
}

// 手の性質: 駒を取る / 王手 / 成る / その他。pos はその手を指す直前の局面
function classify(pos: Position, m: Move, defender: Color): 'capture' | 'check' | 'promote' | 'other' {
  if (pos.get(m.to.x, m.to.y)) return 'capture';
  pos.apply(m);
  const check = pos.inCheck(defender);
  pos.undo();
  if (check) return 'check';
  if (m.promote) return 'promote';
  return 'other';
}

// 手の性質: 攻め（相手玉に向かう・取る・王手・成る）か、受け（自陣・自玉のそばへ）か
export function moveNature(pos: Position, m: Move): 'attack' | 'defend' | 'other' {
  const kind = classify(pos, m, 1);
  const victim = pos.get(m.to.x, m.to.y);
  // 歩を取るだけの手は「攻め」とは呼ばない（歩の取り合いは方針の話ではない）
  if (kind === 'capture' && victim && PIECE_VALUE[victim.type] >= HANG_THRESHOLD) return 'attack';
  if (kind === 'check' || kind === 'promote') return 'attack';
  const gk = pos.findKing(1);
  const sk = pos.findKing(0);
  const nearGote = gk ? Math.max(Math.abs(m.to.x - gk.x), Math.abs(m.to.y - gk.y)) <= 2 : false;
  const nearSente = sk ? Math.max(Math.abs(m.to.x - sk.x), Math.abs(m.to.y - sk.y)) <= 2 : false;
  if (nearGote || m.to.y <= 2 || (m.to.y <= 4 && m.piece !== 'FU')) return 'attack';
  if (m.to.y >= 6 && (nearSente || m.from === null || (m.from && m.to.y > m.from.y))) return 'defend';
  return 'other';
}

// 指すべきだった手（best）が何をする手だったかを説明する。説明できなければ null
function describeMissed(pos: Position, best: Move, played: Move): string | null {
  const bestText = moveToKanji(best, 0, null, pos);
  // 同じ手で成らなかった
  if (best.from && played.from && best.from.x === played.from.x && best.from.y === played.from.y
    && best.to.x === played.to.x && best.to.y === played.to.y && best.promote && !played.promote) {
    return `成らない手はない。${bestText}と成るべきじゃ。`;
  }
  // まず「取れた駒」「厳しい王手」のような具体的な見逃し（歩は取れても大した話ではないので言わない）
  const victim = pos.get(best.to.x, best.to.y);
  const playedKind = classify(pos, played, 1);
  if (victim && victim.color === 1 && victim.type !== 'FU' && playedKind !== 'capture') {
    return `${bestText}で${PIECE_NAME[victim.type]}が取れた。`;
  }
  if (classify(pos, best, 1) === 'check' && playedKind !== 'check') {
    return `${bestText}の王手が厳しかった。`;
  }
  // 攻めるべきところで受けた、受けるべきところで攻めた
  const bestNature = moveNature(pos, best);
  const playedNature = moveNature(pos, played);
  if (bestNature === 'attack' && playedNature === 'defend') {
    return `受けている場合ではない。${bestText}と攻める方が速い。`;
  }
  if (bestNature === 'defend' && playedNature === 'attack') {
    return `攻めている場合ではない。${bestText}と受けるのが先じゃ。`;
  }
  // 取られそうな駒を、最善手なら救えていた
  const hanging = bestCaptureGain(pos, 1);
  if (hanging.gain >= HANG_THRESHOLD && hanging.target) {
    pos.apply(best);
    const afterBest = bestCaptureGain(pos, 1).gain;
    pos.undo();
    pos.apply(played);
    const afterPlayed = bestCaptureGain(pos, 1).gain;
    pos.undo();
    if (afterBest < hanging.gain && afterPlayed >= hanging.gain) {
      const t = hanging.target.to;
      return `${sqToKanji(t)}の${PIECE_NAME[hanging.victim!]}が取られそうじゃった。${bestText}と手当てすべき。`;
    }
  }
  return null;
}

// 最善手の狙いを、盤の形から短く言う（「その手は緩い」の代わり）
function describeBestPurpose(pos: Position, best: Move | null): string {
  if (!best) return 'その手は緩い。';
  const text = moveToKanji(best, 0, null, pos);
  const nature = moveNature(pos, best);
  const sk = pos.findKing(0);
  const gk = pos.findKing(1);
  if (best.piece === 'OU') return `ここは${text}と玉を安全な所へ動かす手じゃ。`;
  if (best.from === null) {
    const nearGote = gk ? Math.max(Math.abs(best.to.x - gk.x), Math.abs(best.to.y - gk.y)) <= 2 : false;
    return nearGote ? `ここは${text}と相手の玉に迫る手じゃ。` : `ここは${text}と持ち駒を働かせる手じゃ。`;
  }
  if (nature === 'attack') return `ここは${text}と攻める手じゃ。`;
  if (nature === 'defend') {
    // 「守りを固める」と言えるのは玉に接する駒だけ。離れた自陣の手は「隙を消す」
    const adjacent = sk ? Math.max(Math.abs(best.to.x - sk.x), Math.abs(best.to.y - sk.y)) <= 1 : false;
    if (adjacent) return `ここは${text}と玉の守りを固める手じゃ。`;
    return best.to.y >= 6 ? `ここは${text}と自陣の隙を消す手じゃ。` : `ここは${text}と受ける手じゃ。`;
  }
  // 初期位置から動かしていない駒を働かせる
  const home = best.from.y >= 6;
  return home ? `ここは${text}と駒を働かせる手じゃ。` : `ここは${text}じゃ。`;
}

// USI 文字列を Move にする。盤と合わなければ null
export function safeMove(pos: Position, usi: string): Move | null {
  try {
    const m = usiToMove(pos, usi);
    return pos.legalMoves().some((l) => moveToUsi(l) === usi) ? m : null;
  } catch {
    return null;
  }
}
