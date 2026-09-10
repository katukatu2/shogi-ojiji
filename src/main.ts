import { renderTitle } from './ui/title';
import { renderSettings } from './ui/settings';
import type { Game } from './game/session';
import { renderResult } from './ui/results';
import { renderMoment } from './ui/review';
import { Position } from './engine/position';
import { Move, HandPiece, HAND_ORDER, PIECE_KANJI, PIECE_NAME, PIECE_VALUE, Sq, sqEq, Color } from './engine/types';
import { moveToKanji, moveToUsi, sqToKanji } from './engine/notation';
import { chooseLocalMove } from './ai/local';
import { Engine, engineSupported, browserEngineFactory, Analysis } from './ai/engine';
import { Judge, Verdict, Praise, Judgement, safeMove, bestCaptureGain } from './style/judge';
import { Style } from './style/types';
import { choosePlanMove, planApplies, planKey } from './style/plan';
import { ojijiSvg, Expression } from './ui/ojiji';
import { OjijiRig, RigState } from './ui/rig';
import {
  loadProgress, saveProgress, pickTask, doneTaskSet, recordGame, Promotion, GameResult, levelById,
} from './game/progress';
import { KeyMoment } from './game/review';
import { playThunder, playPiece, stopSfx, setMuted, isMuted, warmUp, sfxElementForDebug, pieceElementForDebug } from './ui/audio';
import { el } from './ui/dom';
import { ScreenHistory, ScreenName } from './ui/navigation';

// ソースコードの公開先。決まったら URL に差し替える（URL らしい文字列ならクレジット欄でリンクになる）
const SOURCE_URL = '（公開先 URL）';


const PROMOTED = new Set(['TO', 'NY', 'NK', 'NG', 'UM', 'RY']);
const FILE_LABELS = ['９', '８', '７', '６', '５', '４', '３', '２', '１'];
const RANK_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];


// 対局の結果。'draw' は千日手・持将棋・手数上限の引き分け
type Result = GameResult;


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

