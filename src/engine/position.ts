import {
  Color, Piece, PieceType, HandPiece, Move, Sq, Hand,
  PROMOTE_MAP, DEMOTE_MAP, emptyHand,
} from './types';

type Step = [number, number];

// 先手視点の動き。後手は dy を反転する。
const STEPS: Partial<Record<PieceType, Step[]>> = {
  FU: [[0, -1]],
  KE: [[-1, -2], [1, -2]],
  GI: [[0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]],
  KI: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]],
  OU: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]],
  UM: [[0, -1], [-1, 0], [1, 0], [0, 1]],
  RY: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
};
STEPS.TO = STEPS.NY = STEPS.NK = STEPS.NG = STEPS.KI;

const SLIDES: Partial<Record<PieceType, Step[]>> = {
  KY: [[0, -1]],
  KA: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  HI: [[0, -1], [0, 1], [-1, 0], [1, 0]],
};
SLIDES.UM = SLIDES.KA;
SLIDES.RY = SLIDES.HI;

interface Undo {
  move: Move;
  captured: Piece | null;
}

const SFEN_LETTER: Record<PieceType, string> = {
  FU: 'P', KY: 'L', KE: 'N', GI: 'S', KI: 'G', KA: 'B', HI: 'R', OU: 'K',
  TO: '+P', NY: '+L', NK: '+N', NG: '+S', UM: '+B', RY: '+R',
};
const SFEN_HAND_ORDER: HandPiece[] = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];

export class Position {
  board: (Piece | null)[] = new Array(81).fill(null);
  hands: [Hand, Hand] = [emptyHand(), emptyHand()];
  turn: Color = 0;
  moves: Move[] = [];
  private undoStack: Undo[] = [];

  static initial(): Position {
    const p = new Position();
    const back: PieceType[] = ['KY', 'KE', 'GI', 'KI', 'OU', 'KI', 'GI', 'KE', 'KY'];
    for (let x = 0; x < 9; x++) {
      p.set(x, 0, { type: back[x], color: 1 });
      p.set(x, 8, { type: back[x], color: 0 });
      p.set(x, 2, { type: 'FU', color: 1 });
      p.set(x, 6, { type: 'FU', color: 0 });
    }
    p.set(1, 1, { type: 'HI', color: 1 });
    p.set(7, 1, { type: 'KA', color: 1 });
    p.set(7, 7, { type: 'HI', color: 0 });
    p.set(1, 7, { type: 'KA', color: 0 });
    return p;
  }

  clone(): Position {
    const p = new Position();
    p.board = this.board.map((c) => (c ? { ...c } : null));
    p.hands = [{ ...this.hands[0] }, { ...this.hands[1] }];
    p.turn = this.turn;
    p.moves = this.moves.slice();
    return p;
  }

  get(x: number, y: number): Piece | null {
    return this.board[y * 9 + x];
  }

  // USI の SFEN 文字列。手番を入れ替えた局面（相手に手番を渡したら何をされるか）をエンジンに渡すときに使う
  toSfen(): string {
    const rows: string[] = [];
    for (let y = 0; y < 9; y++) {
      let row = '';
      let empty = 0;
      for (let x = 0; x < 9; x++) {
        const p = this.board[y * 9 + x];
        if (!p) {
          empty++;
          continue;
        }
        if (empty > 0) {
          row += String(empty);
          empty = 0;
        }
        const letter = SFEN_LETTER[p.type];
        row += p.color === 0 ? letter : letter.toLowerCase();
      }
      if (empty > 0) row += String(empty);
      rows.push(row);
    }
    let hands = '';
    for (const color of [0, 1] as Color[]) {
      for (const hp of SFEN_HAND_ORDER) {
        const n = this.hands[color][hp];
        if (n <= 0) continue;
        const letter = SFEN_LETTER[hp];
        hands += (n > 1 ? String(n) : '') + (color === 0 ? letter : letter.toLowerCase());
      }
    }
    return `${rows.join('/')} ${this.turn === 0 ? 'b' : 'w'} ${hands || '-'} ${this.moves.length + 1}`;
  }

  set(x: number, y: number, piece: Piece | null): void {
    this.board[y * 9 + x] = piece;
  }

