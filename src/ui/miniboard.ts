// 振り返り用の小さな盤面。対局画面の盤と同じ見た目で、操作はできない。

import { Position } from '../engine/position';
import { Move, PIECE_KANJI } from '../engine/types';
import { usiToMove } from '../engine/notation';

const PROMOTED = new Set(['TO', 'NY', 'NK', 'NG', 'UM', 'RY']);

// 手順（USI）から局面を復元する。次に指す手をハイライトする
export function positionAfter(moves: string[]): Position {
  const pos = Position.initial();
  for (const u of moves) pos.apply(usiToMove(pos, u));
  return pos;
}

export function miniBoard(pos: Position, highlight?: Move | null, mark?: Move | null): HTMLElement {
  const board = document.createElement('div');
  board.className = 'mini-board';
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const p = pos.get(x, y);
      if (p) {
        const pe = document.createElement('div');
        pe.className = 'piece' + (p.color === 1 ? ' gote' : '') + (PROMOTED.has(p.type) ? ' promoted' : '');
        pe.textContent = PIECE_KANJI[p.type];
        cell.append(pe);
      }
      if (highlight && ((highlight.from && highlight.from.x === x && highlight.from.y === y) || (highlight.to.x === x && highlight.to.y === y))) {
        cell.classList.add('last');
      }
      if (mark && ((mark.from && mark.from.x === x && mark.from.y === y) || (mark.to.x === x && mark.to.y === y))) {
        cell.classList.add('hint');
      }
      board.append(cell);
    }
  }
  return board;
}