// 成績を保存できる端末か（プライベートモードなどでは localStorage が例外を投げる）。
// saveProgress は失敗しても例外を投げないので、書ける端末かをここで試して、タイトルで一言添える
function canSaveProgress(): boolean {
  try {
    const key = 'ojiji.probe';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

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

// エンジンが使えない環境では、その旨を一度だけ画面の上に知らせる（判定は簡易版に切り替わる）。
// 対局画面の操作ボタンに重ならない位置（style.css の .engine-notice）
let engineNoticeShown = false;
function showEngineNotice(): void {
  if (engineNoticeShown) return;
  engineNoticeShown = true;
  const box = el('div', 'engine-notice');
  box.append(el('b', '', '将棋エンジンが使えない環境です'));
  box.append(el('p', '', 'この環境では形勢判定のエンジンが動かないため、駒損と一手詰めだけを見る簡易判定で進めます。対応する端末・ブラウザで開くと、より詳しい判定を利用できます。'));
  const ok = el('button', 'btn primary', 'わかった');
  ok.addEventListener('click', () => box.remove());
  box.append(ok);
  document.body.append(box);
}

// 探索が続けて失敗したらエンジンを諦め、簡易判定に切り替える
const ENGINE_GIVEUP = 3;
function checkEngineFailures(): void {
  if (!engine || engine.failures < ENGINE_GIVEUP) return;
  engine.terminate();
  engine = null;
  game?.judge.setEvaluator(null);
  engineState = 'unavailable';
  updateEngineLabel();
  showEngineNotice();
}

// 選択状態
let selectedSq: Sq | null = null;
let selectedHand: HandPiece | null = null;
let hintMove: Move | null = null;
// 「ヒント」で示した手（USI）。hintMove は段階 2・3 の「正解」の緑表示にも使うので、
// 振り返りで「ヒントに従った手」を見分けるにはこちらを使う
let hintedUsi: string | null = null;
let legalCache: Move[] = [];
let nodTimer: number | undefined;

// ===== 画面遷移と「戻る」 =====
// 画面は タイトル(0) → 対局設定(1) → 対局(2) の深さで履歴に積む。
// ブラウザやスマートフォンの「戻る」は popstate で受け、画面ごとの規則で処理する
// （設定→タイトル、対局中→確認してからタイトル、結果→タイトル）。Capacitor の Android は WebView が戻れる間は
// 戻る操作を WebView に渡すので、同じ道を通る。
// アプリ内のボタンで浅い画面へ行くときは、その分だけ履歴を戻し、そのとき届く popstate は無視する。
const navigation = new ScreenHistory((screen) => {
  if (screen === 'game' && momentEl && !momentEl.hidden) {
    momentEl.hidden = true;
    goToScreen('game');
    return;
  }
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
  if (screen === 'title') goToScreen('title');
});

function goToScreen(name: ScreenName): void { navigation.go(name); }

// ===== タイトル =====
// タイトルは、オジジ・題名・一言・ボタン・遊び方だけ。強さと戦法は「対局設定」で選ぶ。
// 2 回目以降は「前回の設定で始める」で 1 タップで対局に入れる
function showTitle(): void {
  resetToast();
  stopSfx();
  game = null;
  goToScreen('title');
  app.replaceChildren(renderTitle({
    progress, rig, canSave: canSaveProgress(), sourceUrl: SOURCE_URL, faceInto,
    onStart: (style) => { warmUp(); startGame(style); },
    onSettings: showSettings,
  }));
  ensureEngine();
}

// ===== 対局設定 =====
// 強さと戦法を選ぶ。前回の戦法が選択済みで開き、そのまま「この設定で対局」で始められる。
// 選んだ戦法の囲いの形・成績・次の課題を見せて、選ぶ理由を作る
let pendingStyleId: string | null = null;

function showSettings(): void {
  resetToast();
  stopSfx();
  game = null;
  goToScreen('settings');
  app.replaceChildren(renderSettings({
    progress, selectedStyleId: pendingStyleId,
    onSelectStyle: (id) => { pendingStyleId = id; },
    onProgressChange: () => saveProgress(progress),
    onTitle: showTitle,
    onStart: (style) => { warmUp(); startGame(style); },
  }));
  ensureEngine();
}

// ===== 対局 =====
function startGame(style: Style): void {
  resetToast();
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
    lastMoveKanji: '',
    lastCaptureSq: null,
    result: null,
    busy: false,
    level: levelById(progress.level),
    // 課題は対局数を種にして選ぶ。対局設定の「次の課題」と同じ手順なので、見せた課題がそのまま出る
    task: pickTask(style, doneTaskSet(progress), progress.styles[style.id]?.games ?? 0),
    logs: [],
    judgeStates: [],
  };
  selectedSq = null;
  selectedHand = null;
  hintMove = null;
  hintedUsi = null;
  hintShownKey = '';
  buildGameScreen();
  render();
  showStartBanner(style);
  game.judge.prefetch(game.pos);
}

// 対局開始の演出。帯が横に広がり「対局開始」が浮かんで、1.6 秒で消える。操作は妨げない
let startBannerTimer = 0;
function showStartBanner(style: Style): void {
  document.querySelector('.start-banner')?.remove();
  window.clearTimeout(startBannerTimer);
  const banner = el('div', 'start-banner');
  const band = el('div', 'band');
  band.append(el('div', 'word', '対局開始'));
  band.append(el('div', 'sub', `対 ${style.name}・${levelById(progress.level).name}`));
  banner.append(band);
  app.append(banner);
  playPiece();
  startBannerTimer = window.setTimeout(() => banner.remove(), 1700);
}

let boardEl: HTMLElement;
let handEls: [HTMLElement, HTMLElement];
let lastMoveEl: HTMLElement;
let scoldEl: HTMLElement;
let moveNoEl: HTMLElement;
let engineEl: HTMLElement | null = null;
let stageFaceEl: HTMLElement | null = null;
let lastOutcome: { taskDone: boolean; promotion: Promotion | null; newBadges: string[] } = { taskDone: false, promotion: null, newBadges: [] };
let toastSerial = 0;
let cutinEl: HTMLElement;
let nodEl: HTMLElement;
let promoEl: HTMLElement;
let resultEl: HTMLElement;
let momentEl: HTMLElement;
let hintBtn: HTMLButtonElement | null = null;
let mattaBtn: HTMLButtonElement | null = null;

// ヒント・待ったの押せる／押せないを今の状況に合わせる（終局後・思考中・ヒントの計算中は押せない）
function updateControls(): void {
  const g = game;
  const off = !g || g.result !== null || g.busy || hintBusy;
  if (hintBtn) hintBtn.disabled = off;
  if (mattaBtn) mattaBtn.disabled = off || g!.pos.moves.length < 2;
}

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
    if (!game || game.result) return;
    if (game.busy) {
      // 思考中に投了されても無反応にはしない
      showToast('thinking', '', 'オジジが考えておる。少し待て。', 2500, 'ui');
      return;
    }
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
  hintBtn = hint;
  mattaBtn = matta;
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

  // 最終手の表記は指す前の局面で作ってある（game.lastMoveKanji）
  if (game.busy && !game.result && cutinEl.hidden) {
    lastMoveEl.textContent = game.lastMove ? `${game.lastMoveKanji}　…` : '…';
  } else if (game.lastMove) {
    lastMoveEl.textContent = game.lastMoveKanji;
    if (inCheck) lastMoveEl.append(el('span', 'check', '王手！'));
  } else {
    lastMoveEl.textContent = '先手番（あなた）';
  }
  updateControls();
}

