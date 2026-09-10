import { el } from './dom';
import { miniBoard, positionAfter } from './miniboard';
import { safeMove } from '../style/judge';
import { BADGE_LABEL, titleOf, Progress, Promotion, GameResult as Result } from '../game/progress';
import { keyMoments, momentLabel, momentCaption, KeyMoment } from '../game/review';
import type { Game } from '../game/session';
import type { Expression } from './ojiji';

interface ResultView {
  game: Game; result: Result; progress: Progress;
  lastOutcome: { taskDone: boolean; promotion: Promotion | null; newBadges: string[] };
  faceInto(container: HTMLElement, expression: Expression): void;
  onReplay(): void; onChange(): void; onTitle(): void;
  onMoment(moments: KeyMoment[], index: number, after: boolean, opts: { won?: boolean }): void;
}

export function renderResult({ game, result, progress, lastOutcome, faceInto, onReplay, onChange, onTitle, onMoment }: ResultView): HTMLElement {
  const panel = el('div', 'panel result');
  const titles: Record<Result, string> = {
    win: game.style.winLine,
    lose: game.style.loseLine,
    resign: '投了か。潔いのは悪くない。',
    draw: '引き分けか。仕切り直しじゃ。',
  };
  const face = el('div', 'face');
  faceInto(face, result === 'win' ? 'shocked' : 'normal');
  // 勝ち負けの反応は endGame で鳴らしてある（ここで鳴らすと二重になる）
  panel.append(face);
  panel.append(el('h2', '', titles[result]));
  panel.append(el('p', 'oneword', closingWord(game, result)));
  const score = el('div', 'score');
  score.textContent = `ばかもん ${game.scolded} ／ 悪手 ${game.badMoves} ／ ヒント ${game.hints} ／ 待った ${game.matta}`;
  panel.append(score);

  // 今日の課題
  const task = el('div', 'task-result' + (lastOutcome.taskDone ? ' done' : ''));
  task.textContent = `${lastOutcome.taskDone ? '課題達成' : '課題は次回'}: ${game.task.text}`;
  panel.append(task);
  if (lastOutcome.promotion) {
    panel.append(el('div', 'promotion', `昇級じゃ。次から「${lastOutcome.promotion.to.name}」のオジジと指せ。`));
  }
  // この一局で取った免状。皆伝なら称号も変わるので添える
  for (const b of lastOutcome.newBadges) {
    const line = el('div', 'badge-new', `免状じゃ。「${BADGE_LABEL[b]}」`);
    if (b === 'kaiden') line.append(el('small', '', `称号: ${titleOf(progress)}`));
    panel.append(line);
  }

  // 振り返り: 形勢が最も動いた 3 手（勝った対局は決め手 1 つと、ヒヤリとした手を最大 2 つ）
  const reviewOpts = { won: result === 'win' };
  const moments = keyMoments(game.logs, 3, reviewOpts);
  if (moments.length > 0) {
    const h3 = el('h3', '', '今日の 3 手');
    h3.append(el('small', '', 'タップで拡大'));
    panel.append(h3);
    const row = el('div', 'moments');
    moments.forEach((mo, i) => {
      const card = el('button', 'moment' + (mo.kind === 'good' || mo.kind === 'decisive' ? ' good' : ''));
      const pos = positionAfter(mo.log.movesBefore);
      const played = safeMove(pos, mo.log.usi);
      card.append(miniBoard(pos, played));
      const suffix = mo.kind === 'blunder' ? '' : `（${momentLabel(mo, reviewOpts)}）`;
      card.append(el('div', 'moment-move', `${mo.log.ply}手目 ${mo.log.kanji}${suffix}`));
      card.append(el('div', 'moment-text', momentCaption(mo, reviewOpts)));
      card.addEventListener('click', () => onMoment(moments, i, false, reviewOpts));
      row.append(card);
    });
    panel.append(row);
  }

  // 対局後の動線: 同じ設定で再戦が主。戦法を変えるなら設定へ、タイトルは明示したときだけ
  const row = el('div', 'btn-row stack');
  const again = el('button', 'btn primary', '同じ設定でもう一局');
  const change = el('button', 'btn', '戦法を変える');
  const title = el('button', 'btn', 'タイトルへ');
  again.addEventListener('click', onReplay);
  change.addEventListener('click', onChange);
  title.addEventListener('click', onTitle);
  row.append(again, change, title);
  panel.append(row);
  return panel;
}

export function closingWord(g: Pick<Game, 'style' | 'pos' | 'hints' | 'scolded' | 'badMoves'>, result: Result): string {
  if (result === 'win') {
    if (g.hints >= 10) return '……ヒントに頼りすぎじゃ。次は自力で来い。';
    if (g.scolded === 0 && g.badMoves === 0) return '文句のつけようがない。見事じゃった。';
    return 'まあ、勝ちは勝ちじゃ。次も来い。';
  }
  if (result === 'draw') return '負けはせんかったが、勝ちもせんかった。次は決めに来い。';
  if (g.scolded >= 3) return `気合いだけでは${g.style.name}は崩せん。相手の狙いを読んでから指せ。`;
  if (g.badMoves + g.scolded === 0) return '悪手はなかった。あとは勢いじゃ。もう一局どうじゃ。';
  const lessons = [
    ...g.style.lessons,
    ...(g.style.conditionalLessons ?? []).filter((lesson) => lesson.when(g.pos)).map((lesson) => lesson.text),
  ];
  return lessons[Math.floor(Math.random() * lessons.length)] ?? '次は相手の狙いを読んでから指すのじゃ。';
}
