import type { Position } from '../engine/position';
import type { Move, Sq, Color } from '../engine/types';
import type { Judge, JudgeState, Praise } from '../style/judge';
import type { Style, PlanVariant } from '../style/types';
import type { PlanState } from '../style/plan';
import type { Level, Task, GameResult } from './progress';
import type { MoveLog } from './review';

export interface Game {
  style: Style;
  pos: Position;
  judge: Judge;
  plan: PlanState;
  variant: PlanVariant; // 今局のオジジの組み方
  matta: number; // 待ったの回数
  scolded: number; // 段階 5「ばかもーん！」の回数
  badMoves: number; // 段階 4「それは悪手じゃろう」の回数
  hints: number; // ヒントを使った回数
  learned: Praise[];
  lastWhisper: number; // 最後に狙いをつぶやいた手数
  lastCheckMutter: number; // 最後に「王手じゃ」と言った手数
  lastMove: Move | null;
  lastMoveKanji: string; // 最終手の表記。指す前の局面で作る（「打」は同種の駒が動けるときだけ付くので、指した後では決められない）
  lastCaptureSq: Sq | null; // 直前のオジジの手が駒を取った地点（取っていなければ null）。プレイヤーの「取り返し」の記録に使う
  result: GameResult | null;
  busy: boolean; // オジジの思考中・演出中
  level: Level; // 難易度（オジジの強さ）
  task: Task; // 今日の課題
  logs: MoveLog[]; // 振り返り用の手の記録
  judgeStates: JudgeState[]; // 各手を指す前の Judge の記憶（待ったで戻すため。手が確定するたびに 1 つ積む）
  enteringNotified: Set<Color>; // 入玉の一言を出した側。待ったで戻しても繰り返さない
}
