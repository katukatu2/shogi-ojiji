import { Position } from './engine/position';
import { Move, HandPiece, HAND_ORDER, PIECE_KANJI, PIECE_NAME, PIECE_VALUE, Sq, sqEq, Color } from './engine/types';
import { moveToKanji, moveToUsi, sqToKanji } from './engine/notation';
import { chooseMove } from './ai/search';
import { Engine, engineSupported, browserEngineFactory, Analysis } from './ai/engine';
import { Judge, Verdict, Praise, Judgement, safeMove, bestCaptureGain } from './style/judge';
import { Style, PlanVariant } from './style/types';
import { STYLES as ALL_STYLES, findStyle } from './style/index';
import { formationOf } from './game/formation';
import { choosePlanMove, planApplies, planKey, PlanState } from './style/plan';
import { ojijiSvg, Expression } from './ui/ojiji';
import { OjijiRig, RigState } from './ui/rig';
import { LEVELS, Level, levelById, loadProgress, saveProgress, pickTask, doneTaskSet, recordGame, Task, Promotion } from './game/progress';
import { keyMoments, momentCaption, MoveLog, KeyMoment } from './game/review';
import { miniBoard, positionAfter } from './ui/miniboard';
import { playThunder, playPiece, stopSfx, setMuted, isMuted, warmUp, sfxElementForDebug, pieceElementForDebug } from './ui/audio';

const STYLES: { style: Style | null; name: string; desc: string }[] = ALL_STYLES.map((s) => ({
  style: s,
  name: s.name,
  desc: s.description,
}));

const PROMOTED = new Set(['TO', 'NY', 'NK', 'NG', 'UM', 'RY']);
const FILE_LABELS = ['９', '８', '７', '６', '５', '４', '３', '２', '１'];
const RANK_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];


type Result = 'win' | 'lose' | 'resign';

interface Game {
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
  result: Result | null;
  busy: boolean; // オジジの思考中・演出中
  level: Level; // 難易度（オジジの強さ）
  task: Task; // 今日の課題
  logs: MoveLog[]; // 振り返り用の手の記録
}

const app = document.getElementById('app')!;
let game: Game | null = null;

// ===== オジジ（雷蔵）のアニメーション =====
// <raizo-rig> は 1 つだけ作り、タイトル・対局・カットイン・結果の間で移動して使う。
// 素材が読めない環境では SVG の顔にフォールバックする。
const rig = new OjijiRig();
rig.onFail = (parent) => {
  // 顔素材が読めなかった。今の置き場に SVG の顔を出す
  if (parent) parent.innerHTML = ojijiSvg('normal', { piece: parent.classList.contains('full') });
};

// 顔を容器に出す。rig があれば要素を移動、無ければ SVG
function faceInto(container: HTMLElement, expr: Expression): void {
  if (rig.available) {
    container.innerHTML = '';
    rig.mount(container);
  } else {
    container.innerHTML = ojijiSvg(expr, { piece: expr === 'normal' });
  }
}

// 何も起きていないときのオジジの状態
function baseState(): RigState {
  return game && !game.result && game.busy && game.pos.turn === 1 ? 'thinking' : 'idle';
}

// ===== 成績・難易度（端末に保存）=====
let progress = loadProgress();

// ===== エンジン（やねうら王 WASM）=====
type EngineState = 'idle' | 'loading' | 'ready' | 'unavailable';
let engine: Engine | null = null;
let engineState: EngineState = 'idle';

function ensureEngine(): void {
  if (engineState !== 'idle') return;
  const factory = browserEngineFactory();
  if (!engineSupported() || !factory) {
    engineState = 'unavailable';
    showEngineNotice();
    return;
  }
  engineState = 'loading';
  const threads = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
  const e = new Engine(factory, threads);
  e.init()
    .then(() => {
      engine = e;
      engineState = 'ready';
      if (game) {
        game.judge.setEvaluator(e);
        if (game.pos.turn === 0) game.judge.prefetch(game.pos);
      }
    })
    .catch((err) => {
      console.warn('engine init failed', err);
      engineState = 'unavailable';
    })
    .finally(() => {
      updateEngineLabel();
      if (engineState === 'unavailable') showEngineNotice();
    });
}

// エンジンが使えない環境では、その旨を一度だけ知らせる（判定は簡易版に切り替わる）
let engineNoticeShown = false;
function showEngineNotice(): void {
  if (engineNoticeShown) return;
  engineNoticeShown = true;
  const box = el('div', 'engine-notice');
  box.append(el('b', '', '将棋エンジンが使えない環境です'));
  box.append(el('p', '', 'このブラウザでは形勢判定のエンジンが動かないため、駒損と一手詰めだけを見る簡易判定で進めます。最新の Chrome / Edge / Firefox、または Android アプリ版なら本来の判定が使えます。'));
  const ok = el('button', 'btn primary', 'わかった');
  ok.addEventListener('click', () => box.remove());
  box.append(ok);
  document.body.append(box);
}

