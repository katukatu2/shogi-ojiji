import { el } from './dom';
import { miniBoard, positionAfter } from './miniboard';
import { safeMove } from '../style/judge';
import { BADGE_LABEL, titleOf, Progress, Promotion, GameResult as Result } from '../game/progress';
import { keyMoments, momentLabel, KeyMoment } from '../game/review';
import type { Game } from '../game/session';
import type { Expression } from './ojiji';

interface ResultView {
  game: Game; result: Result; progress: Progress;
  lastOutcome: { taskDone: boolean; promotion: Promotion | null; newBadges: string[] };
  faceInto(container: HTMLElement, expression: Expression): void;
  onReplay(): void; onChange(): void; onTitle(): void;
  onMoment(moments: KeyMoment[], index: number, after: boolean, opts: { won?: boolean }): void;
}

// 結果画面の朱印。免状と課題達成を、読ませずにひと目で見せる（iPhone で「文字ばかりで見栄えが悪い。
// 対局後に文字をいっぱい読ませるのは良くない」と指摘された）。印の文字は縦書きの列ごとに分け、右の列から読む。
// 「叱られず勝利」は一列に収まらず崩れて読めなかったので、3 文字 2 列にする
const STAMP_COLUMNS: Record<string, string[]> = {
  task: ['課題', '達成'],
  'first-win': ['初勝利'],
  'clean-win': ['叱られ', 'ず勝利'],
  kaiden: ['皆伝'],
};

export function renderResult({ game, result, progress, lastOutcome, faceInto, onReplay, onChange, onTitle, onMoment }: ResultView): HTMLElement {
  const panel = el('div', 'panel result');
  // オジジの顔と、その左右に押す朱印。印は免状を先に、課題達成を後に、右上・左上・右下・左下の順に押す
  const head = el('div', 'result-head');
  const face = el('div', 'face');
  faceInto(face, result === 'win' ? 'shocked' : 'normal');
  // 勝ち負けの反応は endGame で鳴らしてある（ここで鳴らすと二重になる）
  head.append(face);
  const stamps = [
    ...lastOutcome.newBadges.map((b) => ({ key: b, label: `免状「${BADGE_LABEL[b]}」` })),
    ...(lastOutcome.taskDone ? [{ key: 'task', label: '課題達成' }] : []),
  ];
  stamps.forEach((s, i) => {
    const d = el('div', `stamp ${i % 2 === 0 ? 'right' : 'left'} row${Math.floor(i / 2)}`);
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', s.label);
    d.style.setProperty('--i', String(i));
    for (const col of STAMP_COLUMNS[s.key] ?? [s.label]) d.append(el('span', '', col));
    head.append(d);
  });
  if (stamps.length > 2) head.classList.add('two-rows');
  panel.append(head);

  // オジジの一言は一つだけ（以前は勝ち負けの台詞と締めの一言を二行続けていた）
  const line = closingWord(game, result);
  // 負けたときの教えは長い。見出しの大きさのままだと文字の塊になるので、長い台詞は小さく組む
  panel.append(el('h2', line.length > 24 ? 'long' : '', line));
  // 皆伝を取ると称号が変わる。めったに無い大事な知らせなので文字で残す
  if (lastOutcome.newBadges.includes('kaiden')) panel.append(el('div', 'title-change', `称号: ${titleOf(progress)}`));
  // 回数は 0 のものを出さない。全部 0 なら行ごと出さない
  const counts = [['ばかもん', game.scolded], ['悪手', game.badMoves], ['ヒント', game.hints], ['待った', game.matta]] as const;
  const shown = counts.filter(([, n]) => n > 0).map(([name, n]) => `${name} ${n}`);
  if (shown.length > 0) panel.append(el('div', 'score', shown.join(' ／ ')));
  // 課題を達成したら朱印。未達成なら小さく一言だけ（課題の文は対局中に見ている）
  if (!lastOutcome.taskDone) panel.append(el('div', 'task-result', '課題は次回'));
  if (lastOutcome.promotion) {
    panel.append(el('div', 'promotion', `昇級じゃ。次から「${lastOutcome.promotion.to.name}」のオジジと指せ。`));
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
      const move = el('div', 'moment-move', `${mo.log.ply}手目 ${mo.log.kanji}`);
      // 札（好手・決め手など）は途中で折り返さず、まとまりで次の行へ送る
      if (mo.kind !== 'blunder') move.append(el('span', 'moment-label', `（${momentLabel(mo, reviewOpts)}）`));
      card.append(move);
      // 説明文はカードに出さない。文の長さでカードの高さが変わり、盤の位置が揃わなかった。
      // 説明はタップした拡大表示（ui/review.ts の moment-why）で読む
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

// 結果画面でオジジが言う一言。勝ちは戦法ごとの台詞だが、ヒントに頼りすぎたときはそれを言う。
// 負け・投了・引き分けは、次の一局に活かす教え
export function closingWord(g: Pick<Game, 'style' | 'pos' | 'hints' | 'scolded' | 'badMoves'>, result: Result): string {
  if (result === 'win') return g.hints >= 10 ? '……ヒントに頼りすぎじゃ。次は自力で来い。' : g.style.winLine;
  if (result === 'draw') return '負けはせんかったが、勝ちもせんかった。次は決めに来い。';
  if (g.scolded >= 3) return `気合いだけでは${g.style.name}は崩せん。相手の狙いを読んでから指せ。`;
  if (g.badMoves + g.scolded === 0) return '悪手はなかった。あとは勢いじゃ。もう一局どうじゃ。';
  const lessons = [
    ...g.style.lessons,
    ...(g.style.conditionalLessons ?? []).filter((lesson) => lesson.when(g.pos)).map((lesson) => lesson.text),
  ];
  return lessons[Math.floor(Math.random() * lessons.length)] ?? '次は相手の狙いを読んでから指すのじゃ。';
}
