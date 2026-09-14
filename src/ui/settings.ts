import { el } from './dom';
import { type Style } from '../style/types';
import { STYLES as ALL_STYLES, findStyle } from '../style';
import {
  type Progress, LEVELS, levelById, doneTaskSet, tasksFor, pickTask, badgesOf,
  BADGE_LABEL, promotionLine, KAIDEN_CONDITION,
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
    const tasks = tasksFor(style);
    // 現在ある課題だけを数える。旧版の達成記録は保存データから削除しない。
    const taskCount = tasks.filter((task) => done.has(`${style.id}:${task.id}`)).length;
    const taskText = `課題 ${taskCount}/${tasks.length}`;
    const recText = rec && rec.games > 0
      ? `<em>${rec.wins}勝 ${rec.games}局</em><em>${taskText}${rec.scolded > 0 ? `・ばかもん ${rec.scolded}回` : ''}</em>`
      : `<em>未対局・${taskText}</em>`;
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
    });
    rows.set(style.id, b);
    list.append(b);
  }
  s.append(list);

  // 一覧と重複しない、次の課題・皆伝の条件だけを小さくまとめる
  const preview = el('div', 'preview');
  const renderPreview = (): void => {
    const style = selected();
    preview.innerHTML = '';
    const rec = progress.styles[style.id];
    // 課題は対局数を種にして選ぶ（startGame と同じ計算。ここで見せた課題がそのまま対局に出る）
    preview.append(el('div', '', `次の課題: ${pickTask(style, done, rec?.games ?? 0).text}`));
    const have = badgesOf(progress, style.id);
    // 皆伝は最後の目標なので、初勝利や叱られず勝利を取る前からずっと見せておく
    if (!have.includes('kaiden')) preview.append(el('div', '', `皆伝: ${KAIDEN_CONDITION}`));
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
