import { Style } from './types';
import { COMMON_BAD, COMMON_GOOD, GoodPattern, BadPattern } from './patterns';
import { REACT_ROOK_FILE, REACT_EDGE_9, REACT_EDGE_1, REACT_THIRD_FILE, at, empty } from './common';
import { Reaction } from './types';
import { Position } from '../engine/position';

// 互いに角を手持ちにしている（角交換が済んでいる）か
function bishopsExchanged(pos: Position): boolean {
  return pos.hands[0].KA > 0 && pos.hands[1].KA > 0;
}

// 角交換のあとに残る、先手の陣の角の打ち込み所（金銀の利きがない自陣の空き升）
function bishopDropHoles(pos: Position): number {
  let holes = 0;
  for (let y = 6; y <= 8; y++) {
    for (let x = 0; x < 9; x++) {
      if (pos.get(x, y)) continue;
      if (!pos.isAttacked(x, y, 0)) holes++;
    }
  }
  return holes;
}

const KAKUGAWARI_GOOD: GoodPattern[] = [
  {
    // 角の打ち込みを消す ▲７八金
    id: 'guard-78',
    check({ move, after }) {
      if (move.piece !== 'KI' || move.to.x !== 2 || move.to.y !== 7) return null;
      if (!bishopsExchanged(after)) return null;
      return '７八金か。角の打ち込みを消したな。角換わりの基本ができておる。';
    },
  },
  {
    // 腰掛け銀 ▲５六銀
    id: 'koshikake',
    check({ move, after }) {
      if (move.piece !== 'GI' || move.to.x !== 4 || move.to.y !== 5) return null;
      if (!bishopsExchanged(after)) return null;
      return '腰掛け銀か。角換わりの王道じゃ。ここからの一手一手が勝負になる。';
    },
  },
  {
    // 早繰り銀 ▲４六銀・▲３六銀
    id: 'hayakuri',
    check({ before, move, after }) {
      if (move.piece !== 'GI' || move.to.y !== 5 || (move.to.x !== 5 && move.to.x !== 6)) return null;
      if (!bishopsExchanged(after) || before.moves.length > 30) return null;
      return '早繰り銀か。腰掛け銀が固まる前に来るとは、なかなかの手筋じゃ。';
    },
  },
  {
    // 角換わりに角道を止めるのは筋違い → 逆に、開けたまま交換に応じたら認める
    id: 'accept-exchange',
    check({ before, move, after }) {
      if (before.moves.length > 20) return null;
      const victim = before.get(move.to.x, move.to.y);
      if (!victim || victim.color !== 1 || (victim.type !== 'KA' && victim.type !== 'UM')) return null;
      if (after.hands[0].KA === 0) return null;
      return '角交換に応じたか。角換わりは互いに角を持つ将棋。打ち込みの隙を作らぬことじゃ。';
    },
  },
  ...COMMON_GOOD,
];

const KAKUGAWARI_BAD: BadPattern[] = [
  {
    // 角交換後に、金銀を動かして角の打ち込み所を増やす
    id: 'bishop-hole',
    headline: '角の打ち込みを忘れておる！',
    minDrop: 150,
    check({ before, move, after }) {
      if (!bishopsExchanged(before)) return null;
      if (move.piece !== 'KI' && move.piece !== 'GI') return null;
      if (bishopDropHoles(after) <= bishopDropHoles(before)) return null;
      return '相手は角を持っておる。金銀を動かして自陣に隙を作れば、そこに角を打ち込まれる。角換わりでは金銀の利きを切らすな。';
    },
  },
  ...COMMON_BAD,
];

// 角道が通った瞬間に△８八角成。多少損に見えても、これが戦法の看板なので優先する
const REACT_EXCHANGE: Reaction = {
  id: 'exchange',
  when: (pos) =>
    pos.moves.length <= 16 &&
    at(pos, 7, 1, 1, ['KA']) && at(pos, 1, 7, 0, ['KA']) &&
    empty(pos, 6, 2) && empty(pos, 5, 3) && empty(pos, 4, 4) && empty(pos, 3, 5) && empty(pos, 2, 6),
  moves: ['KA:2b8h+'],
  tolerance: 300,
};

