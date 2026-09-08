// オジジ（後手）が指してくる戦法の定義。

import { Position } from '../engine/position';
import { BadPattern, GoodPattern } from './patterns';

export interface PlanVariant {
  name: string;
  moves: string[];
}

// 相手の仕掛けへの条件付きの受け。when が真なら moves を駒組みより先に試す
export interface Reaction {
  id: string;
  when: (pos: Position) => boolean;
  moves: string[]; // 優先順の「駒種:USI」
  tolerance?: number; // この受けだけ、最善より何点まで損しても指すか（戦法の看板になる手に使う）
}

export interface Style {
  id: string;
  name: string;
  description: string;
  // オジジの駒組み。対局ごとにどれか一つを選ぶ。
  // 各 plan は優先順に「駒種:USI」（例 'FU:8c8d'）で書く。合法で、エンジンが「損しない」と言えば上から順に指す
  plans: PlanVariant[];
  // 駒組みを最善より何点まで損しても続けるか（省略時は plan.ts の既定値）。攻め重視の戦法は大きめ
  planTolerance?: number;
  // 駒組みより優先する、よくある仕掛けへの受け（全 plan 共通）
  reactions?: Reaction[];
  // 駒組みの節目でオジジがつぶやく一言（plan の「駒種:USI」→ 台詞）
  planComments?: Record<string, string>;
  // この戦法相手にやってはいけない形（共通のものに加えて）
  badPatterns: BadPattern[];
  // この戦法相手の良い手の形（頷く）
  goodPatterns: GoodPattern[];
  // 対局後に一つだけ出す「この戦法との戦い方」（ランダムに選ぶ）
  lessons: string[];
  // 結果画面の一言
  winLine: string; // プレイヤーが勝ったとき
  loseLine: string; // プレイヤーが負けたとき
}