// 選択状態
let selectedSq: Sq | null = null;
let selectedHand: HandPiece | null = null;
let hintMove: Move | null = null;
let legalCache: Move[] = [];
let nodTimer: number | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ===== 画面遷移と「戻る」 =====
// 画面は タイトル(0) → 対局設定(1) → 対局(2) の深さで履歴に積む。
// ブラウザやスマートフォンの「戻る」は popstate で受け、画面ごとの規則で処理する
// （設定→タイトル、対局中→確認してからタイトル、結果→タイトル）。Capacitor の Android は WebView が戻れる間は
// 戻る操作を WebView に渡すので、同じ道を通る。
// アプリ内のボタンで浅い画面へ行くときは、その分だけ履歴を戻し、そのとき届く popstate は無視する。
type ScreenName = 'title' | 'settings' | 'game';
const SCREEN_DEPTH: Record<ScreenName, number> = { title: 0, settings: 1, game: 2 };
let screen: ScreenName = 'title';
let depth = 0; // 積んである履歴の数
let ignorePops = 0; // 自分で戻した分の popstate を読み飛ばす

function goToScreen(name: ScreenName): void {
  const want = SCREEN_DEPTH[name];
  screen = name;
  if (want > depth) {
    for (; depth < want; depth++) history.pushState({ ojiji: depth + 1 }, '');
  } else if (want < depth) {
    ignorePops += depth - want;
    history.go(want - depth);
    depth = want;
  }
}

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  depth = Math.max(0, depth - 1);
  if (screen === 'settings') {
    showTitle();
    return;
  }
  if (screen === 'game') {
    if (game && !game.result) {
      if (confirm('対局を中断してタイトルに戻りますか？')) showTitle();
      else goToScreen('game'); // 押し戻す
      return;
    }
    showTitle();
  }
});

// ===== タイトル =====
// タイトルは、オジジ・題名・一言・ボタン・遊び方だけ。強さと戦法は「対局設定」で選ぶ。
// 2 回目以降は「前回の設定で始める」で 1 タップで対局に入れる
function showTitle(): void {
  stopSfx();
  game = null;
  goToScreen('title');
  app.innerHTML = '';
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
    face.prepend(body);
  }
  rig.settle('idle');
  s.append(face);
  s.append(el('h1', '', '将棋オジジの定石指南（仮）'));
  s.append(el('p', 'sub', 'オジジの得意戦法を相手に、自由に指す。本当に悪い手だけ叱られる。'));

  const actions = el('div', 'title-actions');
  const last = progress.lastStyle ? findStyle(progress.lastStyle) : undefined;
  if (last) {
    const quick = el('button', 'btn primary big');
    quick.append(document.createTextNode('前回の設定で始める'));
    quick.append(el('small', '', `${last.name}・${levelById(progress.level).name}`));
    quick.addEventListener('click', () => {
      warmUp();
      startGame(last);
    });
    const change = el('button', 'btn', '戦法・強さを変える');
    change.addEventListener('click', showSettings);
    actions.append(quick, change);
  } else {
    const start = el('button', 'btn primary big', 'はじめる');
    start.addEventListener('click', showSettings);
    actions.append(start);
  }
  s.append(actions);

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
  s.append(credit);

  app.append(s);
  ensureEngine();
}

// ===== 対局設定 =====
// 強さと戦法を選ぶ。前回の戦法が選択済みで開き、そのまま「この設定で対局」で始められる。
// 選んだ戦法の囲いの形・成績・次の課題を見せて、選ぶ理由を作る
let pendingStyleId: string | null = null;

function showSettings(): void {
  stopSfx();
  game = null;
  goToScreen('settings');
  app.innerHTML = '';
  const s = el('div', 'settings-screen');

  const head = el('div', 'settings-head');
  const back = el('button', 'back', '‹ タイトル');
  back.addEventListener('click', showTitle);
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
        saveProgress(progress);
        renderLevels();
        renderFoot();
      });
      row.append(b);
    }
    levelBox.append(row);
    levelBox.append(el('div', 'level-desc', levelById(progress.level).description));
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
    b.innerHTML = `<span class="jn"><b>${j.name}</b><span class="jd">${j.desc}</span></span><span class="jr">${recText}</span>`;
    b.addEventListener('click', () => {
      pendingStyleId = style.id;
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
    text.append(el('div', 'pline', `次の課題: ${pickTask(style, done).text}`));
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
    warmUp();
    startGame(selected());
  });
  foot.append(go);
  s.append(foot);

  renderLevels();
  for (const [id, r] of rows) r.classList.toggle('on', id === pendingStyleId);
  renderPreview();
  renderFoot();
  app.append(s);
  ensureEngine();
}

// ===== 対局 =====
function startGame(style: Style): void {
  stopSfx();
  ensureEngine();
  progress.lastStyle = style.id;
  pendingStyleId = style.id;
  saveProgress(progress);
  goToScreen('game');
  game = {
    style,
    pos: Position.initial(),
    judge: new Judge(engine, { bad: style.badPatterns, good: style.goodPatterns }),
    plan: { done: new Set() },
    variant: style.plans[Math.floor(Math.random() * style.plans.length)],
    matta: 0,
    scolded: 0,
    badMoves: 0,
    hints: 0,
    learned: [],
    lastWhisper: -100,
    lastCheckMutter: -100,
    lastMove: null,
    result: null,
    busy: false,
    level: levelById(progress.level),
    task: pickTask(style, doneTaskSet(progress)),
    logs: [],
  };
  selectedSq = null;
  selectedHand = null;
  hintMove = null;
  buildGameScreen();
  render();
  game.judge.prefetch(game.pos);
}

