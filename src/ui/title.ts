import { el } from './dom';
import type { Expression } from './ojiji';
import type { OjijiRig } from './rig';
import type { Style } from '../style/types';
import { STYLES as ALL_STYLES, findStyle } from '../style';
import { type Progress, levelById, titleOf, totals } from '../game/progress';

interface TitleView {
  progress: Progress; rig: OjijiRig; canSave: boolean; sourceUrl: string;
  faceInto(container: HTMLElement, expression: Expression): void;
  onStart(style: Style): void;
  onSettings(): void;
}

export function renderTitle({ progress, rig, canSave, sourceUrl, faceInto, onStart, onSettings }: TitleView): HTMLElement {
  const s = el('div', 'title-screen');
  // タイトルだけは全身。体は静止画（public/raizo/body.webp）で、その上に顔のリグを重ねる
  const face = el('div', 'face full');
  faceInto(face, 'normal');
  if (rig.available) {
    const body = new Image();
    body.className = 'body';
    body.alt = '';
    body.decoding = 'async';
    body.src = 'raizo/body.webp';
    // 体の画像が読めない環境では、体の分の空きを残さず顔だけにする
    body.addEventListener('error', () => {
      body.remove();
      face.classList.remove('full');
    });
    face.prepend(body);
  }
  rig.settle('idle');
  s.append(face);
  s.append(el('h1', '', '将棋オジジの定石指南'));
  s.append(el('p', 'sub', 'オジジの得意戦法を相手に、自由に指す。本当に悪い手だけ叱られる。'));

  const actions = el('div', 'title-actions');
  const last = progress.lastStyle ? findStyle(progress.lastStyle) : undefined;
  if (last) {
    const quick = el('button', 'btn primary big');
    quick.append(document.createTextNode('前回の設定で始める'));
    quick.append(el('small', '', `${last.name}・${levelById(progress.level).name}`));
    quick.addEventListener('click', () => {
      onStart(last);
    });
    const change = el('button', 'btn', '戦法・強さを変える');
    change.addEventListener('click', onSettings);
    actions.append(quick, change);
  } else {
    const start = el('button', 'btn primary big', 'はじめる');
    start.addEventListener('click', onSettings);
    actions.append(start);
  }
  s.append(actions);

  // 称号と通算。皆伝（戦法ごとに 1 つ）の数で称号が上がる
  const t = totals(progress);
  s.append(el('div', 'rank', `称号: ${titleOf(progress)}　${t.wins}勝 ${t.games}局・皆伝 ${t.kaiden}/${ALL_STYLES.length}`));
  if (!canSave) s.append(el('div', 'rank warn', 'この端末では成績を保存できない'));

  // 遊び方（折りたたみ。初回に一度読むもの）
  const how = el('details', 'howto');
  how.append(el('summary', '', '遊び方'));
  const ul = el('ul');
  for (const t of [
    'オジジは選んだ戦法で囲ってくる。あなたは先手で、好きなように指してよい。',
    '手の良し悪しはオジジの反応で分かる。無言の頷き ＞ 「良い手じゃな」 ＞ 「むう…」 ＞ 「それは悪手じゃろう」 ＞ 「ばかもーん！」。下の二つは指し直せる。',
    '判定は将棋エンジン（やねうら王）。勝っているうちは細かいことを言わず、本当に形勢が崩れる手だけ止める。',
    '「ヒント」でオジジならどう指すかを見られる。「待った」で一組戻せる。',
    '駒をタップして選び、行き先をタップ。持ち駒は下の列から。',
  ]) ul.append(el('li', '', t));
  how.append(ul);
  s.append(how);
  const credit = el('p', 'credit');
  credit.append(document.createTextNode('将棋エンジン: やねうら王 WebAssembly 版（GPLv3）／ 評価関数: 水匠 Petite'));
  credit.append(el('br'));
  credit.append(document.createTextNode('駒音: 無料効果音で遊ぼう！（小森平）　'));
  const link = el('a', '', 'https://taira-komori.net/');
  link.setAttribute('href', 'https://taira-komori.net/');
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener');
  credit.append(link);
  // ライセンスとソースの公開先、プライバシーポリシー（public/privacy.html）
  credit.append(el('br'));
  credit.append(document.createTextNode('ライセンス: GPLv3'));
  credit.append(el('br'));
  credit.append(document.createTextNode('ソースコード（'));
  if (/^https?:\/\//.test(sourceUrl)) {
    const src = el('a', '', sourceUrl);
    src.setAttribute('href', sourceUrl);
    src.setAttribute('target', '_blank');
    src.setAttribute('rel', 'noopener');
    credit.append(src);
  } else {
    credit.append(document.createTextNode('公開準備中'));
  }
  credit.append(document.createTextNode('）／ '));
  const privacy = el('a', '', 'プライバシーポリシー');
  privacy.setAttribute('href', './privacy.html');
  credit.append(privacy);
  s.append(credit);

  return s;
}
