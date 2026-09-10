import { el } from './dom';
import { miniBoard, positionAfter } from './miniboard';
import { safeMove, SHALLOW_DEPTH } from '../style/judge';
import { momentLabel, momentCaption, winProb, KeyMoment } from '../game/review';

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

  const fmt = (v: number | null): string => {
    if (v === null) return '?';
    if (Math.abs(v) > 3000) return v > 0 ? '先手の詰み筋' : '後手の詰み筋';
    return (v > 0 ? '+' : '') + String(v);
  };
  const pct = (v: number | null): string => (v === null ? '?' : `${Math.round(winProb(v))}%`);
  // 読みが浅かった数字は確かなものと思わせない（判定のカットインと同じ「目安」の添え書き）
  const note = typeof log.depth === 'number' && log.depth < SHALLOW_DEPTH ? `（読み ${log.depth} 手・目安）` : '';
  panel.append(el('div', 'moment-eval', `形勢（先手視点）: ${fmt(log.before)} → ${fmt(log.after)}　勝率 ${pct(log.before)} → ${pct(log.after)}${note}`));
  panel.append(el('p', 'moment-why', momentCaption(mo, opts)));
  if (mo.kind === 'blunder' && log.betterKanji) {
    panel.append(el('div', 'moment-better', `正解: ${log.betterKanji}${better ? '（指す前の盤に緑で表示）' : ''}`));
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
