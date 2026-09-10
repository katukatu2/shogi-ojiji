import { Style } from './types';
import { goteMinoComplete } from './castles';
import { COMMON_BAD, COMMON_GOOD, GoodPattern, FUNAGAKOI, ANAGUMA, pieceAt } from './patterns';
import { COMMON_REACTIONS, REACT_EDGE_1, REACT_EDGE_9, REACT_ROOK_FILE } from './common';

const NAKABISHA_GOOD: GoodPattern[] = [
  {
    // ５筋を金銀で守る（▲５七銀・▲６七金・▲５八金など、５筋の周りに金銀を寄せる）
    id: 'center-guard',
    check({ move, after }) {
      if (move.piece !== 'GI' && move.piece !== 'KI') return null;
      if (move.to.x < 3 || move.to.x > 5 || move.to.y < 6 || move.to.y > 7) return null;
      if (!pieceAt(after, 4, 4, 1, ['FU'])) return null; // 後手が５五歩を伸ばしているとき
      return '５筋を金銀で守るか。中飛車の狙いは５筋の突破。よく見ておる。';
    },
  },
  {
    // 超速（▲３七銀から▲４六銀と早く銀を繰り出す）
    id: 'chousoku',
    check({ before, move }) {
      if (before.moves.length > 24 || move.piece !== 'GI') return null;
      if (move.to.x !== 5 || move.to.y !== 5) return null; // ▲４六銀
      return '超速か。中飛車には銀を早く繰り出すのが今の主流じゃ。よく知っておる。';
    },
  },
  {
    // ５五の歩を取る
    id: 'take-55',
    check({ before, move }) {
      const victim = before.get(move.to.x, move.to.y);
      if (!victim || victim.color !== 1 || victim.type !== 'FU') return null;
      if (move.to.x !== 4 || move.to.y !== 4) return null;
      return '５五の歩を取ったか。あれは中飛車の生命線じゃ。';
    },
  },
  FUNAGAKOI,
  ANAGUMA,
  ...COMMON_GOOD,
];

// オジジの後手ゴキゲン中飛車。角道を開けたまま飛車を５筋へ、５五歩と伸ばして美濃囲い。
export const NAKABISHA: Style = {
  id: 'nakabisha',
  name: '中飛車',
  description: '飛車を５筋へ回し、中央を制する',
  plans: [
    {
      name: 'ゴキゲン標準型',
      moves: [
        'FU:3c3d',
        'FU:5c5d',
        'HI:8b5b', // 飛車を５筋へ
        'FU:5d5e', // ５五歩
        'OU:5a6b',
        'OU:6b7b',
        'OU:7b8b',
        'GI:7a7b', // 美濃囲い
        'GI:3a4b',
        'KI:4a3b',
        'GI:4b5c', // ５三銀
        'FU:9c9d',
        'FU:1c1d',
        'KA:2b3c', // ３三角
        'FU:6c6d',
        'FU:7c7d',
        'KE:8a7c',
      ],
    },
    {
      name: '早囲い型',
      moves: [
        'FU:5c5d',
        'FU:3c3d',
        'HI:8b5b',
        'OU:5a6b',
        'FU:5d5e',
        'OU:6b7b',
        'OU:7b8b',
        'GI:7a7b',
        'GI:3a4b',
        'KI:4a3b',
        'GI:4b5c',
        'FU:6c6d',
        'FU:9c9d',
        'FU:1c1d',
        'KA:2b3c',
        'FU:7c7d',
        'KE:8a7c',
      ],
    },
  ],
  // 中飛車は角道を開けたままにするので、角道を止める受けは入れない
  reactions: [REACT_ROOK_FILE, REACT_EDGE_9, REACT_EDGE_1, ...COMMON_REACTIONS.filter((r) => r.id === 'third-file')],
  planComments: {
    'HI:8b5b': '飛車は５筋。ゴキゲン中飛車じゃ。',
    'FU:5d5e': '５五歩。５筋を伸ばして中央を制する。',
    'GI:7a7b': (pos) => goteMinoComplete(pos) ? '美濃囲い、完成じゃ。' : '銀は７二。美濃囲いを目指して守りを固めるぞ。',
    'GI:4b5c': '５三銀。５筋の突破を狙う。',
    'KA:2b3c': '３三角。角道は開けたままじゃ。角交換、来るなら来い。',
  },
  badPatterns: COMMON_BAD,
  goodPatterns: NAKABISHA_GOOD,
  lessons: [
    '中飛車は５筋を突破されると一気に崩れる。５七・６七に金銀を置いて中央を厚くせよ。',
    '相手が飛車を５筋に振ったら、玉を左（７八・８八）に囲って飛車の正面から外れよ。',
    'ゴキゲン中飛車は角交換を怖がらん。角道を開けたままの急戦（超速▲３七銀）が有力じゃ。',
    '５五歩を取れるなら取れ。中飛車は５五の歩が生命線じゃ。',
  ],
  winLine: '５筋を止められては中飛車は苦しい…見事じゃ。',
  loseLine: '中央を制した者が将棋を制する。',
};