// オジジの後手角換わり。相手が角道を開けたら△８八角成と自分から交換する（一手損角換わり）。
export const KAKUGAWARI: Style = {
  id: 'kakugawari',
  name: '角換わり',
  description: '序盤で角を交換。一手の隙が命取り',
  plans: [
    {
      name: '腰掛け銀型',
      moves: [
        'FU:8c8d',
        'FU:3c3d',
        'KA:2b8h+', // 角交換（一手損）
        'KI:4a3b', // ３二金で打ち込みを消す
        'GI:3a4b',
        'GI:4b3c', // ３三銀
        'GI:7a6b',
        'FU:6c6d', // ６四歩を突いて銀の道を作る
        'GI:6b6c',
        'GI:6c5d', // 腰掛け銀
        'OU:5a4a',
        'KI:6a5b',
        'FU:7c7d',
        'OU:4a3a',
        'FU:4c4d',
        'KE:8a7c',
        'FU:1c1d',
        'FU:9c9d',
        'OU:3a2b',
      ],
    },
    {
      name: '早繰り銀型',
      moves: [
        'FU:8c8d',
        'FU:3c3d',
        'KA:2b8h+',
        'KI:4a3b',
        'GI:3a4b',
        'GI:4b3c',
        'GI:7a6b',
        'FU:7c7d',
        'GI:6b7c', // 銀を早く繰り出す
        'GI:7c6d', // ６四銀
        'OU:5a4a',
        'KI:6a5b',
        'OU:4a3a',
        'FU:9c9d',
        'FU:1c1d',
        'FU:4c4d',
        'OU:3a2b',
      ],
    },
    {
      name: '棒銀型',
      moves: [
        'FU:8c8d',
        'FU:3c3d',
        'KA:2b8h+',
        'KI:4a3b',
        'GI:7a7b',
        'GI:7b8c',
        'FU:8d8e',
        'GI:8c8d', // ８四銀
        'GI:3a4b',
        'GI:4b3c',
        'OU:5a4a',
        'KI:6a5b',
        'OU:4a3a',
        'FU:1c1d',
        'FU:9c9d',
        'FU:4c4d',
        'OU:3a2b',
      ],
    },
  ],
  planTolerance: 120, // 一手損の角交換は少し損に見える。それでも交換するのが角換わりじゃ
  // 角道を止める受けは入れない（角交換したいので）
  reactions: [REACT_EXCHANGE, REACT_ROOK_FILE, REACT_EDGE_9, REACT_EDGE_1, REACT_THIRD_FILE],
  planComments: {
    'KA:2b8h+': '角交換じゃ。一手損だが、これが今の流行りの形。角換わりは駒組みの一手一手が勝負じゃ。',
    'KI:4a3b': '３二金。角の打ち込みに備える。お前もこの形を作れ。',
    'GI:6c5d': '腰掛け銀。角換わりの基本形じゃ。',
    'GI:7c6d': '早繰り銀。銀を早く前に出して仕掛ける。',
    'GI:8c8d': '角換わり棒銀じゃ。８七の歩、守れるか？',
    'OU:3a2b': '玉は２二。角を打ち込まれる筋がないか、よく見よ。',
  },
  badPatterns: KAKUGAWARI_BAD,
  goodPatterns: KAKUGAWARI_GOOD,
  lessons: [
    '角交換したら、互いに角の打ち込みを狙う。角を打たれにくい形（▲７八金・▲３八金）を先に作れ。',
    '腰掛け銀（▲５六銀）か早繰り銀（▲４六銀）か棒銀か。角換わりの三大戦法から一つ選べ。',
    '手待ちの一手が勝負を分ける。仕掛けは相手の形が整う前か、整い切ったあとの一瞬じゃ。',
    '飛車先の歩交換を許すな。▲７七銀か▲７八金で８七を守るのが基本。',
    '相手の玉が２二に入る前の△３一玉の瞬間は、角の打ち込みが利きやすい。狙え。',
    '角換わりは一手の隙が命取り。今日の隙を覚えておけ。',
  ],
  winLine: '角換わりで負けるとは…隙のない手を指しおる。',
};