let boardEl: HTMLElement;
let handEls: [HTMLElement, HTMLElement];
let lastMoveEl: HTMLElement;
let scoldEl: HTMLElement;
let moveNoEl: HTMLElement;
let engineEl: HTMLElement | null = null;
let stageFaceEl: HTMLElement | null = null;
let lastOutcome: { taskDone: boolean; promotion: Promotion | null } = { taskDone: false, promotion: null };
let toastSerial = 0;
let cutinEl: HTMLElement;
let nodEl: HTMLElement;
let promoEl: HTMLElement;
let resultEl: HTMLElement;
let momentEl: HTMLElement;

function updateEngineLabel(): void {
  if (!engineEl) return;
  const text: Record<EngineState, string> = {
    idle: '',
    loading: '判定: 準備中…',
    ready: '判定: エンジン',
    unavailable: '判定: 簡易',
  };
  engineEl.textContent = text[engineState];
  engineEl.title = engineState === 'unavailable'
    ? 'この環境では将棋エンジンが使えないため、駒損と一手詰めだけを判定します'
    : 'やねうら王（WebAssembly 版）で形勢を判定しています';
}

function buildGameScreen(): void {
  app.innerHTML = '';
  const g = el('div', 'game');

  const top = el('div', 'topbar');
  top.append(el('div', 'title', `対 ${game!.style.name}・${game!.level.name}`));
  const status = el('div', 'status');
  moveNoEl = el('span', '', '1手目');
  scoldEl = el('span', 'scold', '叱られ 0回');
  engineEl = el('span', 'engine', '');
  const mute = el('button', '', isMuted() ? '🔇' : '🔊');
  mute.addEventListener('click', () => {
    setMuted(!isMuted());
    mute.textContent = isMuted() ? '🔇' : '🔊';
  });
  status.append(moveNoEl, scoldEl, engineEl, mute);
  top.append(status);
  g.append(top);
  updateEngineLabel();

  // 最終手と課題を 1 行に。課題は長ければ省略し、タップで全文を開く
  const info = el('div', 'infoline');
  lastMoveEl = el('div', 'lastmove', '');
  const taskChip = el('button', 'task-chip', `課題: ${game!.task.text}`);
  taskChip.title = game!.task.text;
  taskChip.addEventListener('click', () => taskChip.classList.toggle('open'));
  info.append(lastMoveEl, taskChip);
  g.append(info);

  // 相手（オジジ）の行: 顔・持ち駒・吹き出し。吹き出しは行の上に重ねて出し、場所を取らない
  const goteRow = el('div', 'hand gote');
  const avatar = el('div', 'avatar');
  stageFaceEl = avatar;
  faceInto(avatar, 'normal');
  rig.settle('idle');
  nodEl = el('div', 'bubble');
  nodEl.hidden = true;
  turnId = 0;
  lineTurn = -1;
  const goteHand = el('div', 'hp-list');
  goteRow.append(avatar, goteHand, nodEl);
  g.append(goteRow);

  const wrap = el('div', 'board-wrap');
  const files = el('div', 'files');
  for (const f of FILE_LABELS) files.append(el('span', '', f));
  wrap.append(files);
  const row = el('div', 'board-row');
  boardEl = el('div', 'board');
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const c = el('div', 'cell');
      c.dataset.x = String(x);
      c.dataset.y = String(y);
      c.addEventListener('click', () => onCellTap(x, y));
      boardEl.append(c);
    }
  }
  row.append(boardEl);
  const ranks = el('div', 'ranks');
  for (const r of RANK_LABELS) ranks.append(el('span', '', r));
  row.append(ranks);
  wrap.append(row);
  g.append(wrap);

  const senteRow = el('div', 'hand sente');
  const senteHand = el('div', 'hp-list');
  senteRow.append(senteHand);
  g.append(senteRow);
  handEls = [senteHand, goteHand];

  const controls = el('div', 'controls');
  const resign = el('button', '', '投了する');
  resign.addEventListener('click', () => {
    if (!game || game.result || game.busy) return;
    if (confirm('投了しますか？')) endGame('resign');
  });
  const quit = el('button', '', 'タイトルへ');
  quit.addEventListener('click', () => {
    if (!game || game.result || confirm('対局を中断してタイトルに戻りますか？')) showTitle();
  });
  const hint = el('button', '', 'ヒント');
  hint.title = 'オジジならどう指すかを盤面に緑で示す';
  hint.addEventListener('click', () => void showHint());
  const matta = el('button', '', '待った');
  matta.title = '自分の手とオジジの手を一組戻す';
  matta.addEventListener('click', takeBack);
  controls.append(hint, matta, resign, quit);
  g.append(controls);

  cutinEl = el('div', 'overlay cutin');
  cutinEl.hidden = true;
  promoEl = el('div', 'overlay');
  promoEl.hidden = true;
  momentEl = el('div', 'overlay moment-view');
  momentEl.hidden = true;
  g.append(momentEl);
  resultEl = el('div', 'overlay');
  resultEl.hidden = true;
  g.append(cutinEl, promoEl, resultEl);

  app.append(g);
}

