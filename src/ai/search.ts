import { Position } from '../engine/position';
import { Color, Move, PIECE_VALUE, HandPiece, PieceType } from '../engine/types';

// 材料点 + 簡単な位置評価。先手プラス。
function evaluate(pos: Position): number {
  let score = 0;
  for (let i = 0; i < 81; i++) {
    const c = pos.board[i];
    if (!c) continue;
    const v = PIECE_VALUE[c.type];
    const y = Math.floor(i / 9);
    const x = i % 9;
    let s = v;
    if (c.type !== 'OU') {
      // 前進していると少し加点（自陣から見た進み具合）
      const adv = c.color === 0 ? 8 - y : y;
      s += adv * 0.03;
    } else {
      // 玉は端寄り・自陣奥にいると安全
      const home = c.color === 0 ? y >= 7 : y <= 1;
      const center = x >= 3 && x <= 5;
      if (home) s += 0.6;
      if (center) {
        s -= 0.8; // 中央に居座る玉は的になる
      } else {
        s += 0.3;
        // 端に寄った玉は、周囲の味方駒で守り具合を評価
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue;
            if (!Position.inside(x + dx, y + dy)) continue;
            const n = pos.get(x + dx, y + dy);
            if (n && n.color === c.color && n.type !== 'OU') s += 0.15;
          }
        }
      }
    }
    score += c.color === 0 ? s : -s;
  }
  for (const color of [0, 1] as Color[]) {
    const h = pos.hands[color];
    let s = 0;
    for (const k of Object.keys(h) as HandPiece[]) s += h[k] * (PIECE_VALUE[k] + 0.3);
    score += color === 0 ? s : -s;
  }
  return score;
}

function isCapture(pos: Position, m: Move): boolean {
  return pos.get(m.to.x, m.to.y) !== null;
}

function orderMoves(pos: Position, moves: Move[]): Move[] {
  return moves
    .map((m) => {
      const t = pos.get(m.to.x, m.to.y);
      let s = t ? PIECE_VALUE[t.type] * 10 - PIECE_VALUE[m.piece as PieceType] : 0;
      if (m.promote) s += 5;
      if (!m.from) s -= 2;
      return { m, s };
    })
    .sort((a, b) => b.s - a.s)
    .map((e) => e.m);
}

// 手番側から見た点（負最大法）
function negamax(pos: Position, depth: number, alpha: number, beta: number, deadline: number): number {
  const sign = pos.turn === 0 ? 1 : -1;
  const moves = pos.legalMoves();
  if (moves.length === 0) return -100000; // 詰まされている
  if (depth <= 0) return quiesce(pos, alpha, beta, 2);
  let best = -Infinity;
  for (const m of orderMoves(pos, moves)) {
    pos.apply(m);
    const v = -negamax(pos, depth - 1, -beta, -alpha, deadline);
    pos.undo();
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (Date.now() > deadline) break;
  }
  return best === -Infinity ? sign * evaluate(pos) : best;
}

// 取り合いだけ読み続ける静止探索
function quiesce(pos: Position, alpha: number, beta: number, depth: number): number {
  const sign = pos.turn === 0 ? 1 : -1;
  const stand = sign * evaluate(pos);
  if (depth <= 0) return stand;
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const captures = pos.legalMoves().filter((m) => isCapture(pos, m));
  for (const m of orderMoves(pos, captures)) {
    pos.apply(m);
    const v = -quiesce(pos, -beta, -alpha, depth - 1);
    pos.undo();
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

export interface SearchOptions {
  depth?: number;
  timeMs?: number;
  noise?: number; // 手のばらつき（点）
}

export function chooseMove(pos: Position, opts: SearchOptions = {}): Move | null {
  const depth = opts.depth ?? 2;
  const noise = opts.noise ?? 0.4;
  const deadline = Date.now() + (opts.timeMs ?? 1500);
  const moves = pos.legalMoves();
  if (moves.length === 0) return null;
  let best: Move | null = null;
  let bestScore = -Infinity;
  for (const m of orderMoves(pos, moves)) {
    pos.apply(m);
    let v = -negamax(pos, depth - 1, -Infinity, Infinity, deadline);
    pos.undo();
    v += (Math.random() - 0.5) * noise;
    if (v > bestScore) {
      bestScore = v;
      best = m;
    }
    if (Date.now() > deadline) break;
  }
  return best;
}

// 一手詰めがあればその手を返す
export function findMateInOne(pos: Position): Move | null {
  const opp = (1 - pos.turn) as Color;
  for (const m of pos.legalMoves()) {
    pos.apply(m);
    const mate = pos.inCheck(opp) && pos.legalMoves().length === 0;
    pos.undo();
    if (mate) return m;
  }
  return null;
}

export { evaluate };
