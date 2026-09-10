// エンジンの評価値では拾いにくい「やってはいけない形」と「良い手の形」。
// それぞれ一局に一度だけ反応する（呼び出し側で id を記録する）。
//
// NG パターンには 2 種類ある。
// - minDrop なし: 形だけで叱る（囲わず攻める、玉飛接近など、評価値に出にくい方針の誤り）
// - minDrop あり: 形が当てはまり、かつエンジンがその点数以上「形勢が落ちた」と言うときだけ叱る。
//   エンジンが使えない環境では出さない（誤爆を防ぐ）。
//
// COMMON_* はどの戦法でも使う。戦法ごとの形はそれぞれの戦法ファイルから参照する。
//
// 形だけの NG は「囲え」「玉を寄せるな」といった序盤の方針の話なので、戦いが始まった局面では
// guarded() で黙らせる（isFighting を参照）。勧める手は canMove() で合法か確かめてから台詞に出す。

import { Position } from '../engine/position';
import { Move, PieceType, Sq } from '../engine/types';

export interface PatternContext {
  before: Position; // 指す前（先手番）
  move: Move;
  after: Position; // 指した後（後手番）
}

export interface BadPattern {
  id: string;
  headline: string;
  minDrop?: number; // エンジンの裏付けが必要なときの、評価値の落ち幅
  check(ctx: PatternContext): string | null; // 該当すれば説教を返す
}

export interface GoodPattern {
  id: string;
  check(ctx: PatternContext): string | null; // 該当すれば一言を返す
}

const KING_START: Sq = { x: 4, y: 8 }; // ５九

export function senteKing(pos: Position): Sq | null {
  return pos.findKing(0);
}

export function goteKing(pos: Position): Sq | null {
  return pos.findKing(1);
}

// 後手玉が初期位置（５一）を離れ、どちらかの端へ寄っているか
export function goteKingSide(pos: Position): 'left' | 'right' | null {
  const k = goteKing(pos);
  if (!k) return null;
  if (k.x >= 6) return 'right'; // １〜３筋側（矢倉ならこちら）
  if (k.x <= 2) return 'left'; // ７〜９筋側（振り飛車の美濃ならこちら）
  return null;
}

export function senteRook(pos: Position): Sq | null {
  for (let i = 0; i < 81; i++) {
    const c = pos.board[i];
    if (c && c.color === 0 && (c.type === 'HI' || c.type === 'RY')) return { x: i % 9, y: Math.floor(i / 9) };
  }
  return null;
}

export function pieceAt(pos: Position, x: number, y: number, color: 0 | 1, types: string[]): boolean {
  const p = pos.get(x, y);
  return !!p && p.color === color && types.includes(p.type);
}

// 自陣（七〜九段）より前に出ている先手の歩以外の駒の数
function advancedAttackers(pos: Position): number {
  let n = 0;
  for (let i = 0; i < 81; i++) {
    const c = pos.board[i];
    const y = Math.floor(i / 9);
    if (c && c.color === 0 && c.type !== 'FU' && c.type !== 'OU' && y <= 5) n++;
  }
  return n;
}

// 初期配置から動いた先手の金銀のうち、玉の近く（筋の差 3 以内、段の差 2 以内）にいる数
const GUARD_HOME = new Set(['2,8', '6,8', '3,8', '5,8']); // ７九銀・３九銀・６九金・４九金
function movedGuardsNear(pos: Position, k: Sq): number {
  let n = 0;
  for (let i = 0; i < 81; i++) {
    const c = pos.board[i];
    if (!c || c.color !== 0 || (c.type !== 'KI' && c.type !== 'GI')) continue;
    const x = i % 9;
    const y = Math.floor(i / 9);
    if (GUARD_HOME.has(`${x},${y}`)) continue;
    if (Math.abs(x - k.x) <= 3 && Math.abs(y - k.y) <= 2) n++;
  }
  return n;
}

const PROMOTED: ReadonlySet<PieceType> = new Set<PieceType>(['TO', 'NY', 'NK', 'NG', 'UM', 'RY']);
const CASTLE_TARGET: Sq = { x: 3, y: 7 }; // ６八（左へ囲うときの入口）

