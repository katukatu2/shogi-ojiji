// 対局設定の画面で見せる「オジジの囲いの形」。
// 戦法の最初の駒組み（plans[0]）を、オジジ（後手）の手だけ順に指して作る。プレイヤーの手は無いものとし、
// 相手の駒が絡んで合法にならない手（角交換など）は飛ばす。対局の再現ではなく、形を見せるための盤面。
import { Position } from '../engine/position';
import { Style } from '../style/types';
import { planKey } from '../style/plan';

export function formationOf(style: Style): Position {
  const pos = Position.initial();
  const plan = style.plans[0]?.moves ?? [];
  for (const entry of plan) {
    pos.turn = 1;
    const m = pos.legalMoves().find((l) => planKey(l) === entry);
    if (m) pos.apply(m);
  }
  pos.turn = 1;
  return pos;
}