function render(): void {
  if (!game) return;
  const pos = game.pos;
  legalCache = pos.turn === 0 && !game.result ? pos.legalMoves() : [];
  const inCheck = pos.inCheck(pos.turn);
  const king = inCheck ? pos.findKing(pos.turn) : null;

  const targets = new Set<string>();
  if (selectedSq) {
    for (const m of legalCache) if (m.from && sqEq(m.from, selectedSq)) targets.add(`${m.to.x},${m.to.y}`);
  } else if (selectedHand) {
    for (const m of legalCache) if (!m.from && m.piece === selectedHand) targets.add(`${m.to.x},${m.to.y}`);
  }

  for (const cell of Array.from(boardEl.children) as HTMLElement[]) {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    cell.className = 'cell';
    cell.innerHTML = '';
    const p = pos.get(x, y);
    if (p) {
      const pe = el('div', 'piece' + (p.color === 1 ? ' gote' : '') + (PROMOTED.has(p.type) ? ' promoted' : ''));
      pe.textContent = PIECE_KANJI[p.type];
      cell.append(pe);
    }
    if (game.lastMove && sqEq(game.lastMove.to, { x, y })) cell.classList.add('last');
    if (selectedSq && sqEq(selectedSq, { x, y })) cell.classList.add('sel');
    if (targets.has(`${x},${y}`)) {
      cell.classList.add('target');
      if (p) cell.classList.add('capture');
    }
    if (hintMove && (sqEq(hintMove.to, { x, y }) || sqEq(hintMove.from, { x, y }))) cell.classList.add('hint');
    if (king && sqEq(king, { x, y })) cell.classList.add('check');
  }

  for (const color of [0, 1] as Color[]) {
    const h = handEls[color];
    h.innerHTML = '';
    h.append(el('span', 'label', color === 0 ? 'あなたの持ち駒' : '持ち駒'));
    for (const hp of HAND_ORDER) {
      const n = pos.hands[color][hp];
      if (n <= 0) continue;
      const d = el('div', 'hp' + (color === 1 ? ' gote-piece' : ''));
      d.textContent = PIECE_KANJI[hp];
      if (n > 1) d.append(el('span', 'n', String(n)));
      if (color === 0 && selectedHand === hp) d.classList.add('sel');
      if (color === 0) d.addEventListener('click', () => onHandTap(hp));
      h.append(d);
    }
  }

  moveNoEl.textContent = `${pos.moves.length + 1}手目`;
  scoldEl.textContent = `叱られ ${game.scolded}回`;

  if (game.busy && !game.result && cutinEl.hidden) {
    const prev = pos.moves.length >= 2 ? pos.moves[pos.moves.length - 2] : null;
    lastMoveEl.textContent = game.lastMove ? `${moveToKanji(game.lastMove, (1 - pos.turn) as Color, prev)}　…` : '…';
  } else if (game.lastMove) {
    const prev = pos.moves.length >= 2 ? pos.moves[pos.moves.length - 2] : null;
    const color = (1 - pos.turn) as Color;
    lastMoveEl.textContent = moveToKanji(game.lastMove, color, prev);
    if (inCheck) lastMoveEl.append(el('span', 'check', '王手！'));
  } else {
    lastMoveEl.textContent = '先手番（あなた）';
  }
}

function onCellTap(x: number, y: number): void {
  if (!game || game.busy || game.result || game.pos.turn !== 0) return;
  const pos = game.pos;
  const p = pos.get(x, y);

  // 打つ
  if (selectedHand) {
    const m = legalCache.find((l) => !l.from && l.piece === selectedHand && l.to.x === x && l.to.y === y);
    if (m) {
      selectedHand = null;
      void tryMove(m);
      return;
    }
  }
  // 移動
  if (selectedSq) {
    const cands = legalCache.filter((l) => l.from && sqEq(l.from, selectedSq) && l.to.x === x && l.to.y === y);
    if (cands.length > 0) {
      selectedSq = null;
      if (cands.length === 1) {
        void tryMove(cands[0]);
      } else {
        askPromotion(cands);
      }
      return;
    }
  }
  // 選択の切り替え
  selectedHand = null;
  if (p && p.color === 0) {
    selectedSq = selectedSq && sqEq(selectedSq, { x, y }) ? null : { x, y };
  } else {
    selectedSq = null;
  }
  render();
}

function onHandTap(hp: HandPiece): void {
  if (!game || game.busy || game.result || game.pos.turn !== 0) return;
  selectedSq = null;
  selectedHand = selectedHand === hp ? null : hp;
  render();
}

function askPromotion(cands: Move[]): void {
  const promote = cands.find((m) => m.promote)!;
  const stay = cands.find((m) => !m.promote)!;
  promoEl.innerHTML = '';
  const panel = el('div', 'panel promo');
  panel.append(el('h2', '', '成りますか？'));
  const row = el('div', 'btn-row');
  const b1 = el('button', 'btn primary', '成る');
  const b2 = el('button', 'btn', '成らない');
  b1.addEventListener('click', () => { promoEl.hidden = true; void tryMove(promote); });
  b2.addEventListener('click', () => { promoEl.hidden = true; void tryMove(stay); });
  row.append(b1, b2);
  panel.append(row);
  promoEl.append(panel);
  promoEl.hidden = false;
  render();
}

