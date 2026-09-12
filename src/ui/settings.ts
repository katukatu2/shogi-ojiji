import { el } from './dom';
import { miniBoard } from './miniboard';
import { formationOf } from '../game/formation';
import { type Style } from '../style/types';
import { STYLES as ALL_STYLES, findStyle } from '../style';
import {
  type Progress, LEVELS, levelById, doneTaskSet, pickTask, badgesOf,
  BADGE_IDS, BADGE_LABEL, BADGE_CONDITION, promotionLine, KAIDEN_CONDITION,
} from '../game/progress';

const STYLES: { style: Style | null; name: string; desc: string }[] = ALL_STYLES.map((s) => ({
  style: s,
  name: s.name,
  desc: s.description,
}));

interface SettingsView {
  progress: Progress;
  selectedStyleId: string | null;
  onSelectStyle(id: string): void;
  onProgressChange(): void;
  onTitle(): void;
  onStart(style: Style): void;
}

export function renderSettings({ progress, selectedStyleId, onSelectStyle, onProgressChange, onTitle, onStart }: SettingsView): HTMLElement {
  let pendingStyleId = selectedStyleId;
  const s = el('div', 'settings-screen');

  const head = el('div', 'settings-head');
  const back = el('button', 'back', '‹ タイトル');
  back.addEventListener('click', onTitle);
  head.append(back, el('h2', '', '対局設定'), el('span'));
  s.append(head);

  // 強さ
  const levelBox = el('div', 'level-box');
  const renderLevels = (): void => {
    levelBox.innerHTML = '';
    levelBox.append(el('div', 'level-title', 'オジジの強さ'));
    const row = el('div', 'level-row');
    for (const lv of LEVELS) {
      const b = el('button', 'level-btn' + (lv.id === progress.level ? ' on' : ''), lv.name);
      b.addEventListener('click', () => {
        progress.level = lv.id;
        onProgressChange();
        renderLevels();
        renderFoot();
      });
      row.append(b);
    }
    levelBox.append(row);
    // 昇級までに何が要るか（師範代なら上は無い）。強さは今まで通り自由に選べる
    levelBox.append(el('div', 'level-next', promotionLine(progress) ?? '師範代が最高じゃ'));
  };
  s.append(levelBox);

  // 戦法
  const done = doneTaskSet(progress);
  if (!pendingStyleId || !findStyle(pendingStyleId)) {
    pendingStyleId = progress.lastStyle && findStyle(progress.lastStyle) ? progress.lastStyle : ALL_STYLES[0].id;
  }
  const selected = (): Style => findStyle(pendingStyleId!) ?? ALL_STYLES[0];
  s.append(el('div', 'section-title', 'オジジの戦法'));
  const list = el('div', 'joseki-list');
  const rows = new Map<string, HTMLElement>();
  for (const j of STYLES) {
    if (!j.style) continue;
    const style = j.style;
    const b = el('button', 'joseki-btn');
    const rec = progress.styles[style.id];
    const taskCount = [...done].filter((k) => k.startsWith(style.id + ':')).length;
    const recText = rec && rec.games > 0
      ? `<em>${rec.wins}勝 ${rec.games}局</em>${rec.scolded > 0 ? `<em>ばかもん ${rec.scolded}回</em>` : `<em>課題 ${taskCount}</em>`}`
      : '<em>未対局</em>';
    // 取った免状（初勝利・叱られず勝利・皆伝）は小さな札で並べる。無ければ何も出さない
    const badges = badgesOf(progress, style.id);
    const badgeText = badges.length > 0 ? `<span class="badges">${badges.map((id) => `<em class="badge">${BADGE_LABEL[id]}</em>`).join('')}</span>` : '';
    b.innerHTML = `<span class="jn"><b>${j.name}</b><span class="jd">${j.desc}</span></span><span class="jr">${recText}${badgeText}</span>`;
    b.addEventListener('click', () => {
      pendingStyleId = style.id;
      onSelectStyle(style.id);
      for (const [id, r] of rows) r.classList.toggle('on', id === style.id);
      renderPreview();
      renderFoot();
      preview.scrollIntoView({ block: 'nearest' }); // 囲いと課題が見える位置まで
    });
    rows.set(style.id, b);
    list.append(b);
  }
  s.append(list);

  // 選んだ戦法の囲い・成績・次の課題
  const preview = el('div', 'preview');
  const renderPreview = (): void => {
    const style = selected();
    preview.innerHTML = '';
    preview.append(miniBoard(formationOf(style)));
    const text = el('div', 'ptext');
    text.append(el('b', '', `${style.name}の駒組み`));
    text.append(el('div', '', style.plans[0]?.name ? `まずは${style.plans[0].name}。対局ごとに形を変えてくる。` : ''));
    const rec = progress.styles[style.id];
    text.append(el('div', 'pline', rec && rec.games > 0 ? `成績: ${rec.wins}勝 ${rec.games}局・ばかもん ${rec.scolded}回` : '成績: まだ指していない'));
    // 課題は対局数を種にして選ぶ（startGame と同じ計算。ここで見せた課題がそのまま対局に出る）
    text.append(el('div', 'pline', `次の課題: ${pickTask(style, done, rec?.games ?? 0).text}`));
    // 次に取れる免状の条件（全部取っていれば出さない）
    const have = badgesOf(progress, style.id);
    const nextBadge = BADGE_IDS.find((id) => !have.includes(id) && id !== 'kaiden');
    if (nextBadge) text.append(el('div', 'pline', `次の免状: ${BADGE_CONDITION[nextBadge]}`));
    // 皆伝は最後の目標なので、初勝利や叱られず勝利を取る前からずっと見せておく
    if (!have.includes('kaiden')) text.append(el('div', 'pline', `皆伝: ${KAIDEN_CONDITION}`));
    preview.append(text);
  };
  s.append(preview);

  // 下に固定の開始ボタン
  const foot = el('div', 'settings-foot');
  const go = el('button', 'btn primary big');
  const renderFoot = (): void => {
    go.innerHTML = '';
    go.append(document.createTextNode('この設定で対局'));
    go.append(el('small', '', `${selected().name}・${levelById(progress.level).name}`));
  };
  go.addEventListener('click', () => {
    onStart(selected());
  });
  foot.append(go);
  s.append(foot);

  renderLevels();
  for (const [id, r] of rows) r.classList.toggle('on', id === pendingStyleId);
  renderPreview();
  renderFoot();
  return s;
}
