import { el } from './dom';
import { miniBoard, positionAfter } from './miniboard';
import { safeMove, describeSide } from '../style/judge';
import { momentLabel, momentCaption, KeyMoment } from '../game/review';

export function reviewEvaluation(before: number | null, after: number | null): string {
  const side = (cp: number | null) => cp === null || !Number.isFinite(cp) ? '判定なし' : describeSide({ cp, mate: null });
  return `形勢の目安（先手視点）: ${side(before)} → ${side(after)}`;
}

export function renderMoment(momentEl: HTMLElement, moments: KeyMoment[], index: number, after = false, opts: { won?: boolean } = {}): void {
  const mo = moments[index];
  if (!mo) return;
  const log = mo.log;
  momentEl.innerHTML = '';
  const panel = el('div', 'panel');
  const head = el('div', 'moment-head');
  head.append(el('b', '', `${log.ply}手目 ${log.kanji}`));
  head.append(el('span', 'tag' + (mo.kind === 'blunder' ? (opts.won ? ' warn' : '') : ' good'), momentLabel(mo, opts)));
  panel.append(head);

  const before = positionAfter(log.movesBefore);
  const played = safeMove(before, log.usi);
  const better = log.betterUsi ? safeMove(before, log.betterUsi) : null;
  const boardWrap = el('div', 'big-board');
  if (after) {
    boardWrap.append(miniBoard(positionAfter([...log.movesBefore, log.usi]), played));
  } else {
    boardWrap.append(miniBoard(before, played, mo.kind === 'blunder' ? better : null));
  }
  boardWrap.querySelector('.mini-board')?.classList.add('large');
  panel.append(boardWrap);

  const toggle = el('div', 'seg');
  const b1 = el('button', 'seg-btn' + (after ? '' : ' on'), '指す前');
  const b2 = el('button', 'seg-btn' + (after ? ' on' : ''), '指した後');
  b1.addEventListener('click', () => renderMoment(momentEl, moments, index, false, opts));
  b2.addEventListener('click', () => renderMoment(momentEl, moments, index, true, opts));
  toggle.append(b1, b2);
  panel.append(toggle);

  // カットインと同じ言葉による表示。点数・換算勝率・深さは記録の選定と検証に使う。
  panel.append(el('div', 'moment-eval', reviewEvaluation(log.before, log.after)));
  panel.append(el('p', 'moment-why', momentCaption(mo, opts)));
  if (mo.kind === 'blunder' && log.betterKanji) {
    panel.append(el('div', 'moment-better', `候補の手: ${log.betterKanji}${better ? '（指す前の盤に緑で表示）' : ''}`));
  }

  const nav = el('div', 'btn-row');
  const prev = el('button', 'btn', '‹ 前の手');
  const next = el('button', 'btn', '次の手 ›');
  prev.disabled = index === 0;
  next.disabled = index === moments.length - 1;
  prev.addEventListener('click', () => renderMoment(momentEl, moments, index - 1, false, opts));
  next.addEventListener('click', () => renderMoment(momentEl, moments, index + 1, false, opts));
  nav.append(prev, next);
  panel.append(nav);
  const close = el('button', 'btn primary close', '閉じる');
  close.addEventListener('click', () => { momentEl.hidden = true; });
  panel.append(close);
  momentEl.append(panel);
  momentEl.hidden = false;
}