// 玉の周りに相手の駒がいるとみなす範囲（筋・段の差）
const KING_DANGER = 2;

// 戦いが始まっているか。形だけの NG（囲え・玉を寄せるななどの序盤の方針）は、
// ここが真なら黙る。中盤の戦術局面では方針の話が当てはまらず、
// 「▲６八玉から囲え」のように指せない手を勧めてしまうため。
export function isFighting({ before, move }: PatternContext): boolean {
  // (1) 相手の駒が自陣（七〜九段）に成り込んでいる
  for (let i = 0; i < 81; i++) {
    const c = before.board[i];
    if (c && c.color === 1 && PROMOTED.has(c.type) && Math.floor(i / 9) >= 6) return true;
  }
  // (2) 自玉が王手されている（＝指した手は王手を受ける手）
  if (before.inCheck(0)) return true;
  // (3) 指した手が相手の駒を取る手
  const victim = before.get(move.to.x, move.to.y);
  if (victim && victim.color === 1) return true;
  // (4) 自玉の周囲 2 マスに相手の駒がある（利きではなく駒そのもの）
  const k = senteKing(before);
  if (k) {
    for (let dy = -KING_DANGER; dy <= KING_DANGER; dy++) {
      for (let dx = -KING_DANGER; dx <= KING_DANGER; dx++) {
        const x = k.x + dx;
        const y = k.y + dy;
        if (!Position.inside(x, y)) continue;
        const c = before.get(x, y);
        if (c && c.color === 1) return true;
      }
    }
  }
  return false;
}

// 形だけの NG に共通の guard をかぶせる。戦いが始まっていれば発火させない
export function guarded(p: BadPattern): BadPattern {
  return {
    ...p,
    check(ctx: PatternContext): string | null {
      if (isFighting(ctx)) return null;
      return p.check(ctx);
    },
  };
}

// 勧める手（先手の手）が本当に指せるか。指せない手は台詞に出さない
export function canMove(pos: Position, from: Sq, to: Sq): boolean {
  let p = pos;
  if (p.turn !== 0) {
    p = pos.clone();
    p.turn = 0;
  }
  return p.legalMoves().some((m) => !!m.from && m.from.x === from.x && m.from.y === from.y && m.to.x === to.x && m.to.y === to.y);
}

// ===== どの戦法でも共通の NG =====
// 形だけの NG（minDrop 無し）は guarded() を通す。末尾の .map(guarded) を参照
const COMMON_BAD_RAW: BadPattern[] = [
  {
    id: 'attack-without-castle',
    headline: '囲わずに攻めるでない！',
    check({ before, move, after }) {
      const k = senteKing(after);
      if (!k || k.x !== KING_START.x || k.y !== KING_START.y) return null;
      if (before.moves.length < 10 || before.moves.length > 40) return null; // 序盤の方針の話。終盤は言わない
      const attacking = move.piece !== 'OU' && move.piece !== 'KI' && move.to.y <= 4;
      if (!attacking) return null;
      if (advancedAttackers(after) < 2) return null;
      const head = '玉が５九に裸のままじゃ。攻め合いになれば、囲っていない方が先に倒れる。';
      // ▲６八玉が指せるときだけ具体手を出す（玉を動かす手ではないので、玉は指す前も５九にいる）
      return head + (canMove(before, KING_START, CASTLE_TARGET) ? 'まず▲６八玉から左へ囲え。' : 'まず玉を左へ囲え。');
    },
  },
  {
    id: 'king-near-rook',
    headline: '玉飛接近すべからず！',
    check({ before, move, after }) {
      if (move.piece !== 'OU' || !move.from) return null;
      if (before.moves.length > 30) return null; // 囲いの方針の話。中盤以降の玉の逃げは別
      const r = senteRook(after);
      // 居飛車（飛車が右側の１〜３筋、八段目）のときだけ。振り飛車なら玉は右へ行くのが正しい
      if (!r || r.y !== 7 || r.x < 6) return null;
      if (move.to.x <= move.from.x) return null; // 飛車の方（右）へ寄る手だけ
      if (Math.abs(move.to.x - r.x) > 2) return null; // ４八・３八など飛車寄り
      const head = '飛車のそばに玉を置くな。飛車は狙われる駒、玉まで巻き込まれる。';
      // ▲６八玉が指せるときだけ具体手を出す
      return head + (canMove(before, move.from, CASTLE_TARGET) ? '居飛車なら玉は左へ、▲６八玉から囲え。' : '居飛車なら玉は左へ囲うのが筋じゃ。');
    },
  },
  {
    id: 'pawn-in-front-of-king',
    headline: '玉頭の歩を突くな！',
    minDrop: 150,
    check({ before, move, after }) {
      if (move.piece !== 'FU' || move.from === null) return null;
      if (before.get(move.to.x, move.to.y)) return null; // 取る手は別
      const k = senteKing(before);
      if (!k || k.y < 7) return null; // 玉が八・九段目にいるとき
      if (move.from.x !== k.x || move.from.y !== k.y - 1) return null; // 玉の真上の歩だけ
      // 突いた歩が相手の駒に当たる（銀の頭を叩くなど）なら攻めの手
      const ahead = after.get(move.to.x, move.to.y - 1);
      if (ahead && ahead.color === 1) return null;
      // 相手の攻め駒（歩・玉以外）が、その歩のすぐ前の三段以内・隣接筋にいるときだけ
      for (let dx = -1; dx <= 1; dx++) {
        for (let y = k.y - 4; y <= k.y - 2; y++) {
          const x = k.x + dx;
          if (!Position.inside(x, y)) continue;
          const c = after.get(x, y);
          if (c && c.color === 1 && c.type !== 'FU' && c.type !== 'OU') {
            return '相手の駒が玉に迫っているときに玉頭の歩を突くと、その歩がなくなった所から攻め込まれる。玉の前の歩は最後の盾じゃ。動かすな。';
          }
        }
      }
      return null;
    },
  },
];