function onCellTap(x: number, y: number): void {
  if (!game || game.busy || game.result || hintBusy || game.pos.turn !== 0) return;
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
  if (!game || game.busy || game.result || hintBusy || game.pos.turn !== 0) return;
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
  if (!g || g.busy || g.result || hintBusy) return;
  g.busy = true;
  render();
  // 振り返り用に、指す前の盤の様子を控えておく（駒を取る手か、取り返しか、王手を受けていたか、合法手の数）
  const prevMove = g.pos.moves.length > 0 ? g.pos.moves[g.pos.moves.length - 1] : null;
  const capture = g.pos.get(m.to.x, m.to.y)?.color === 1;
  const recapture = prevMove !== null && sqEq(prevMove.to, m.to) && g.lastCaptureSq !== null && sqEq(g.lastCaptureSq, m.to);
  const inCheck = g.pos.inCheck(0);
  const legalCount = g.pos.legalMoves().length;
  const hinted = hintedUsi !== null && hintedUsi === moveToUsi(m);
  // 判定は Judge の記憶（一局に一度だけ叱るパターン、「このまま進む」で無視したキー）を書き換える。
  // 指し直された手の記憶が残らないよう、指す前の状態を控えておく
  const snap = g.judge.snapshot();
  let judgement: Judgement;
  try {
    judgement = await g.judge.judge(g.pos, m);
  } catch (err) {
    console.warn('judge failed', err);
    checkEngineFailures();
    judgement = { verdict: null, praise: null };
  }
  if (game !== g) return; // 判定中にタイトルへ戻った
  const { verdict, praise } = judgement;
  // 表記は指す前の局面（g.pos）で作る。正解の手も同じ局面の手
  const better = verdict?.better ?? judgement.analysis?.better ?? null;
  const logIndex = g.logs.length; // 指し直されたらこの記録を取り消す
  g.logs.push({
    ply: g.pos.moves.length + 1,
    movesBefore: g.pos.moves.map(moveToUsi),
    usi: moveToUsi(m),
    kanji: moveToKanji(m, 0, null, g.pos),
    before: judgement.analysis ? judgement.analysis.before : null,
    after: judgement.analysis ? judgement.analysis.after : null,
    gap: judgement.analysis ? judgement.analysis.gap : null,
    capture,
    recapture,
    inCheck,
    legalCount,
    depth: judgement.analysis ? judgement.analysis.depth : null,
    playedBest: judgement.analysis?.playedBest,
    hinted,
    level: verdict ? verdict.level : 1,
    headline: verdict ? verdict.headline : '',
    why: verdict ? verdict.why : '',
    betterKanji: better ? moveToKanji(better, 0, null, g.pos) : '',
    betterUsi: better ? moveToUsi(better) : '',
    praise: praise ? praise.comment : '',
  });
  if (verdict && verdict.level <= 3) {
    // 段階 2・3: 手は止めず、吹き出しで一言。オジジの手を緑で示す
    g.busy = false;
    hintMove = null;
    g.judgeStates.push(snap);
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
      g.judgeStates.push(snap);
      commit(m, null);
      lineTurn = turnId; // カットインがこの手の一言。続くオジジの独り言は出さない
    } else {
      // 指さなかった手なので、記録も判定の記憶も指す前に戻す
      // （指していない悪手が「今日の 3 手」に出ない。戻した手で課題が達成扱いにならない）
      g.logs.splice(logIndex, 1);
      g.judge.restore(snap);
      turnId++; // 指し直す手は新しい手として数える（カットインの一言に続く反応を出せるように）
      hintMove = verdict.better;
      render();
    }
    return;
  }
  g.busy = false;
  hintMove = null;
  g.judgeStates.push(snap);
  commit(m, praise);
}

