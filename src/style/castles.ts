import { Position } from '../engine/position';
import { PieceType } from '../engine/types';

function goteAt(pos: Position, file: number, rank: number, type: PieceType): boolean {
  const piece = pos.get(9 - file, rank - 1);
  return piece?.color === 1 && piece.type === type;
}

// 基本形が揃ったときだけ「完成」と呼ぶ。手順の通過では判定しない。
export function goteMinoComplete(pos: Position): boolean {
  return goteAt(pos, 8, 2, 'OU') && goteAt(pos, 7, 2, 'GI') &&
    goteAt(pos, 6, 1, 'KI') && goteAt(pos, 5, 2, 'KI') && !pos.inCheck(1);
}

export function goteYaguraGuards(pos: Position): boolean {
  return goteAt(pos, 3, 3, 'GI') && goteAt(pos, 3, 2, 'KI') && goteAt(pos, 4, 3, 'KI');
}

export function goteYaguraComplete(pos: Position): boolean {
  return goteAt(pos, 2, 2, 'OU') && goteYaguraGuards(pos) && !pos.inCheck(1);
}