export const COMMON_BAD: BadPattern[] = COMMON_BAD_RAW.map(guarded);

// ===== どの戦法でも共通の良い形 =====
export const COMMON_GOOD: GoodPattern[] = [
  {
    id: 'castled',
    check({ move, after }) {
      if (move.piece !== 'OU') return null;
      // 端から二筋以内（８八・２八・９九など）で八・九段目。動かした金銀が二枚以上そばにいる
      const side = move.to.x <= 1 || move.to.x >= 7;
      if (!side || move.to.y < 7) return null;
      if (movedGuardsNear(after, move.to) < 2) return null;
      return '囲いができたな。堅さでは負けておらん。ここからが本番じゃ。';
    },
  },
];

// 角交換（角で交換を仕掛ける、または取られた自分の角を相手の角と交換する）。
export function bishopExchange(id: string, comment: string): GoodPattern {
  return {
    id,
    check({ before, move, after }) {
      if (before.moves.length > 24) return null; // 序盤だけ。終盤に角を取っても「角交換」ではない
      const victim = before.get(move.to.x, move.to.y);
      if (!victim || victim.color !== 1 || (victim.type !== 'KA' && victim.type !== 'UM')) return null;
      if (before.hands[0].KA > 0 || after.hands[0].KA === 0) return null;
      const ownBishopRemains = before.board.some((p) => p?.color === 0 && (p.type === 'KA' || p.type === 'UM'));
      const takingBack = !ownBishopRemains && before.hands[1].KA > 0;
      const offeringTrade = (move.piece === 'KA' || move.piece === 'UM') &&
        after.legalMoves().some((reply) => reply.to.x === move.to.x && reply.to.y === move.to.y);
      if (!takingBack && !offeringTrade) return null;
      return comment;
    },
  };
}

// 端攻め（オジジの玉がいる側の端に、歩・香・桂で攻め込む）
export function edgeAttack(comment: string): GoodPattern {
  return {
    id: 'edge-attack',
    check({ move, after }) {
      const edge = move.to.x === 0 || move.to.x === 8;
      if (!edge || move.to.y > 4) return null;
      if (move.piece !== 'FU' && move.piece !== 'KY' && move.piece !== 'KE') return null;
      const side = goteKingSide(after);
      if (!side) return null;
      if (side === 'right' && move.to.x !== 8) return null;
      if (side === 'left' && move.to.x !== 0) return null;
      return comment;
    },
  };
}

