// 盤面の座標系: x は 0..8 (左→右 = 9筋→1筋)、y は 0..8 (上→下 = 一段→九段)。
// 先手は下側 (y=8 側) に陣を構え、上 (y が減る方向) へ進む。

export type Color = 0 | 1; // 0 = 先手(プレイヤー), 1 = 後手(オジジ)

export type PieceType =
  | 'FU' | 'KY' | 'KE' | 'GI' | 'KI' | 'KA' | 'HI' | 'OU'
  | 'TO' | 'NY' | 'NK' | 'NG' | 'UM' | 'RY';

export type HandPiece = 'FU' | 'KY' | 'KE' | 'GI' | 'KI' | 'KA' | 'HI';

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface Sq {
  x: number;
  y: number;
}

export interface Move {
  from: Sq | null; // null なら持ち駒を打つ
  to: Sq;
  piece: PieceType; // 動かす駒（成る前の種類）
  promote: boolean;
}

export type Hand = Record<HandPiece, number>;

export const HAND_ORDER: HandPiece[] = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];

export const PROMOTE_MAP: Partial<Record<PieceType, PieceType>> = {
  FU: 'TO', KY: 'NY', KE: 'NK', GI: 'NG', KA: 'UM', HI: 'RY',
};

export const DEMOTE_MAP: Record<PieceType, HandPiece | 'OU'> = {
  FU: 'FU', KY: 'KY', KE: 'KE', GI: 'GI', KI: 'KI', KA: 'KA', HI: 'HI', OU: 'OU',
  TO: 'FU', NY: 'KY', NK: 'KE', NG: 'GI', UM: 'KA', RY: 'HI',
};

export const PIECE_KANJI: Record<PieceType, string> = {
  FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉',
  TO: 'と', NY: '杏', NK: '圭', NG: '全', UM: '馬', RY: '龍',
};

// 文章の中で使う駒の名前（「と」「全」ではなく「と金」「成銀」）
export const PIECE_NAME: Record<PieceType, string> = {
  FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉',
  TO: 'と金', NY: '成香', NK: '成桂', NG: '成銀', UM: '馬', RY: '龍',
};

export const PIECE_VALUE: Record<PieceType, number> = {
  FU: 1, KY: 3, KE: 4, GI: 5, KI: 6, KA: 8, HI: 10, OU: 1000,
  TO: 7, NY: 6, NK: 6, NG: 6, UM: 12, RY: 14,
};

export function emptyHand(): Hand {
  return { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
}

export function sqEq(a: Sq | null, b: Sq | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y;
}

export function moveEq(a: Move, b: Move): boolean {
  return sqEq(a.from, b.from) && sqEq(a.to, b.to) && a.piece === b.piece && a.promote === b.promote;
}