async function tryMove(m: Move): Promise<void> {
  const g = game;
  if (!g || g.busy) return;
  g.busy = true;
  render();
  let judgement: Judgement;
  try {
    judgement = await g.judge.judge(g.pos, m);
  } catch (err) {
    console.warn('judge failed', err);
    judgement = { verdict: null, praise: null };
  }
  if (game !== g) return; // 判定中にタイトルへ戻った
  const { verdict, praise } = judgement;
  g.logs.push({
    ply: g.pos.moves.length + 1,
    movesBefore: g.pos.moves.map(moveToUsi),
    usi: moveToUsi(m),
    kanji: moveToKanji(m, 0),
    before: judgement.analysis ? judgement.analysis.before : null,
    after: judgement.analysis ? judgement.analysis.after : null,
    level: verdict ? verdict.level : 1,
    headline: verdict ? verdict.headline : '',
    why: verdict ? verdict.why : '',
    betterKanji: verdict?.better ? moveToKanji(verdict.better, 0) : judgement.analysis?.better ? moveToKanji(judgement.analysis.better, 0) : '',
    betterUsi: verdict?.better ? moveToUsi(verdict.better) : judgement.analysis?.better ? moveToUsi(judgement.analysis.better) : '',
    praise: praise ? praise.comment : '',
  });
  if (verdict && verdict.level <= 3) {
    // 段階 2・3: 手は止めず、吹き出しで一言。オジジの手を緑で示す
    g.busy = false;
    hintMove = null;
    commit(m, null, () => showToast(verdict.level === 2 ? 'good' : 'doubtful', verdict.headline, verdict.why, 6000));
    hintMove = verdict.better;
    render();
    return;
  }
  if (verdict) {
    if (verdict.level === 5) g.scolded++;
    else g.badMoves++;
    render();
    const proceed = await showCutin(verdict);
    if (game !== g) return;
    g.busy = false;
    if (proceed) {
      g.judge.ignore(verdict.ignoreKey);
      hintMove = null;
      commit(m, null);
      lineTurn = turnId; // カットインがこの手の一言。続くオジジの独り言は出さない
    } else {
      turnId++; // 指し直す手は新しい手として数える（カットインの一言に続く反応を出せるように）
      hintMove = verdict.better;
      render();
    }
    return;
  }
  g.busy = false;
  hintMove = null;
  commit(m, praise);
}

function commit(m: Move, praise: Praise | null, line?: () => void): void {
  if (!game) return;
  turnId++;
  const captured = game.pos.get(m.to.x, m.to.y);
  game.pos.apply(m);
  playPiece();
  game.lastMove = m;
  if (line) {
    line(); // この手への反応（段階 2・3 の一言）。独り言より先に出す
  } else if (praise && praise.comment) {
    if (!game.learned.some((l) => l.comment === praise.comment)) game.learned.push(praise);
    showNod(praise);
  } else if (captured && PIECE_VALUE[captured.type] >= 5 && captured.type !== 'OU') {
    showToast('doubtful', 'オジジ', `むう、${PIECE_NAME[captured.type]}を取られたか。`, 2500, 'mutter');
  } else if (game.pos.inCheck(1)) {
    showToast('thinking', 'オジジ', '王手か。受けてみせよう。', 2500, 'mutter');
  }
  render();
  if (game.pos.isGameOver()) {
    endGame('win');
    return;
  }
  game.busy = true;
  render();
  if (nodEl.hidden) rig.settle('thinking');
  window.setTimeout(() => void npcMove(), 350);
}

async function npcMove(): Promise<void> {
  const g = game;
  if (!g || g.result) return;
  const pos = g.pos;
  let m: Move | null = null;
  try {
    // まずは自分の戦法の駒組み。損をするならエンジンに任せる
    if (planApplies(pos)) {
      let current: Analysis | undefined;
      if (engine) current = await g.judge.evalOf(pos).catch(() => undefined);
      if (game !== g) return;
      const planTol = (g.style.planTolerance ?? 80) * g.level.planToleranceScale;
      m = await choosePlanMove(pos, g.variant.moves, g.plan, { evaluator: engine, current, reactions: g.style.reactions, tolerance: planTol });
      if (game !== g) return;
    }
    if (!m && engine) {
      m = await engineMove(pos);
      if (game !== g) return;
    }
  } catch (err) {
    console.warn('npc move failed', err);
  }
  if (!m) m = chooseMove(pos, { depth: 2, timeMs: 1200, noise: 0.5 });
  g.busy = false;
  if (!m) {
    endGame('win');
    return;
  }
  pos.apply(m);
  playPiece();
  g.lastMove = m;
  render();
  if (pos.isGameOver()) {
    endGame('lose');
    return;
  }
  ojijiMutters(g, m);
  if (nodEl.hidden) rig.settle('idle');
  g.judge.prefetch(pos);
}