  static inside(x: number, y: number): boolean {
    return x >= 0 && x < 9 && y >= 0 && y < 9;
  }

  // 局面を一意に表す文字列（定跡の照合に使う）
  key(): string {
    let s = '';
    for (let i = 0; i < 81; i++) {
      const c = this.board[i];
      s += c ? (c.color === 0 ? c.type : c.type.toLowerCase()) : '.';
      s += ',';
    }
    s += '|' + JSON.stringify(this.hands) + '|' + this.turn;
    return s;
  }

  findKing(color: Color): Sq | null {
    for (let i = 0; i < 81; i++) {
      const c = this.board[i];
      if (c && c.type === 'OU' && c.color === color) return { x: i % 9, y: Math.floor(i / 9) };
    }
    return null;
  }

  // by 側の駒が (x,y) を利かせているか
  isAttacked(x: number, y: number, by: Color): boolean {
    const dir = by === 0 ? 1 : -1;
    for (let i = 0; i < 81; i++) {
      const c = this.board[i];
      if (!c || c.color !== by) continue;
      const fx = i % 9;
      const fy = Math.floor(i / 9);
      const steps = STEPS[c.type];
      if (steps) {
        for (const [dx, dy] of steps) {
          if (fx + dx === x && fy + dy * dir === y) return true;
        }
      }
      const slides = SLIDES[c.type];
      if (slides) {
        for (const [dx, dy] of slides) {
          let cx = fx + dx;
          let cy = fy + dy * dir;
          while (Position.inside(cx, cy)) {
            if (cx === x && cy === y) return true;
            if (this.get(cx, cy)) break;
            cx += dx;
            cy += dy * dir;
          }
        }
      }
    }
    return false;
  }

  // (x,y) を利かせている by 側の駒の位置一覧
  attackers(x: number, y: number, by: Color): Sq[] {
    const out: Sq[] = [];
    const dir = by === 0 ? 1 : -1;
    for (let i = 0; i < 81; i++) {
      const c = this.board[i];
      if (!c || c.color !== by) continue;
      const fx = i % 9;
      const fy = Math.floor(i / 9);
      let hit = false;
      const steps = STEPS[c.type];
      if (steps) {
        for (const [dx, dy] of steps) {
          if (fx + dx === x && fy + dy * dir === y) hit = true;
        }
      }
      const slides = SLIDES[c.type];
      if (!hit && slides) {
        for (const [dx, dy] of slides) {
          let cx = fx + dx;
          let cy = fy + dy * dir;
          while (Position.inside(cx, cy)) {
            if (cx === x && cy === y) { hit = true; break; }
            if (this.get(cx, cy)) break;
            cx += dx;
            cy += dy * dir;
          }
          if (hit) break;
        }
      }
      if (hit) out.push({ x: fx, y: fy });
    }
    return out;
  }

  inCheck(color: Color): boolean {
    const k = this.findKing(color);
    if (!k) return false;
    return this.isAttacked(k.x, k.y, (1 - color) as Color);
  }

  static inPromotionZone(y: number, color: Color): boolean {
    return color === 0 ? y <= 2 : y >= 6;
  }

  // その段で動けなくなる駒か（行き所のない駒）
  static isDeadSquare(type: PieceType, y: number, color: Color): boolean {
    const last = color === 0 ? 0 : 8;
    const second = color === 0 ? 1 : 7;
    if (type === 'FU' || type === 'KY') return y === last;
    if (type === 'KE') return y === last || y === second;
    return false;
  }

  hasPawnOnFile(x: number, color: Color): boolean {
    for (let y = 0; y < 9; y++) {
      const c = this.get(x, y);
      if (c && c.color === color && c.type === 'FU') return true;
    }
    return false;
  }