// 指す前の局面で手の表記を作る。「同」は直前の手から、「打」は同種の盤上の駒が動けるかで決まる
function kanjiBefore(pos: Position, m: Move, color: Color): string {
  const prev = pos.moves.length > 0 ? pos.moves[pos.moves.length - 1] : null;
  return moveToKanji(m, color, prev, pos);
}

// 千日手・持将棋・手数上限による終局。成立していなければ null。sente（先手）はプレイヤー
function ruleEnding(pos: Position): { result: Result; reason: string } | null {
  const rep = pos.repetition();
  if (rep !== 'none') {
    if (rep === 'draw') return { result: 'draw', reason: '千日手' };
    return { result: rep === 'sente-loses' ? 'lose' : 'win', reason: '連続王手の千日手' };
  }
  const ek = pos.enteringKing();
  if (ek !== 'none') return { result: ek === 'draw' ? 'draw' : ek === 'sente-loses' ? 'lose' : 'win', reason: '持将棋' };
  if (pos.isTooLong()) return { result: 'draw', reason: `${Position.MAX_PLIES} 手` };
  return null;
}

function commit(m: Move, praise: Praise | null, line?: () => void): void {
  if (!game) return;
  turnId++;
  hintedUsi = null; // 手が確定したので、ヒントの手はここで忘れる
  const captured = game.pos.get(m.to.x, m.to.y);
  game.lastMoveKanji = kanjiBefore(game.pos, m, 0);
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
  } else if (game.pos.inCheck(1) && !game.pos.isGameOver()) {
    // 詰みなら「受けてみせよう」は言わない（言いかけて消える）
    showToast('thinking', 'オジジ', '王手か。受けてみせよう。', 2500, 'mutter');
  }
  render();
  if (game.pos.isGameOver()) {
    endGame('win');
    return;
  }
  const ending = ruleEnding(game.pos);
  if (ending) {
    endGame(ending.result, ending.reason);
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
    checkEngineFailures();
  }
  if (!m) m = await chooseLocalMove(pos);
  if (game !== g || g.result) return;
  g.busy = false;
  if (!m) {
    endGame('win');
    return;
  }
  g.lastMoveKanji = kanjiBefore(pos, m, 1);
  g.lastCaptureSq = pos.get(m.to.x, m.to.y) ? { ...m.to } : null;
  pos.apply(m);
  playPiece();
  g.lastMove = m;
  render();
  if (pos.isGameOver()) {
    endGame('lose');
    return;
  }
  const ending = ruleEnding(pos);
  if (ending) {
    endGame(ending.result, ending.reason);
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

// 待った: 自分の手とオジジの手を一組戻す。
// 二度タップで 4 手戻らないよう、一組戻したあとしばらくは受け付けない
const MATTA_GAP_MS = 500;
let lastTakeBack = -1e9;
function takeBack(): void {
  const g = game;
  if (!g || g.busy || g.result || hintBusy || g.pos.turn !== 0 || g.pos.moves.length < 2) return;
  if (performance.now() - lastTakeBack < MATTA_GAP_MS) return;
  lastTakeBack = performance.now();
  g.pos.undo();
  g.pos.undo();
  g.matta++;
  turnId++;
  // 戻した手の記録と判定の記憶も戻す（戻した手で課題が達成扱いにならないように）
  g.logs = g.logs.filter((l) => l.ply <= g.pos.moves.length);
  const s = g.judgeStates.pop();
  if (s) g.judge.restore(s);
  g.lastMove = g.pos.moves.length > 0 ? g.pos.moves[g.pos.moves.length - 1] : null;
  // 戻った局面の最終手（オジジの手）の表記と「駒を取った地点」は、その手を指す前の局面が要るので、
  // もう一手戻して作り、指し直す（Position の千日手の記録は undo で切り詰められ、次の判定で埋め直される）
  if (g.lastMove) {
    const m = g.lastMove;
    g.pos.undo();
    g.lastMoveKanji = kanjiBefore(g.pos, m, 1);
    g.lastCaptureSq = g.pos.get(m.to.x, m.to.y) ? { ...m.to } : null;
    g.pos.apply(m);
  } else {
    g.lastMoveKanji = '';
    g.lastCaptureSq = null;
  }
  selectedSq = null;
  selectedHand = null;
  hintMove = null;
  hintedUsi = null;
  render();
  showToast('thinking', '待ったか', 'まあ、勉強のうちじゃ。今度はよく考えよ。', 3000, 'ui');
  g.judge.prefetch(g.pos);
}

// ヒント: オジジならどう指すかを盤面に示す（相手の手を待つ間に計算済みの最善手を使う）
// 計算を待つ間はフラグを立て、二度押し・着手・待ったを止める。
// 待たせた結果が古い局面のものなら（局面の鍵が変わっていたら）捨てる
let hintBusy = false;
let hintShownKey = ''; // ヒントを出した局面。同じ局面で押し直しても回数は増やさない
async function showHint(): Promise<void> {
  const g = game;
  if (!g || g.busy || g.result || hintBusy || g.pos.turn !== 0) return;
  if (!engine) {
    showToast('thinking', 'ヒント', 'この環境では将棋エンジンが使えないので、ヒントは出せん。', 4000, 'ui');
    return;
  }
  const key = g.pos.key();
  hintBusy = true;
  updateControls();
  try {
    const a = await g.judge.evalOf(g.pos);
    if (game !== g || g.result || g.pos.key() !== key || !a.bestmove) return;
    const m = safeMove(g.pos, a.bestmove);
    if (!m) return;
    if (hintShownKey !== key) {
      hintShownKey = key;
      g.hints++; // 数えるのは実際に出したときだけ
    }
    hintMove = m;
    hintedUsi = moveToUsi(m);
    render();
    showToast('thinking', 'ヒント', `ワシなら${moveToKanji(m, 0, null, g.pos)}じゃ。理由は自分で考えよ。`, 5000, 'ui');
  } catch (err) {
    console.warn('hint failed', err);
    checkEngineFailures();
  } finally {
    hintBusy = false;
    updateControls();
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
    // カットイン中は手がまだ指されていないので、game.pos は指す前の局面
    if (v.better) panel.append(el('div', 'better', `正解: ${moveToKanji(v.better, 0, null, game?.pos)}（盤面に緑で表示）`));
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

function resetToast(): void {
  window.clearTimeout(nodTimer);
  nodTimer = undefined;
  toastSerial++;
  if (nodEl) nodEl.hidden = true;
  bubbleHiddenAt = -1e9;
  turnId = 0;
  lineTurn = -1;
}

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
    if (mine !== toastSerial) return;
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

// 千日手・持将棋・手数上限の終局で、帯に添える説明（reason → 説明）
const RULE_ENDING_NOTE: Record<string, string> = {
  '千日手': '同じ局面が 4 回現れた',
  '連続王手の千日手': '王手を続けた側の負け',
  '持将棋': '両方の玉が入玉した',
};

// 対局を終える。reason があるときは詰みではなく、千日手・持将棋・手数上限による終局
function endGame(result: Result, reason?: string): void {
  if (!game) return;
  if (game.result) return; // 二重に呼ばれても一局分しか記録しない
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
  const { promotion, newBadges } = recordGame(progress, {
    styleId: game.style.id, result, scolded: game.scolded, task: game.task, taskDone, level: game.level.id,
  });
  saveProgress(progress);
  lastOutcome = { taskDone, promotion, newBadges };
  hintMove = null;
  hintedUsi = null;
  selectedSq = null;
  selectedHand = null;
  render();
  // 終局の顔は詰みの帯が出ている間から。勝ちは驚き、負けは湯呑みで一服（勝ち誇り）
  if (result === 'win') rig.play('surprised', () => rig.settle('idle'));
  else if (result === 'lose') rig.play('good', () => rig.settle('idle'));
  else rig.settle('idle');
  if (result === 'resign') {
    showResult(result);
    return;
  }
  // 終局の局面はまず盤面で見せる。オジジの一言はボタンを押してから
  const g = game;
  const last = g.lastMoveKanji; // 指す前の局面で作った表記（詰みでも千日手でも最終手は先手・後手どちらもあり得る）
  const n = g.pos.moves.length;
  const outcome = result === 'draw' ? '引き分け' : result === 'lose' ? '後手（オジジ）の勝ち' : 'あなたの勝ち';
  const banner = el('div', 'mate-banner');
  if (reason) {
    // 「千日手。同じ局面が 4 回現れた」「400 手に達した。引き分け」のように、規則による終局を言う
    banner.append(el('div', 'mate-word' + (reason.length > 4 ? ' long' : ''), reason));
    const note = RULE_ENDING_NOTE[reason];
    banner.append(el('div', 'mate-sub', note ? `${note}。${n}手で${outcome}` : `${reason}に達した。${outcome}`));
  } else {
    banner.append(el('div', 'mate-word', '詰み'));
    banner.append(el('div', 'mate-sub', `${last}まで、${n}手で${outcome}`));
  }
  const btn = el('button', 'btn primary', 'オジジの一言を聞く');
  btn.addEventListener('click', () => {
    if (game !== g) return;
    banner.remove();
    showResult(result);
  });
  banner.append(btn);
  boardEl.parentElement!.parentElement!.append(banner); // 盤の下（board-wrap 内）
  lastMoveEl.textContent = `${last}　${reason ?? '詰み'}`;
}

function showResult(result: Result): void {
  if (!game) return;
  const g = game;
  nodEl.hidden = true;
  toastSerial++;
  resultEl.replaceChildren(renderResult({
    game: g, result, progress, lastOutcome, faceInto,
    onReplay: () => startGame(g.style), onChange: showSettings, onTitle: showTitle, onMoment: showMoment,
  }));
  resultEl.hidden = false;
}

// 「今日の 3 手」の拡大表示。大きな盤で、指す前（正解を緑で）と指した後を切り替えて見られる。前後の手にも移れる
function showMoment(moments: KeyMoment[], index: number, after = false, opts: { won?: boolean } = {}): void {
  renderMoment(momentEl, moments, index, after, opts);
}

// 対局後の一言。叱られ方に合わせて一つだけ
// 開発時だけ、画面の確認用に内部関数を公開する
if (import.meta.env.DEV) {
  (window as unknown as { __ojiji: unknown }).__ojiji = { endGame, game: () => game, render, ojijiSvg, showToast, rig, sfx: sfxElementForDebug, piece: pieceElementForDebug, setMuted, playThunder, playPiece };
}

showTitle();