// 舟囲い（▲７八玉・▲６八銀・▲５八金）。対振り飛車の基本形
export const FUNAGAKOI: GoodPattern = {
  id: 'funagakoi',
  check({ move, after }) {
    if (move.piece !== 'OU' && move.piece !== 'GI' && move.piece !== 'KI') return null;
    if (!pieceAt(after, 2, 7, 0, ['OU']) || !pieceAt(after, 3, 7, 0, ['GI']) || !pieceAt(after, 4, 7, 0, ['KI'])) return null;
    return '舟囲いか。振り飛車相手の基本形じゃ。ここから急戦か持久戦か、決めるのはお前じゃ。';
  },
};

// 穴熊（玉が９九か１九、香が上がっている）
export const ANAGUMA: GoodPattern = {
  id: 'anaguma',
  check({ move, after }) {
    if (move.piece !== 'OU') return null;
    const left = move.to.x === 0 && move.to.y === 8 && pieceAt(after, 0, 7, 0, ['KY']);
    const right = move.to.x === 8 && move.to.y === 8 && pieceAt(after, 8, 7, 0, ['KY']);
    if (!left && !right) return null;
    return '穴熊か…堅いのう。だが手数がかかる。その間にこちらも攻めの形を作らせてもらう。';
  },
};

// 急戦（囲いが固まる前に、銀や歩で仕掛ける）
export const KYUSEN: GoodPattern = {
  id: 'kyusen',
  check({ before, move }) {
    if (before.moves.length > 30) return null;
    const silverUp = move.piece === 'GI' && move.to.y <= 5 && move.to.x >= 4 && move.to.x <= 6; // ４六・３六・５六あたりの銀
    const pawnUp = move.piece === 'FU' && move.from !== null && move.to.y === 4 && move.to.x >= 5 && move.to.x <= 6; // ▲４五歩・▲３五歩
    if (!silverUp && !pawnUp) return null;
    return '急戦か。わしの囲いが固まる前に来るとは、良い判断じゃ。';
  },
};

// 右四間飛車（飛車を４筋へ）
export const MIGI_SHIKEN: GoodPattern = {
  id: 'migi-shiken',
  check({ move }) {
    if (move.piece !== 'HI' || move.to.x !== 5 || move.to.y !== 7) return null;
    return '右四間か。振り飛車の急所を狙うのう。';
  },
};

// ===== 互換用: 矢倉向けの既定セット（テストと Judge の既定値で使う） =====
export const YAGURA_GOOD: GoodPattern[] = [
  bishopExchange('bishop-exchange', '角交換か。矢倉党は角を換えられるのを嫌う。相手が角道を止める前に仕掛けたのは良い判断じゃ。'),
  edgeAttack('端を攻めるか。端は矢倉の泣き所じゃ。歩を突き捨てて香と桂で畳みかけよ。'),
  {
    id: 'bousin',
    check({ move, after }) {
      if (move.piece !== 'GI' || move.from === null) return null;
      if (move.to.x !== 7 || move.to.y > 5) return null; // ２六・２五の銀
      if (after.moves.length < 8) return null; // 相手の形がまだ見えないうちは言わない
      return '棒銀か。矢倉相手の王道じゃ。銀を五段目まで進め、歩と組んで相手の銀と交換を迫れ。';
    },
  },
  {
    id: 'kakugashira',
    check({ move, after }) {
      // ３三の銀・角の頭（３四）に歩を打つ、または３五歩から３四歩の攻め
      if (move.piece !== 'FU' || move.to.x !== 6 || move.to.y !== 3) return null;
      const target = after.get(6, 2);
      if (!target || target.color !== 1) return null;
      if (goteKingSide(after) !== 'right') return null;
      return '３三に歩を絡めて攻めるか。矢倉の屋根の斜め上は守りが薄い。よく見ておる。';
    },
  },
];

export const BAD_PATTERNS: BadPattern[] = COMMON_BAD;
export const GOOD_PATTERNS: GoodPattern[] = [...YAGURA_GOOD, ...COMMON_GOOD];
