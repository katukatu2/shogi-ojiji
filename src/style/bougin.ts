import { Style } from './types';
import { COMMON_BAD, COMMON_GOOD, GoodPattern, pieceAt } from './patterns';
import { COMMON_REACTIONS } from './common';

// 後手の銀が８四・８五・９五あたりまで来ているか
function silverAdvanced(pos: import('../engine/position').Position): boolean {
  return pieceAt(pos, 1, 3, 1, ['GI']) || pieceAt(pos, 1, 4, 1, ['GI']) || pieceAt(pos, 0, 4, 1, ['GI']) || pieceAt(pos, 0, 3, 1, ['GI']);
}

const BOUGIN_GOOD: GoodPattern[] = [
  {
    // 銀で受ける（▲７七銀・▲８八銀）
    id: 'silver-guard',
    check({ move, after }) {
      if (move.piece !== 'GI') return null;
      const guard = (move.to.x === 2 && move.to.y === 6) || (move.to.x === 1 && move.to.y === 7);
      if (!guard || !silverAdvanced(after)) return null;
      return '銀で受けるか。棒銀には銀を当てるのが基本じゃ。';
    },
  },
  {
    // ▲７七角で８六を守る
    id: 'bishop-guard',
    check({ move, after }) {
      if (move.piece !== 'KA' || move.to.x !== 2 || move.to.y !== 6) return null;
      if (!silverAdvanced(after)) return null;
      return '７七角で８六を守るか。悪くない。だが角が動けなくなるのは覚えておけ。';
    },
  },
  {
    // 前に出た銀の頭を歩で叩く
    id: 'repel-silver',
    check({ move, after }) {
      if (move.piece !== 'FU') return null;
      const above = after.get(move.to.x, move.to.y - 1);
      if (!above || above.color !== 1 || above.type !== 'GI') return null;
      if (move.to.y > 5) return null; // 相手陣側で叩く歩だけ
      return '銀の頭を叩くか。追い返せば棒銀は攻めが切れる。';
    },
  },
  ...COMMON_GOOD,
];

// オジジの後手棒銀。飛車先を伸ばし、銀を７二→８三→８四と真っすぐ繰り出す。
export const BOUGIN: Style = {
  id: 'bougin',
  name: '棒銀',
  description: '銀をまっすぐ繰り出す速攻',
  plans: [
    {
      name: '本格型',
      moves: [
        'FU:8c8d',
        'FU:3c3d',
        'FU:8d8e', // 飛車先を伸ばす
        'KA:2b3c', // ３三角
        'GI:7a7b', // 銀を繰り出す
        'GI:7b8c',
        'GI:8c8d', // ８四銀
        'KI:4a3b',
        'OU:5a4a',
        'GI:3a4b',
        'OU:4a3a',
        'OU:3a2b',
        'KI:6a5b',
        'FU:9c9d',
        'FU:1c1d',
        'FU:7c7d',
        'FU:6c6d',
      ],
    },
    {
      name: '速攻型',
      moves: [
        'FU:8c8d',
        'FU:8d8e',
        'FU:3c3d',
        'GI:7a7b',
        'GI:7b8c',
        'GI:8c8d',
        'KA:2b3c',
        'KI:4a3b',
        'GI:8d9e', // ９五銀から端を絡めて攻める
        'KI:6a5b',
        'OU:5a4a',
        'FU:9c9d',
        'GI:3a4b',
        'OU:4a3a',
        'OU:3a2b',
        'FU:1c1d',
        'FU:7c7d',
      ],
    },
  ],
  planTolerance: 150, // 棒銀は多少損でも銀を繰り出す。それが棒銀じゃ
  reactions: COMMON_REACTIONS,
  planComments: {
    'FU:8d8e': '飛車先を伸ばす。狙いは８六、８七じゃ。',
    'GI:7b8c': '銀を前へ。棒銀じゃ。',
    'GI:8c8d': '銀が８四まで来た。次は８五か９五。８七の歩、守れるか？',
    'GI:8d9e': '９五銀。端から食い破るぞ。',
    'OU:3a2b': 'ひとまず玉は２二に。攻めは銀に任せる。',
  },
  badPatterns: COMMON_BAD,
  goodPatterns: BOUGIN_GOOD,
  lessons: [
    '棒銀は銀を追い返せば攻めが切れる。歩で銀の頭を叩け。',
    '８七の歩を守る銀か角を、相手の銀が来る前に用意せよ。',
    '棒銀相手に囲いを急ぐな。まず受けの形、それから囲え。',
    '相手の銀が前に出た分、相手の玉は薄い。受け切ったら反撃じゃ。',
  ],
  winLine: 'むう、わしの銀が追い返されるとは。',
  loseLine: '棒銀は単純じゃが、受け間違えれば一気じゃ。',
};