// オジジの手のあとの独り言: 駒組みの節目、狙いのほのめかし、王手
function ojijiMutters(g: Game, m: Move): void {
  const comment = g.style.planComments?.[planKey(m)];
  if (comment) {
    showToast('idle', 'オジジ', comment, 4500, 'mutter');
    return;
  }
  if (g.pos.inCheck(0)) {
    // 連続王手のたびに言わない
    if (g.pos.moves.length - g.lastCheckMutter >= 6) {
      g.lastCheckMutter = g.pos.moves.length;
      showToast('doubtful', 'オジジ', '王手じゃ。', 2500, 'mutter');
    }
    return;
  }
  // 先手の駒に狙いをつけたら、たまにほのめかす（助言）
  if (g.pos.moves.length - g.lastWhisper >= 6) {
    const threat = bestCaptureGain(g.pos, 1);
    if (threat.gain >= 5 && threat.target && threat.victim) {
      g.lastWhisper = g.pos.moves.length;
      const t = threat.target.to;
      showToast('thinking', 'オジジは小声で言った', `……${sqToKanji(t)}の${PIECE_NAME[threat.victim]}に狙いをつけたぞ。気づいておるか。`, 5000, 'mutter');
    }
  }
}

// エンジンの候補手から、最善に近い手をランダムに選ぶ
async function engineMove(pos: Position): Promise<Move | null> {
  if (!engine || !game) return null;
  const lv = game.level;
  const list = await engine.analyzeMulti(pos.moves.map(moveToUsi), { depth: lv.depth, multipv: lv.multipv });
  if (list.length === 0 || !list[0].bestmove) return null;
  // 後手から見た評価は先手視点の符号を反転したもの。難易度が低いほど、最善から遠い手も選ぶ
  const best = -list[0].cp;
  const okay = list.filter((a) => a.bestmove && best - -a.cp <= lv.tolerance);
  const pick = okay[Math.floor(Math.random() * okay.length)] ?? list[0];
  const legal = pos.legalMoves();
  return legal.find((l) => moveToUsi(l) === pick.bestmove) ?? legal.find((l) => moveToUsi(l) === list[0].bestmove) ?? null;
}

// 待った: 自分の手とオジジの手を一組戻す
function takeBack(): void {
  const g = game;
  if (!g || g.busy || g.result || g.pos.turn !== 0 || g.pos.moves.length < 2) return;
  g.pos.undo();
  g.pos.undo();
  g.matta++;
  turnId++;
  g.lastMove = g.pos.moves.length > 0 ? g.pos.moves[g.pos.moves.length - 1] : null;
  selectedSq = null;
  selectedHand = null;
  hintMove = null;
  render();
  showToast('thinking', '待ったか', 'まあ、勉強のうちじゃ。今度はよく考えよ。', 3000, 'ui');
  g.judge.prefetch(g.pos);
}

// ヒント: オジジならどう指すかを盤面に示す（相手の手を待つ間に計算済みの最善手を使う）
async function showHint(): Promise<void> {
  const g = game;
  if (!g || g.busy || g.result || g.pos.turn !== 0) return;
  if (!engine) {
    showToast('thinking', 'ヒント', 'この環境では将棋エンジンが使えないので、ヒントは出せん。', 4000, 'ui');
    return;
  }
  try {
    const a = await g.judge.evalOf(g.pos);
    if (game !== g || !a.bestmove) return;
    const m = safeMove(g.pos, a.bestmove);
    if (!m) return;
    g.hints++;
    hintMove = m;
    render();
    showToast('thinking', 'ヒント', `ワシなら${moveToKanji(m, 0)}じゃ。理由は自分で考えよ。`, 5000, 'ui');
  } catch (err) {
    console.warn('hint failed', err);
  }
}

function showCutin(v: Verdict): Promise<boolean> {
  const shout = v.level === 5;
  cutinEl.classList.toggle('mild', !shout);
  return new Promise((resolve) => {
    cutinEl.innerHTML = '';
    const box = el('div');
    box.style.width = '100%';
    box.style.maxWidth = '420px';
    const face = el('div', 'face');
    faceInto(face, shout ? 'angry' : 'scold');
    box.append(face);
    box.append(el('div', 'shout', shout ? 'ばかもーん！' : 'それは悪手じゃろう'));
    // 叱った後は解説を読む時間なので thinking に移り、閉じたときに平常へ戻す
    nodEl.hidden = true;
    toastSerial++;
    lineTurn = turnId; // カットインもこの手の「一言」なので、あとの独り言は出さない
    if (shout) playThunder();
    rig.play(shout ? 'angry' : 'bad', () => rig.settle('thinking'));
    const panel = el('div', 'panel');
    if (v.headline !== 'ばかもーん！' && v.headline !== 'それは悪手じゃろう') panel.append(el('div', 'headline', v.headline));
    panel.append(el('p', 'why', v.why));
    if (v.evalLine) panel.append(el('div', 'evalline', v.evalLine));
    if (v.better) panel.append(el('div', 'better', `正解: ${moveToKanji(v.better, 0)}（盤面に緑で表示）`));
    const row = el('div', 'btn-row');
    const redo = el('button', 'btn primary', '指し直す');
    const go = el('button', 'btn', 'このまま進む');
    const close = (proceed: boolean) => {
      cutinEl.hidden = true;
      bubbleHiddenAt = performance.now();
      if (stageFaceEl) faceInto(stageFaceEl, 'normal');
      rig.settle(baseState());
      resolve(proceed);
    };
    redo.addEventListener('click', () => close(false));
    go.addEventListener('click', () => close(true));
    row.append(redo, go);
    panel.append(row);
    box.append(panel);
    cutinEl.append(box);
    cutinEl.hidden = false;
  });
}

