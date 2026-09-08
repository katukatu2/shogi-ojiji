import { Move, PieceType, HandPiece, PIECE_KANJI, Sq } from './types';
import { Position } from './position';

// USI 形式: "7g7f", "8h2b+", "P*5e"
const USI_PIECE: Record<HandPiece, string> = { FU: 'P', KY: 'L', KE: 'N', GI: 'S', KI: 'G', KA: 'B', HI: 'R' };
const USI_PIECE_REV: Record<string, HandPiece> = { P: 'FU', L: 'KY', N: 'KE', S: 'GI', G: 'KI', B: 'KA', R: 'HI' };

export function sqToUsi(sq: Sq): string {
  const file = 9 - sq.x;
  const rank = String.fromCharCode(97 + sq.y);
  return `${file}${rank}`;
}

export function usiToSq(s: string): Sq {
  const file = parseInt(s[0], 10);
  const rank = s.charCodeAt(1) - 97;
  return { x: 9 - file, y: rank };
}

export function moveToUsi(m: Move): string {
  if (!m.from) return `${USI_PIECE[m.piece as HandPiece]}*${sqToUsi(m.to)}`;
  return `${sqToUsi(m.from)}${sqToUsi(m.to)}${m.promote ? '+' : ''}`;
}

// 局面が必要（動かす駒の種類を盤から読むため）
export function usiToMove(pos: Position, usi: string): Move {
  if (usi[1] === '*') {
    return { from: null, to: usiToSq(usi.slice(2, 4)), piece: USI_PIECE_REV[usi[0]], promote: false };
  }
  const from = usiToSq(usi.slice(0, 2));
  const to = usiToSq(usi.slice(2, 4));
  const piece = pos.get(from.x, from.y);
  if (!piece) throw new Error(`No piece at ${usi.slice(0, 2)} for move ${usi}`);
  return { from, to, piece: piece.type, promote: usi.endsWith('+') };
}

const FILE_KANJI = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];
const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function sqToKanji(sq: Sq): string {
  return `${FILE_KANJI[8 - sq.x]}${RANK_KANJI[sq.y]}`;
}

// 台詞の中で読みやすい駒の名前（棋譜の「と」「全」「杏」「圭」ではなく「と金」「成銀」「成香」「成桂」）
const SPOKEN_PIECE: Partial<Record<PieceType, string>> = { TO: 'と金', NY: '成香', NK: '成桂', NG: '成銀' };

// 表示用の棋譜表記 "▲７六歩" など（同・打・成に対応。同種の駒の区別は簡略化）
export function moveToKanji(m: Move, color: 0 | 1, prev?: Move | null): string {
  const mark = color === 0 ? '▲' : '△';
  const dest = prev && prev.to.x === m.to.x && prev.to.y === m.to.y ? '同' : sqToKanji(m.to);
  const piece = SPOKEN_PIECE[m.piece as PieceType] ?? PIECE_KANJI[m.piece as PieceType];
  const suffix = m.from === null ? '打' : m.promote ? '成' : '';
  return `${mark}${dest}${piece}${suffix}`;
}

// USI 文字列を局面なしで漢字にする（定跡データの表示用。駒種は与える）
export function usiToKanji(usi: string, pos: Position, color: 0 | 1): string {
  return moveToKanji(usiToMove(pos, usi), color);
}
