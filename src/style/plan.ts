// オジジの駒組み。戦法の plan（優先順の手）を、合法で損のない範囲で上から順に指す。

import { Position } from '../engine/position';
import { Move } from '../engine/types';
import { moveToUsi } from '../engine/notation';
import { Analysis, Evaluator } from '../ai/engine';
import { bestCaptureGain } from './judge';
import { Reaction } from './types';

// plan の手と盤上の手を対応づけるキー（「駒種:USI」）
export function planKey(m: Move): string {
  return `${m.piece}:${moveToUsi(m)}`;
}

export const PLAN_MAX_MOVES = 50; // これ以降はエンジンに任せる
export const PLAN_TOLERANCE = 80; // 最善よりこの点数以内なら駒組みを優先する（大きいと相手の仕掛けを放置しがち）
const PLAN_CANDIDATES = 3; // 一手ごとに試す候補の数（時間を抑える）
const PLAN_ANALYZE_MS = 250;

export interface PlanState {
  done: Set<string>;
}

// 候補の手を優先順に返す（合法で、まだ指していないもの）
export function planCandidates(pos: Position, plan: string[], state: PlanState): Move[] {
  const legal = pos.legalMoves();
  const out: Move[] = [];
  for (const entry of plan) {
    if (state.done.has(entry)) continue;
    const m = legal.find((l) => planKey(l) === entry);
    if (m) out.push(m);
  }
  return out;
}

// 駒組みを続けてよい局面か（王手、タダで取れる駒がある、終盤などは AI に任せる）
export function planApplies(pos: Position): boolean {
  if (pos.moves.length > PLAN_MAX_MOVES) return false;
  if (pos.inCheck(1)) return false;
  if (bestCaptureGain(pos, 1).gain >= 3) return false;
  return true;
}

export interface PlanOptions {
  evaluator: Evaluator | null;
  current?: Analysis; // 現局面の評価が分かっていれば渡す（後手番、先手視点の値）
  analyzeMs?: number;
  reactions?: Reaction[]; // 条件が合えば駒組みより先に試す受け
  tolerance?: number; // 最善より何点まで損しても駒組みを続けるか
}

// 条件の合う受けの手を、優先順に返す（合法でまだ指していないもの）
export function reactionCandidates(pos: Position, reactions: Reaction[], state: PlanState): { move: Move; tolerance?: number }[] {
  const legal = pos.legalMoves();
  const out: { move: Move; tolerance?: number }[] = [];
  for (const r of reactions) {
    if (!r.when(pos)) continue;
    for (const entry of r.moves) {
      if (state.done.has(entry)) continue;
      const m = legal.find((l) => planKey(l) === entry);
      if (m && !out.some((o) => planKey(o.move) === entry)) out.push({ move: m, tolerance: r.tolerance });
    }
  }
  return out;
}

// エンジンが使えるとき: 最善と比べて損が小さい駒組みの手を選ぶ
export async function choosePlanMove(
  pos: Position,
  plan: string[],
  state: PlanState,
  opts: PlanOptions,
): Promise<Move | null> {
  const evaluator = opts.evaluator;
  const current = opts.current;
  const analyzeMs = opts.analyzeMs ?? PLAN_ANALYZE_MS;
  const tolerance = opts.tolerance ?? PLAN_TOLERANCE;
  if (!planApplies(pos)) return null;
  // 相手の仕掛けへの受けを先に、そのあと駒組み
  const reacts = reactionCandidates(pos, opts.reactions ?? [], state);
  const plain = planCandidates(pos, plan, state)
    .filter((m) => !reacts.some((r) => planKey(r.move) === planKey(m)))
    .map((m) => ({ move: m, tolerance: undefined as number | undefined }));
  const cands = [...reacts, ...plain].slice(0, PLAN_CANDIDATES);
  if (cands.length === 0) return null;

  if (!evaluator) {
    // エンジンなし: 駒を取られない手なら指す
    for (const { move: m } of cands) {
      pos.apply(m);
      const loss = bestCaptureGain(pos, 0).gain;
      pos.undo();
      if (loss < 3) {
        state.done.add(planKey(m));
        return m;
      }
    }
    return null;
  }

  const moves = pos.moves.map(moveToUsi);
  const base = current ?? (await evaluator.analyze(moves, { movetime: analyzeMs }));
  const goteBest = -base.cp;
  for (const c of cands) {
    const after = await evaluator.analyze([...moves, moveToUsi(c.move)], { movetime: analyzeMs });
    const goteAfter = -after.cp;
    if (goteBest - goteAfter <= (c.tolerance ?? tolerance)) {
      state.done.add(planKey(c.move));
      return c.move;
    }
  }
  return null;
}
