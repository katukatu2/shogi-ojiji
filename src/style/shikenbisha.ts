import { Style } from './types';
import { COMMON_BAD, COMMON_GOOD, FUNAGAKOI, ANAGUMA, KYUSEN, MIGI_SHIKEN, bishopExchange, edgeAttack } from './patterns';
import { COMMON_REACTIONS } from './common';

// オジジの後手四間飛車。飛車を４二へ振り、玉は８二の美濃囲い。
export const SHIKENBISHA: Style = {
  id: 'shikenbisha',
  name: '四間飛車',
  description: '飛車を４筋へ振り、美濃囲いに潜る',
  plans: [
    {
      name: '美濃囲い型',
      moves: [
        'FU:3c3d', // 角道を開ける
        'FU:4c4d', // 角道を止める
        'HI:8b4b', // 飛車を４筋へ
        'OU:5a6b', // 玉を美濃へ
        'OU:6b7b',
        'OU:7b8b',
        'GI:7a7b', // 美濃囲い完成
        'KI:4a5b', // ５二金
        'GI:3a3b', // 左銀
        'GI:3b4c', // ４三銀
        'FU:9c9d', // 端
        'FU:1c1d',
        'FU:6c6d', // ６四歩
        'FU:5c5d',
        'FU:7c7d',
        'KE:8a7c', // 桂を跳ねる
        'KA:2b3c', // ３三角
      ],
    },
    {
      name: '藤井システム風',
      moves: [
        'FU:3c3d',
        'FU:4c4d',
        'HI:8b4b',
        'GI:3a3b',
        'GI:3b4c',
        'FU:9c9d', // 端を早く
        'OU:5a6b',
        'KI:4a5b',
        'FU:6c6d',
        'FU:7c7d',
        'KE:8a7c', // 玉より先に桂を跳ねて攻めの形
        'OU:6b7b',
        'OU:7b8b',
        'GI:7a7b',
        'FU:1c1d',
        'FU:5c5d',
        'KA:2b3c',
      ],
    },
    {
      name: '振り飛車穴熊型',
      moves: [
        'FU:3c3d',
        'FU:4c4d',
        'HI:8b4b',
        'OU:5a6b',
        'OU:6b7b',
        'OU:7b8b',
        'KY:9a9b', // 香を上げて
        'OU:8b9a', // 穴熊
        'GI:7a8b', // 蓋をする
        'KI:4a5b',
        'KI:6a7a', // ７一金
        'GI:3a3b',
        'GI:3b4c',
        'FU:1c1d',
        'FU:5c5d',
        'FU:6c6d',
        'KA:2b3c',
      ],
    },
  ],
  reactions: COMMON_REACTIONS,
  planComments: {
    'FU:4c4d': '角道は止める。振り飛車は角交換を好まん。',
    'HI:8b4b': '飛車は４筋へ。四間飛車じゃ。',
    'OU:7b8b': '玉は８二。美濃囲いが見えてきたな。',
    'GI:7a7b': '美濃囲い、完成じゃ。横からの攻めには強いぞ。',
    'GI:3b4c': '４三銀。飛車の横に銀を添える。',
    'OU:8b9a': '穴熊じゃ。ここまで潜れば王手はかからん。',
    'KE:8a7c': '桂を跳ねた。こちらから仕掛けるぞ。',
  },
  badPatterns: COMMON_BAD,
  goodPatterns: [
    FUNAGAKOI,
    KYUSEN,
    MIGI_SHIKEN,
    ANAGUMA,
    bishopExchange('bishop-exchange', '角交換か。振り飛車は角交換を嫌う。角道を止められる前に決めたのは良い。'),
    edgeAttack('端を攻めるか。美濃囲いは横に強いが、端と上からは弱い。'),
    ...COMMON_GOOD,
  ],
  lessons: [
    '振り飛車には急戦か持久戦、方針を先に決めよ。中途半端が一番いかん。',
    '美濃囲いは横から攻めても崩れん。上から、端から攻めよ。',
    '居飛車なら舟囲い（▲７八玉・▲６八銀・▲５八金）が基本。まずここまで組め。',
    '角道を止めた相手に角交換はできん。飛車先の歩交換で圧をかけよ。',
    '振り飛車の弱点は角の頭と、飛車を振った側の薄さじゃ。',
  ],
  winLine: 'わしの美濃が…上から攻められると弱いのう。',
  loseLine: '振り飛車の捌きはこういうものじゃ。',
};