  pseudoMoves(): Move[] {
    const out: Move[] = [];
    const color = this.turn;
    const dir = color === 0 ? 1 : -1;
    const pushTo = (from: Sq, type: PieceType, tx: number, ty: number): boolean => {
      const target = this.get(tx, ty);
      if (target && target.color === color) return false;
      const canPromote = PROMOTE_MAP[type] !== undefined &&
        (Position.inPromotionZone(from.y, color) || Position.inPromotionZone(ty, color));
      const mustPromote = Position.isDeadSquare(type, ty, color);
      if (canPromote) out.push({ from, to: { x: tx, y: ty }, piece: type, promote: true });
      if (!mustPromote) out.push({ from, to: { x: tx, y: ty }, piece: type, promote: false });
      return !target;
    };
    for (let i = 0; i < 81; i++) {
      const c = this.board[i];
      if (!c || c.color !== color) continue;
      const from = { x: i % 9, y: Math.floor(i / 9) };
      const steps = STEPS[c.type];
      if (steps) {
        for (const [dx, dy] of steps) {
          const tx = from.x + dx;
          const ty = from.y + dy * dir;
          if (Position.inside(tx, ty)) pushTo(from, c.type, tx, ty);
        }
      }
      const slides = SLIDES[c.type];
      if (slides) {
        for (const [dx, dy] of slides) {
          let tx = from.x + dx;
          let ty = from.y + dy * dir;
          while (Position.inside(tx, ty)) {
            if (!pushTo(from, c.type, tx, ty)) break;
            tx += dx;
            ty += dy * dir;
          }
        }
      }
    }
    // 持ち駒を打つ
    const hand = this.hands[color];
    for (const hp of Object.keys(hand) as HandPiece[]) {
      if (hand[hp] <= 0) continue;
      for (let y = 0; y < 9; y++) {
        if (Position.isDeadSquare(hp, y, color)) continue;
        for (let x = 0; x < 9; x++) {
          if (this.get(x, y)) continue;
          if (hp === 'FU' && this.hasPawnOnFile(x, color)) continue; // 二歩
          out.push({ from: null, to: { x, y }, piece: hp, promote: false });
        }
      }
    }
    return out;
  }

  legalMoves(): Move[] {
    const color = this.turn;
    const out: Move[] = [];
    for (const m of this.pseudoMoves()) {
      this.apply(m);
      const ok = !this.inCheck(color);
      let uchifuzume = false;
      if (ok && m.from === null && m.piece === 'FU') {
        // 打ち歩詰め: 歩を打って相手を詰ませてはいけない
        const opp = (1 - color) as Color;
        if (this.inCheck(opp) && this.legalMoves().length === 0) uchifuzume = true;
      }
      this.undo();
      if (ok && !uchifuzume) out.push(m);
    }
    return out;
  }

  apply(m: Move): void {
    const color = this.turn;
    let captured: Piece | null = null;
    if (m.from) {
      const piece = this.get(m.from.x, m.from.y)!;
      captured = this.get(m.to.x, m.to.y);
      if (captured) {
        const hp = DEMOTE_MAP[captured.type];
        if (hp !== 'OU') this.hands[color][hp]++;
      }
      this.set(m.from.x, m.from.y, null);
      const type = m.promote ? PROMOTE_MAP[piece.type]! : piece.type;
      this.set(m.to.x, m.to.y, { type, color });
    } else {
      this.hands[color][m.piece as HandPiece]--;
      this.set(m.to.x, m.to.y, { type: m.piece, color });
    }
    this.undoStack.push({ move: m, captured });
    this.moves.push(m);
    this.turn = (1 - color) as Color;
  }

  undo(): void {
    const u = this.undoStack.pop();
    if (!u) return;
    this.moves.pop();
    const color = (1 - this.turn) as Color;
    this.turn = color;
    const m = u.move;
    if (m.from) {
      this.set(m.from.x, m.from.y, { type: m.piece, color });
      this.set(m.to.x, m.to.y, u.captured);
      if (u.captured) {
        const hp = DEMOTE_MAP[u.captured.type];
        if (hp !== 'OU') this.hands[color][hp]--;
      }
    } else {
      this.set(m.to.x, m.to.y, null);
      this.hands[color][m.piece as HandPiece]++;
    }
  }

  isCheckmate(): boolean {
    return this.inCheck(this.turn) && this.legalMoves().length === 0;
  }

  // 手番側に合法手がない（詰み。将棋ではステイルメイトも負け）
  isGameOver(): boolean {
    return this.legalMoves().length === 0;
  }
}