// 吹き出しに一言を出し、オジジを対応する動作にする。
// 一手につきオジジの台詞は一つ。プレイヤーの手（とそれに続くオジジの手）を「一手」と数え、
// その手について最初に出た台詞だけを見せる。ヒント・待った・課題の表示（kind = 'ui'）は手と無関係なのでいつでも出す。
type ToastKind = 'reaction' | 'mutter' | 'ui';
let turnId = 0; // プレイヤーが指すたびに増える
let lineTurn = -1; // 台詞を出した手の番号
const BUBBLE_GAP_MS = 1500; // 吹き出しが消えてから次を出すまでの間。続けざまに出さない
let bubbleHiddenAt = -1e9;

function showToast(state: RigState, title: string, body: string, ms: number, kind: ToastKind = 'reaction'): void {
  // 吹き出しが出ている間と、消えた直後は、どんな台詞も出さない（置き換えも順番待ちもしない）。
  // これで台詞が重なったり、続けざまに出たりしない
  if (!nodEl.hidden) return;
  if (performance.now() - bubbleHiddenAt < BUBBLE_GAP_MS) return;
  if (kind !== 'ui') {
    if (lineTurn === turnId) return; // この手にはもう一言出している
    lineTurn = turnId;
  }
  const mine = ++toastSerial;
  nodEl.className = 'bubble' + (state === 'doubtful' || state === 'bad' || state === 'angry' ? ' stern' : '');
  nodEl.innerHTML = '';
  if (!rig.available) {
    const svg = el('div', 'bubble-face');
    svg.innerHTML = ojijiSvg(EXPR_OF[state], { piece: false });
    nodEl.append(svg);
  }
  const msg = el('div', 'msg');
  if (title) msg.append(el('b', '', title));
  msg.append(document.createTextNode(body));
  nodEl.append(msg);
  nodEl.hidden = false;
  window.clearTimeout(nodTimer);
  nodTimer = window.setTimeout(() => {
    nodEl.hidden = true;
    bubbleHiddenAt = performance.now();
    if (mine === toastSerial) rig.settle(baseState());
  }, ms);
  const back = () => { if (mine === toastSerial) rig.settle(baseState()); };
  if (state === 'nod' || state === 'good' || state === 'surprised' || state === 'bad' || state === 'angry') {
    rig.play(state, back);
  } else {
    rig.settle(state);
  }
}

// rig の状態名 → SVG の表情名（フォールバック用）
const EXPR_OF: Record<RigState, Expression> = {
  idle: 'normal', thinking: 'thinking', nod: 'nod', good: 'thinking',
  doubtful: 'stern', bad: 'scold', angry: 'angry', surprised: 'shocked',
};

// 良い手への反応。褒める台詞は出さず、頷きと一言の解説だけ
function showNod(p: Praise): void {
  showToast('nod', '', p.comment, 4500);
}

function endGame(result: Result): void {
  if (!game) return;
  stopSfx();
  game.result = result;
  game.busy = false;
  nodEl.hidden = true;
  window.clearTimeout(nodTimer);
  toastSerial++;
  const taskDone = game.task.done({
    goodIds: game.judge.firedIds(),
    scolded: game.scolded,
    badMoves: game.badMoves,
    hints: game.hints,
    result,
    plies: game.pos.moves.length,
  });
  const { promotion } = recordGame(progress, { styleId: game.style.id, result, scolded: game.scolded, task: game.task, taskDone });
  saveProgress(progress);
  lastOutcome = { taskDone, promotion };
  hintMove = null;
  selectedSq = null;
  selectedHand = null;
  render();
  if (result === 'resign') {
    showResult(result);
    return;
  }
  // 詰みの局面はまず盤面で見せる。オジジの一言はボタンを押してから
  const g = game;
  const last = g.lastMove ? moveToKanji(g.lastMove, result === 'lose' ? 1 : 0) : '';
  const n = g.pos.moves.length;
  const banner = el('div', 'mate-banner');
  banner.append(el('div', 'mate-word', '詰み'));
  banner.append(el('div', 'mate-sub', result === 'lose'
    ? `${last}まで、${n}手で後手（オジジ）の勝ち`
    : `${last}まで、${n}手であなたの勝ち`));
  const btn = el('button', 'btn primary', 'オジジの一言を聞く');
  btn.addEventListener('click', () => {
    if (game !== g) return;
    banner.remove();
    showResult(result);
  });
  banner.append(btn);
  boardEl.parentElement!.parentElement!.append(banner); // 盤の下（board-wrap 内）
  lastMoveEl.textContent = `${last}　詰み`;
}

