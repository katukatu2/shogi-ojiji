import { Position } from '../engine/position';
import { Move, PIECE_VALUE, PieceType, PIECE_KANJI, PIECE_NAME, Color, Sq } from '../engine/types';
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
  evalLine?: string; // 候補と指した手の形勢を、点数ではなく言葉で比べる
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

// 判定機の記憶（待ったで戻すときに控える）
export interface JudgeState {
  fired: string[];
  ignored: string[];
  lastSurprise: number;
}

export interface Judgement {
  verdict: Verdict | null;
  praise: Praise | null;
  // 振り返り用: 指す前と指した後の評価（先手視点）。エンジンが無いときは null。
  // before は「正解を指した後」を読み直したらその値に揃える（振り返りの二つの数字と反応の強さを食い違わせない）。
  // gap は指す前の局面での最善手と次善手の評価の差（正の値。次善が読めなければ null）。「決め手」の判定に使う。
  // depth は指す前の探索の深さ（検証用の記録。信頼度としては表示しない）。
  // playedBest は指した手がエンジンの最善手だったか（対局中に叱らないのと同じ手を、振り返りでも間違い扱いにしないため）
  analysis?: { before: number; after: number; better: Move | null; gap: number | null; depth: number; playedBest: boolean };
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
const EVAL_CLAMP = 3000;

// 落ち幅と、落ちた結果の形勢から段階を決める（1 は反応なし）
export function severity(before: Analysis, after: Analysis): 1 | Level {
  const b = clampCp(before);
  const a = clampCp(after);
  const drop = b - a;
  // 勝っているうちは責めない。ただし大きく落とした手を「良い手じゃな」とは呼ばない（段階 3 止まり。カットインは出ない）
  if (a >= STILL_GOOD) return drop >= EVAL_DROP ? 3 : drop >= LEVEL2_DROP ? 2 : 1;
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

export const ANALYZE_MS = 400;

// 相手の取りに対し、実際の合法手で取り返せるかを見る（王手や釘付けも考慮）。
function captureExchange(pos: Position, move: Move): { gain: number; recapturable: boolean } {
  const victim = pos.get(move.to.x, move.to.y);
  if (!victim) return { gain: 0, recapturable: false };
  pos.apply(move);
  try {
    const recapturable = pos.legalMoves().some((reply) => reply.from !== null
      && reply.to.x === move.to.x && reply.to.y === move.to.y);
    return { gain: PIECE_VALUE[victim.type] - (recapturable ? PIECE_VALUE[move.piece] : 0), recapturable };
  } finally { pos.undo(); }
}

// by 側が今すぐ取れる駒のうち、いちばん得な取り方の得点を返す
export function bestCaptureGain(pos: Position, by: Color): { gain: number; target: Move | null; victim: PieceType | null } {
  const saved = pos.turn;
  pos.turn = by;
  let best = { gain: 0, target: null as Move | null, victim: null as PieceType | null };
  for (const m of pos.legalMoves()) {
    const victim = pos.get(m.to.x, m.to.y);
    if (!victim || victim.type === 'OU') continue;
    const { gain } = captureExchange(pos, m);
    if (gain > best.gain) best = { gain, target: m, victim: victim.type };
  }
  pos.turn = saved;
  return best;
}

// 形勢を言葉にする（先手視点）
export function describeSide(a: Pick<Analysis, 'cp' | 'mate'>): string {
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

// 正解 better を指したあと、後手にタダ同然（香車以上の得）で取れる駒が残らないか
function savesFromCapture(pos: Position, better: Move): boolean {
  pos.apply(better);
  try {
    return bestCaptureGain(pos, 1).gain < HANG_THRESHOLD;
  } finally {
    pos.undo();
  }
}

// 取られそうだった駒が、指す前の局面のどこにいたか。
// 相手の応手の取り先が指した手の行き先と同じなら「今動かした駒」なので、その出発点（打った駒なら盤にいない）
function victimSquare(move: Move, threatTo: Sq): Sq | null {
  return move.to.x === threatTo.x && move.to.y === threatTo.y ? move.from : threatTo;
}

// 正解 better を指したあと、その駒（sq にいる先手の駒）を取る合法手が後手に残るか。
// タダで取られはしなくても取り自体は残る、というときに「タダでは取られん」と言うために使う
function stillCapturable(pos: Position, better: Move, sq: Sq | null): boolean {
  if (!sq) return false;
  pos.apply(better);
  try {
    const at = better.from && better.from.x === sq.x && better.from.y === sq.y ? better.to : sq; // 正解がその駒を動かしたなら移った先を見る
    const piece = pos.get(at.x, at.y);
    if (!piece || piece.color !== 0) return false;
    const saved = pos.turn;
    pos.turn = 1;
    const can = pos.legalMoves().some((m) => m.to.x === at.x && m.to.y === at.y);
    pos.turn = saved;
    return can;
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

  // 「一局に一度だけ」の記録を控える／戻す（待ったで局面を戻したときに、判定の記憶も戻すため）
  snapshot(): JudgeState {
    return { fired: [...this.fired], ignored: [...this.ignored], lastSurprise: this.lastSurprise };
  }

  restore(state: JudgeState): void {
    this.fired = new Set(state.fired);
    this.ignored = new Set(state.ignored);
    this.lastSurprise = state.lastSurprise;
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

  // 最善手の狙いを言う。相手の狙い（手番を渡したときの最善）があり、最善手を指すとその狙いの手が指せなくなるなら「○○を防ぐ手」。
  // 「防ぐ」と言えるのは狙いの手が非合法になるときだけ。相手の応手が変わっただけでは、その手を防いだ根拠にならない
  private async purposeOf(pos: Position, best: Move, before: Analysis): Promise<string> {
    if (moveNature(pos, best) !== 'attack') {
      const threat = await this.threatOf(pos);
      if (threat && clampCp(threat.analysis) <= clampCp(before) - THREAT_DROP) {
        const usi = moveToUsi(threat.move);
        pos.apply(best);
        const stillLegal = safeMove(pos, usi) !== null;
        pos.undo();
        if (!stillLegal) {
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
      const better = before.bestmove ? safeMove(pos, before.bestmove) : null;
      // 講釈（「玉の前の歩は最後の盾じゃ」など）は、正解が受けの手のときだけ。
      // 落ち幅の理由が形と無関係（正解が攻めの手）なら、普通の説明に落とす
      if (drop >= soft.p.minDrop! && better && moveNature(pos, better) === 'defend') {
        this.fired.add(soft.p.id);
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
      playedBest: before.bestmove === moveToUsi(move),
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
      if (afterBest) {
        verdict = this.engineVerdict(pos, move, { ...before, cp: afterBest.cp, mate: afterBest.mate }, after, afterBest.cp);
        // 振り返りの数字も読み直した値に揃える（正解の実力はこの値）
        analysis.before = afterBest.cp;
        // 読み直して叱るのをやめた（正解の方が悪かった）手は、振り返りでも勧めない
        if (!verdict) analysis.better = null;
      }
    }
    if (verdict && verdict.usedPurpose && verdict.better) {
      // 最善手の狙いを、相手の狙いを読んでから言う
      verdict.why = verdict.why.replace(PURPOSE_MARK, await this.purposeOf(pos, verdict.better, before));
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

  // 探索の深さは評価の安定性を保証しない。どの深さでも、候補と指した手を「形勢の目安」として比べる。
  private async compareLine(pos: Position, move: Move, better: Move | null, before: Analysis, after: Analysis): Promise<string> {
    const playedLine = `指した ${moveToKanji(move, 0, null, pos)} → ${describeSide(after)}`;
    if (!better) return `形勢の目安: ${describeSide(before)} → ${describeSide(after)}`;
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
    return `形勢の目安
候補 ${moveToKanji(better, 0, null, pos)} → ${describeSide(best)}
${playedLine}`;
  }

  // エンジンの評価値の落ち方で叱るかどうかを決める。
  // afterBestCp は「正解を指した後」の評価（読み直したときだけ渡る）。攻めが速いと言い切ってよいかの判断に使う
  private engineVerdict(pos: Position, move: Move, before: Analysis, after: Analysis, afterBestCp: number | null = null): Verdict | null {
    // エンジンの最善手（ヒントで示す手）を指したなら、あとで深く読んで評価が下がっても責めない
    if (before.bestmove === moveToUsi(move)) return null;
    // すでに負けている局面では、何を指しても評価が下がるので言わない
    if (clampCp(before) <= EVAL_HOPELESS) return null;
    const evalLine = `形勢の目安: ${describeSide(before)} → ${describeSide(after)}`;
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

    // 相手の最善の応手と、その性質（取る・王手・成る）、その手で取られる駒を調べる
    const wasInCheck = pos.inCheck(0);
    pos.apply(move);
    const threat = after.pv[0] ? safeMove(pos, after.pv[0]) : null;
    const threatKind = threat ? classify(pos, threat, 0) : 'other';
    const threatVictim = threat ? pos.get(threat.to.x, threat.to.y) : null;
    const exchange = threat && threatVictim ? captureExchange(pos, threat) : null;
    const threatText = threat ? moveToKanji(threat, 1, move, pos) : '';
    pos.undo();
    const playedText = moveToKanji(move, 0, null, pos);
    const replyToPlayed = `指した${playedText}には、`;
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
    const missed = better ? describeMissed(pos, better, move, afterBestCp) : null;

    // 相手の応手による損（取られる・取り返される・王手される・成り込まれる）
    let consequence = '';
    // 相手の応手でタダ同然に取られる駒の種類（香車以上）。無ければ null
    const hangs = threatKind === 'capture' && threatVictim && PIECE_VALUE[threatVictim.type] >= HANG_THRESHOLD ? threatVictim.type : null;
    // 逃した手の説明で「○○が取られそうじゃった」と言った駒への取りなら、同じ事件を二度言わない
    const retold = !!(missed?.rescued && threat && missed.rescued.x === threat.to.x && missed.rescued.y === threat.to.y);
    const taken = pos.get(move.to.x, move.to.y); // 指した手が取った駒
    const gained = taken && taken.color === 1 ? PIECE_VALUE[taken.type] : 0;
    // 指した手の行き先をそのまま取り返されたか（「△同歩」の形か）
    const retaken = !!(threat && threat.to.x === move.to.x && threat.to.y === move.to.y);
    if (hangs && !retold) {
      if (exchange?.recapturable && exchange.gain <= 0 && threat) {
        consequence = exchange.gain === 0
          ? `${replyToPlayed}${threatText}の応手がある。取り返せば${tradeName(threat.piece, hangs)}になる。`
          : `${replyToPlayed}${threatText}の応手がある。取り返せるので一方的な駒損ではないが、交換後の形勢まで読む必要がある。`;
      } else if (!taken || gained < PIECE_VALUE[hangs]) consequence = `${replyToPlayed}${threatText}で${PIECE_NAME[hangs]}を取られる。`;
      else {
        // 同等以上の駒を取った後の取られ方は「駒損」ではなく「交換」
        const trade = tradeName(taken.type, hangs);
        consequence = retaken
          ? `${replyToPlayed}${threatText}で取り返されて${trade}になる。`
          : `${replyToPlayed}${threatText}で${PIECE_NAME[hangs]}を取られ、${trade}になる。`;
      }
    } else if (threat?.promote && !retold) consequence = `${replyToPlayed}${threatText}で成り込まれる。`;
    else if (threatKind === 'check') consequence = `${replyToPlayed}${threatText}で王手されて苦しい。`;

    const degree = level === 5 ? '決定的に' : 'はっきり';
    let why: string;
    if (level === 2) {
      why = better ? `ワシなら${moveToKanji(better, 0, null, pos)}じゃ。${missed?.text ?? ''}` : '悪くはない。';
    } else if (wasInCheck) {
      why = `王手の受け方が悪い。${consequence}${betterText}`;
    } else if (missed) {
      // 「相手の次の手」より「指すべき手を逃した」ことを先に言う
      const tail = better && missed.text.includes(moveToKanji(better, 0, null, pos)) ? '' : betterText;
      why = `${missed.text}${consequence}${tail}`;
    } else if (consequence) {
      // 取られる手なら、正解を指せばその駒が助かるかも言う（正解でも取られるままなら今まで通り「ここは▲○○じゃ」）
      const rescue = hangs && better && threat && exchange && exchange.gain >= HANG_THRESHOLD
        ? rescueText(pos, better, move, threat.to, hangs) : '';
      why = `${consequence}形勢が${degree}悪くなる。${rescue || betterText}`;
    } else {
      why = `その手は形勢を${degree}損ねる。${PURPOSE_MARK}`;
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
    const mateText = oppMate ? moveToKanji(oppMate, opp, move, pos) : '';
    const captureText = after.target ? moveToKanji(after.target, opp, move, pos) : '';
    pos.undo();

    if (oppMate && !this.ignored.has('mate')) {
      return {
        kind: 'mate-allowed',
        level: 5,
        headline: '詰まされるぞ！',
        why: `その手では${mateText}で先手玉が詰む。自分の玉の周りに敵の駒が迫ったら、まず受けを考えるのじゃ。`,
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
        ? `${name}は${captureText}でタダで取られる。駒を動かす前に、その場所に相手の利きがないか必ず確かめるのじゃ。`
        : `${name}が${captureText}で取られてしまう。その手で守りが外れたのが分かるか。動かす前に、残された駒が大丈夫か見るのじゃ。`;
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

// 「角銀交換」のような駒の交換の呼び名（取った駒・取られる駒の順。同じ種類なら「歩の交換」）
function tradeName(gainedType: PieceType, lostType: PieceType): string {
  if (gainedType === lostType) return `${PIECE_NAME[gainedType]}の交換`;
  return `${PIECE_NAME[gainedType]}${PIECE_NAME[lostType]}交換`;
}

// 正解を指せば、取られそうだった駒がどうなるかを言う。
// 取り自体が残るなら「タダでは取られん」（取られないと言い切らない）。正解でも取られるままなら「ここは▲○○じゃ」
function rescueText(pos: Position, better: Move, played: Move, threatTo: Sq, hangs: PieceType): string {
  const bestText = moveToKanji(better, 0, null, pos);
  if (!savesFromCapture(pos, better)) return `ここは${bestText}じゃ。`;
  const safe = stillCapturable(pos, better, victimSquare(played, threatTo)) ? 'タダでは取られん' : '取られん';
  return `${bestText}なら${PIECE_NAME[hangs]}は${safe}。`;
}

// 指すべきだった手（best）が何をする手だったかの説明。説明できなければ null。
// rescued は「○○が取られそうじゃった」と言った駒の位置（相手の応手の説明で同じ事件を繰り返さないために返す）
interface Missed {
  text: string;
  rescued: Sq | null;
}

// afterBestCp は正解を指した後の評価（分からなければ null）
function describeMissed(pos: Position, best: Move, played: Move, afterBestCp: number | null): Missed | null {
  const bestText = moveToKanji(best, 0, null, pos);
  const plain = (text: string): Missed => ({ text, rescued: null });
  // 同じ手で成らなかった
  if (best.from && played.from && best.from.x === played.from.x && best.from.y === played.from.y
    && best.to.x === played.to.x && best.to.y === played.to.y && best.promote && !played.promote) {
    return plain(`成らない手はない。${bestText}と成るべきじゃ。`);
  }
  // まず「取れた駒」「厳しい王手」のような具体的な見逃し（歩は取れても大した話ではないので言わない）
  const victim = pos.get(best.to.x, best.to.y);
  const playedKind = classify(pos, played, 1);
  if (victim && victim.color === 1 && victim.type !== 'FU' && playedKind !== 'capture') {
    return plain(`${bestText}で${PIECE_NAME[victim.type]}が取れた。`);
  }
  if (classify(pos, best, 1) === 'check' && playedKind !== 'check') {
    return plain(`${bestText}の王手が厳しかった。`);
  }
  // 取られそうな駒を、最善手なら救えていた。
  // 攻め・受けの分岐より先に見る（飛車を逃がす手を「受け」と呼ぶと、何をすべきだったかが伝わらない）
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
      return { text: `${sqToKanji(t)}の${PIECE_NAME[hanging.victim!]}が取られそうじゃった。${bestText}と手当てすべき。`, rescued: { ...t } };
    }
  }
  // 攻めるべきところで受けた、受けるべきところで攻めた
  const bestNature = moveNature(pos, best);
  const playedNature = moveNature(pos, played);
  if (bestNature === 'attack' && playedNature === 'defend') {
    // 「攻める方が速い」と言えるのは、正解を指した後も先手が悪くないときだけ
    const winning = afterBestCp !== null && afterBestCp >= 0;
    return plain(`受けている場合ではない。${bestText}${winning ? 'と攻める方が速い' : 'の方がまだ良い'}。`);
  }
  if (bestNature === 'defend' && playedNature === 'attack') {
    return plain(`攻めている場合ではない。${bestText}と受けるのが先じゃ。`);
  }
  return null;
}

// 最善手の狙いを、盤の形から短く言う（「その手は緩い」の代わり）
function describeBestPurpose(pos: Position, best: Move | null): string {
  if (!best) return ''; // 正解が分からないなら狙いも言わない（「形勢を損ねる」の一文だけにする）
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
