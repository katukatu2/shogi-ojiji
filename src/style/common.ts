// 戦法をまたいで使う部品: 盤面を見る小道具と、どの戦法でも共通の「よくある仕掛けへの受け」

import { Position } from '../engine/position';
import { Reaction } from './types';

// 盤の座標: x は 0..8（９筋→１筋）、y は 0..8（一段→九段）
export const at = (pos: Position, x: number, y: number, color: 0 | 1, types: string[]): boolean => {
  const p = pos.get(x, y);
  return !!p && p.color === color && types.includes(p.type);
};
export const empty = (pos: Position, x: number, y: number): boolean => pos.get(x, y) === null;

// ▲２五歩などで２四を狙われたら△３三角（無理なら３三に銀）
export const REACT_ROOK_FILE: Reaction = {
  id: 'rook-file',
  when: (pos) =>
    (at(pos, 7, 4, 0, ['FU', 'GI']) || at(pos, 6, 4, 0, ['GI'])) &&
    at(pos, 7, 2, 1, ['FU']) &&
    empty(pos, 6, 2),
  moves: ['KA:2b3c', 'GI:4b3c', 'GI:2b3c', 'GI:3a4b'],
};

// 角道が通っていて角交換を狙われそうなら、先に△４四歩
export const REACT_CLOSE_DIAGONAL: Reaction = {
  id: 'close-bishop-diagonal',
  when: (pos) =>
    at(pos, 1, 7, 0, ['KA']) && at(pos, 7, 1, 1, ['KA']) &&
    empty(pos, 2, 6) && empty(pos, 3, 5) && empty(pos, 4, 4) && empty(pos, 5, 3) && empty(pos, 6, 2) &&
    at(pos, 5, 2, 1, ['FU']),
  moves: ['FU:4c4d'],
};

// ▲９六歩・▲１六歩には端歩を受けて位を取らせない
export const REACT_EDGE_9: Reaction = {
  id: 'edge-9',
  when: (pos) => at(pos, 0, 5, 0, ['FU']) && at(pos, 0, 2, 1, ['FU']) && empty(pos, 0, 3),
  moves: ['FU:9c9d'],
};
export const REACT_EDGE_1: Reaction = {
  id: 'edge-1',
  when: (pos) => at(pos, 8, 5, 0, ['FU']) && at(pos, 8, 2, 1, ['FU']) && empty(pos, 8, 3),
  moves: ['FU:1c1d'],
};

// ▲３五歩と突かれたら３三に銀か角を用意しておく
export const REACT_THIRD_FILE: Reaction = {
  id: 'third-file',
  when: (pos) => at(pos, 6, 4, 0, ['FU']) && at(pos, 6, 3, 1, ['FU']) && empty(pos, 6, 2),
  moves: ['GI:4b3c', 'KA:2b3c', 'GI:2b3c', 'GI:3a4b'],
};

export const COMMON_REACTIONS: Reaction[] = [REACT_ROOK_FILE, REACT_CLOSE_DIAGONAL, REACT_EDGE_9, REACT_EDGE_1, REACT_THIRD_FILE];