function showResult(result: Result): void {
  if (!game) return;
  resultEl.innerHTML = '';
  const panel = el('div', 'panel result');
  const titles: Record<Result, string> = {
    win: game.style.winLine,
    lose: game.style.loseLine,
    resign: '投了か。潔いのは悪くない。',
  };
  const face = el('div', 'face');
  faceInto(face, result === 'win' ? 'shocked' : 'normal');
  nodEl.hidden = true;
  toastSerial++;
  if (result === 'win') rig.play('surprised', () => rig.settle('idle'));
  else rig.settle('idle');
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

  // 振り返り: 形勢が最も動いた 3 手
  const moments = keyMoments(game.logs, 3);
  if (moments.length > 0) {
    const h3 = el('h3', '', '今日の 3 手');
    h3.append(el('small', '', 'タップで拡大'));
    panel.append(h3);
    const row = el('div', 'moments');
    moments.forEach((mo, i) => {
      const card = el('button', 'moment' + (mo.kind === 'good' ? ' good' : ''));
      const pos = positionAfter(mo.log.movesBefore);
      const played = safeMove(pos, mo.log.usi);
      card.append(miniBoard(pos, played));
      card.append(el('div', 'moment-move', `${mo.log.ply}手目 ${mo.log.kanji}${mo.kind === 'good' ? '（好手）' : ''}`));
      card.append(el('div', 'moment-text', momentCaption(mo)));
      card.addEventListener('click', () => showMoment(moments, i));
      row.append(card);
    });
    panel.append(row);
  }

  // 対局後の動線: 同じ設定で再戦が主。戦法を変えるなら設定へ、タイトルは明示したときだけ
  const row = el('div', 'btn-row stack');
  const again = el('button', 'btn primary', '同じ設定でもう一局');
  const change = el('button', 'btn', '戦法を変える');
  const title = el('button', 'btn', 'タイトルへ');
  again.addEventListener('click', () => startGame(game!.style));
  change.addEventListener('click', showSettings);
  title.addEventListener('click', showTitle);
  row.append(again, change, title);
  panel.append(row);
  resultEl.append(panel);
  resultEl.hidden = false;
}

// 「今日の 3 手」の拡大表示。大きな盤で、指す前（正解を緑で）と指した後を切り替えて見られる。前後の手にも移れる
function showMoment(moments: KeyMoment[], index: number, after = false): void {
  const mo = moments[index];
  if (!mo) return;
  const log = mo.log;
  momentEl.innerHTML = '';
  const panel = el('div', 'panel');
  const head = el('div', 'moment-head');
  head.append(el('b', '', `${log.ply}手目 ${log.kanji}`));
  head.append(el('span', 'tag' + (mo.kind === 'good' ? ' good' : ''), mo.kind === 'good' ? '好手' : '形勢を落とした手'));
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
  b1.addEventListener('click', () => showMoment(moments, index, false));
  b2.addEventListener('click', () => showMoment(moments, index, true));
  toggle.append(b1, b2);
  panel.append(toggle);

  const fmt = (v: number | null): string => {
    if (v === null) return '?';
    if (Math.abs(v) > 3000) return v > 0 ? '先手の詰み筋' : '後手の詰み筋';
    return (v > 0 ? '+' : '') + String(v);
  };
  panel.append(el('div', 'moment-eval', `形勢（先手視点）: ${fmt(log.before)} → ${fmt(log.after)}`));
  panel.append(el('p', 'moment-why', momentCaption(mo)));
  if (mo.kind === 'blunder' && log.betterKanji) {
    panel.append(el('div', 'moment-better', `正解: ${log.betterKanji}${better ? '（指す前の盤に緑で表示）' : ''}`));
  }

  const nav = el('div', 'btn-row');
  const prev = el('button', 'btn', '‹ 前の手');
  const next = el('button', 'btn', '次の手 ›');
  prev.disabled = index === 0;
  next.disabled = index === moments.length - 1;
  prev.addEventListener('click', () => showMoment(moments, index - 1));
  next.addEventListener('click', () => showMoment(moments, index + 1));
  nav.append(prev, next);
  panel.append(nav);
  const close = el('button', 'btn primary close', '閉じる');
  close.addEventListener('click', () => { momentEl.hidden = true; });
  panel.append(close);
  momentEl.append(panel);
  momentEl.hidden = false;
}

// 対局後の一言。叱られ方に合わせて一つだけ
function closingWord(g: Game, result: Result): string {
  if (result === 'win') {
    if (g.hints >= 10) return '……ヒントに頼りすぎじゃ。次は自力で来い。';
    if (g.scolded === 0 && g.badMoves === 0) return '文句のつけようがない。見事じゃった。';
    return 'まあ、勝ちは勝ちじゃ。次も来い。';
  }
  if (g.scolded >= 3) return `気合いだけでは${g.style.name}は崩せん。相手の狙いを読んでから指せ。`;
  if (g.badMoves + g.scolded === 0) return '悪手はなかった。あとは勢いじゃ。もう一局どうじゃ。';
  const lessons = g.style.lessons;
  return lessons[Math.floor(Math.random() * lessons.length)];
}

// 開発時だけ、画面の確認用に内部関数を公開する
if (import.meta.env.DEV) {
  (window as unknown as { __ojiji: unknown }).__ojiji = { endGame, game: () => game, ojijiSvg, showToast, rig, sfx: sfxElementForDebug, piece: pieceElementForDebug, setMuted, playThunder, playPiece };
}

showTitle();
