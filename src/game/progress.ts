// 学習ループ: 難易度（オジジの強さ）、対局ごとの「今日の課題」、成績と昇級、称号と免許。
// 画面に依存しない純粋なロジック。保存は localStorage だが、無い環境でも動く。

import { Style } from '../style/types';

// ===== 難易度 =====
export type LevelId = 'apprentice' | 'student' | 'master';

export interface Level {
  id: LevelId;
  name: string;
  description: string;
  // オジジの指し手: 候補手を何個出し、最善から何点以内をランダムに選ぶか、何手読むか
  multipv: number;
  tolerance: number;
  depth: number;
  // 駒組み中の許容（戦法の planTolerance に掛ける倍率）
  planToleranceScale: number;
}

// 昇級の条件: 「今の難易度で PROMOTE_WINS 勝、かつ課題を累計で PROMOTE_TASKS × 段階（見習い 3・門下生 6）達成」
export const PROMOTE_WINS = 2;
export const PROMOTE_TASKS = 3;

// 皆伝（師範代で叱られず課題も達成して勝つ）の条件文。免状の説明と対局設定の強さ欄で使う
export const KAIDEN_CONDITION = '師範代のオジジに、叱られず、課題も達成して勝つ';

// description には昇級の条件（最上位は皆伝の条件）も含める。対局設定の強さ欄にそのまま出す
export const LEVELS: Level[] = [
  {
    id: 'apprentice',
    name: '見習い',
    description: `オジジは手を抜く。駒組みは本気だが、そのあとは大らか。まず一勝を。${PROMOTE_WINS} 勝と課題 ${PROMOTE_TASKS} つで門下生へ。`,
    multipv: 5,
    tolerance: 900,
    depth: 3,
    planToleranceScale: 2,
  },
  {
    id: 'student',
    name: '門下生',
    description: `オジジはそこそこ本気。悪手を咎めてくるが、こちらの良い手も通る。${PROMOTE_WINS} 勝と課題 ${PROMOTE_TASKS * 2} つ（累計）で師範代へ。`,
    multipv: 4,
    tolerance: 400,
    depth: 5,
    planToleranceScale: 1.3,
  },
  {
    id: 'master',
    name: '師範代',
    description: `オジジは本気。隙を見せれば一気に来る。ここが最上位。${KAIDEN_CONDITION}と皆伝。`,
    multipv: 3,
    tolerance: 150,
    depth: 8,
    planToleranceScale: 1,
  },
];

export function levelById(id: string | null | undefined): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

export function nextLevel(id: LevelId): Level | null {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i >= 0 && i + 1 < LEVELS.length ? LEVELS[i + 1] : null;
}

// ===== 対局の結果 =====
// 'draw' は引き分け（千日手・持将棋・手数超過）。対局数には数えるが、勝ち数にも昇級の勝数にも数えない
export type GameResult = 'win' | 'lose' | 'resign' | 'draw';

// ===== 今日の課題 =====
// 一局に一つだけ出す。達成の判定は「頷いた形の id」「叱られた回数」「勝敗」から決める
export interface Task {
  id: string;
  text: string; // 対局前に見せる文
  done: (r: TaskInput) => boolean;
}

export interface TaskInput {
  goodIds: ReadonlySet<string>; // 一局で頷いた形の id
  scolded: number;
  badMoves: number;
  hints: number;
  result: GameResult;
  plies: number;
}

const COMMON_TASKS: Task[] = [
  { id: 'castle', text: '玉を囲いの中に入れる（囲いができたとオジジに言わせる）', done: (r) => r.goodIds.has('castled') },
  { id: 'no-scold', text: '「ばかもーん！」を一度も言わせない', done: (r) => r.scolded === 0 && r.plies >= 20 },
  { id: 'no-bad', text: '「悪手」も「ばかもん」も言わせない', done: (r) => r.scolded === 0 && r.badMoves === 0 && r.plies >= 20 },
  { id: 'no-hint', text: 'ヒントを使わずに指し切る', done: (r) => r.hints === 0 && r.plies >= 20 },
  { id: 'win', text: 'オジジに勝つ', done: (r) => r.result === 'win' },
];

// 戦法ごとの課題（頷く形の id に対応）
const STYLE_TASKS: Record<string, Task[]> = {
  yagura: [
    { id: 'bishop-exchange', text: '角道を止められる前に角交換する', done: (r) => r.goodIds.has('bishop-exchange') },
    { id: 'edge-attack', text: '端から攻める（オジジの玉がいる側の端に歩・香・桂を進める）', done: (r) => r.goodIds.has('edge-attack') },
    { id: 'bousin', text: '棒銀で仕掛ける（銀を２六・２五まで進める）', done: (r) => r.goodIds.has('bousin') },
  ],
  shikenbisha: [
    { id: 'funagakoi', text: '舟囲い（▲７八玉・▲６八銀・▲５八金）を作る', done: (r) => r.goodIds.has('funagakoi') },
    { id: 'kyusen', text: '急戦で仕掛ける（３０手以内に銀か歩を前線へ）', done: (r) => r.goodIds.has('kyusen') },
    { id: 'edge-attack', text: '美濃囲いを端から攻める', done: (r) => r.goodIds.has('edge-attack') },
  ],
  kakugawari: [
    { id: 'guard-78', text: '角交換のあと▲７八金で打ち込みを消す', done: (r) => r.goodIds.has('guard-78') },
    { id: 'koshikake', text: '腰掛け銀（▲５六銀）の形を作る', done: (r) => r.goodIds.has('koshikake') },
    { id: 'hayakuri', text: '早繰り銀（▲４六銀か▲３六銀）で仕掛ける', done: (r) => r.goodIds.has('hayakuri') },
  ],
  bougin: [
    { id: 'silver-guard', text: '棒銀を銀で受ける（▲７七銀か▲８八銀）', done: (r) => r.goodIds.has('silver-guard') },
    { id: 'repel-silver', text: '前に出てきた銀の頭を歩で叩く', done: (r) => r.goodIds.has('repel-silver') },
  ],
  nakabisha: [
    { id: 'center-guard', text: '５筋を金銀で守る', done: (r) => r.goodIds.has('center-guard') },
    { id: 'take-55', text: '５五の歩を取る', done: (r) => r.goodIds.has('take-55') },
    { id: 'chousoku', text: '超速（早めの▲４六銀）で仕掛ける', done: (r) => r.goodIds.has('chousoku') },
  ],
};

export function tasksFor(style: Style): Task[] {
  return [...(STYLE_TASKS[style.id] ?? []), ...COMMON_TASKS];
}

// まだ達成していない課題から一つ選ぶ。全部達成済みなら全体から回す。
// 乱数は使わず、候補を安定した順（戦法固有 → 共通、定義順）に並べて seed 番目（候補数で割った余り）を返す。
// 画面は seed にその戦法の対局数を渡す。対局設定の「次の課題」と対局で出る課題が同じになり、対局ごとに順に回る
export function pickTask(style: Style, done: ReadonlySet<string>, seed = 0): Task {
  const all = tasksFor(style);
  const remaining = all.filter((t) => !done.has(`${style.id}:${t.id}`));
  const pool = remaining.length > 0 ? remaining : all;
  // 壊れた値（NaN・負・小数）でも落ちないように整える
  const n = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 0;
  return pool[n % pool.length];
}

// ===== 称号と免許 =====
// 戦法ごとの実績（バッジ）。戦法 5 × 難易度 3 を消化したあとの目標として、
// 各戦法で「皆伝」を取ると称号が上がる
export type BadgeId = 'first-win' | 'clean-win' | 'kaiden';

// 表示の順
export const BADGE_IDS: BadgeId[] = ['first-win', 'clean-win', 'kaiden'];

// 表示用の短い名前
export const BADGE_LABEL: Record<string, string> = {
  'first-win': '初勝利',
  'clean-win': '叱られず勝利',
  kaiden: '皆伝',
};

// 取り方（まだ取っていないバッジの説明に使う）
export const BADGE_CONDITION: Record<string, string> = {
  'first-win': 'その戦法のオジジに初めて勝つ',
  'clean-win': '「ばかもーん！」を一度も言わせずに勝つ',
  kaiden: KAIDEN_CONDITION,
};

// 称号。皆伝の数（戦法ごとに最大 1 つ）で決まる
export const TITLES: { kaiden: number; name: string }[] = [
  { kaiden: 0, name: '門前の小僧' },
  { kaiden: 1, name: '通いの弟子' },
  { kaiden: 3, name: '内弟子' },
  { kaiden: 5, name: '免許皆伝' },
];

// ===== 成績と昇級 =====
export interface StyleRecord {
  games: number;
  wins: number;
  scolded: number;
  tasksDone: string[]; // "styleId:taskId"
  badges?: string[]; // 取った実績（BadgeId）。古い保存データには無いので省略可
}

export interface Progress {
  level: LevelId;
  styles: Record<string, StyleRecord>;
  lastStyle?: string; // 前回対局した戦法。タイトルの「前回の設定で始める」と対局設定の初期選択に使う
  winsAtLevel?: Record<string, number>; // 難易度ごとの勝ち数（昇級の判定用）
}

const KEY = 'ojiji.progress.v2';

export function emptyProgress(): Progress {
  return { level: 'apprentice', styles: {} };
}

function emptyRecord(): StyleRecord {
  return { games: 0, wins: 0, scolded: 0, tasksDone: [], badges: [] };
}

// 保存データの戦法ごとの成績を、欠けた欄や壊れた値を既定値で補って整える
function normalizeRecord(raw: unknown): StyleRecord {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof StyleRecord, unknown>>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    games: num(r.games),
    wins: num(r.wins),
    scolded: num(r.scolded),
    tasksDone: strings(r.tasksDone),
    badges: strings(r.badges),
  };
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Progress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw) as Progress;
    if (!p || typeof p !== 'object' || !p.styles || typeof p.styles !== 'object') return emptyProgress();
    p.level = levelById(p.level).id;
    if (typeof p.lastStyle !== 'string') delete p.lastStyle;
    if (!p.winsAtLevel || typeof p.winsAtLevel !== 'object') delete p.winsAtLevel;
    for (const id of Object.keys(p.styles)) p.styles[id] = normalizeRecord(p.styles[id]);
    return p;
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(p: Progress, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {
    // 保存できない環境では何もしない
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export interface GameOutcome {
  styleId: string;
  result: GameResult;
  scolded: number;
  task: Task | null;
  taskDone: boolean;
  level?: LevelId; // 対局した難易度。省略時は p.level（昇級はこの関数の中でしか起きないので同じ値になる）
}

export interface Promotion {
  from: Level;
  to: Level;
}

// 昇級の進み具合。
// next: 次の難易度（師範代なら null）。winsNeeded / tasksNeeded は昇級に必要な数（しきい値。師範代なら 0）、
// winsHave は今の難易度での勝ち数、tasksHave は課題達成数の累計（全戦法）。
// 「あと N 勝・課題 M」は max(0, needed - have) で出す（promotionLine を参照）
export interface PromotionProgress {
  next: Level | null;
  winsNeeded: number;
  tasksNeeded: number;
  winsHave: number;
  tasksHave: number;
}

export function promotionProgress(p: Progress): PromotionProgress {
  const next = nextLevel(p.level);
  const rank = LEVELS.findIndex((l) => l.id === p.level) + 1; // 見習い 1・門下生 2・師範代 3
  return {
    next,
    winsNeeded: next ? PROMOTE_WINS : 0,
    tasksNeeded: next ? PROMOTE_TASKS * rank : 0,
    winsHave: p.winsAtLevel?.[p.level] ?? 0,
    tasksHave: Object.values(p.styles).reduce((n, s) => n + s.tasksDone.length, 0),
  };
}

// 対局設定の強さ欄に出す一行。「昇級まで: あと 1 勝・課題 2（門下生へ）」。師範代なら null
export function promotionLine(p: Progress): string | null {
  const pp = promotionProgress(p);
  if (!pp.next) return null;
  const wins = Math.max(0, pp.winsNeeded - pp.winsHave);
  const tasks = Math.max(0, pp.tasksNeeded - pp.tasksHave);
  return `昇級まで: あと ${wins} 勝・課題 ${tasks}（${pp.next.name}へ）`;
}

// 一局の結果を成績に反映する。昇級の条件は promotionProgress の needed に have が届いたとき
// 戻り値: promotion は昇級したとき、newBadges はこの一局で新しく取った実績（表示順）
export function recordGame(p: Progress, o: GameOutcome): { promotion: Promotion | null; newBadges: string[] } {
  const r = p.styles[o.styleId] ?? emptyRecord();
  r.games++;
  if (o.result === 'win') r.wins++;
  r.scolded += o.scolded;
  if (o.task && o.taskDone) {
    const key = `${o.styleId}:${o.task.id}`;
    if (!r.tasksDone.includes(key)) r.tasksDone.push(key);
  }
  p.styles[o.styleId] = r;

  // 実績は対局した難易度で判定する（昇級の前）
  const newBadges = earnBadges(r, o, o.level ?? p.level);

  p.winsAtLevel = p.winsAtLevel ?? {};
  if (o.result === 'win') p.winsAtLevel[p.level] = (p.winsAtLevel[p.level] ?? 0) + 1;
  const pp = promotionProgress(p);
  if (pp.next && pp.winsHave >= pp.winsNeeded && pp.tasksHave >= pp.tasksNeeded) {
    const from = levelById(p.level);
    p.level = pp.next.id;
    return { promotion: { from, to: pp.next }, newBadges };
  }
  return { promotion: null, newBadges };
}

// この一局で条件を満たした実績のうち、まだ持っていないものを付けて返す。勝ち以外では何も付かない
function earnBadges(r: StyleRecord, o: GameOutcome, level: LevelId): string[] {
  if (o.result !== 'win') return [];
  const earned: BadgeId[] = ['first-win'];
  if (o.scolded === 0) earned.push('clean-win');
  if (o.scolded === 0 && level === 'master' && o.task && o.taskDone) earned.push('kaiden');
  const badges = (r.badges = r.badges ?? []);
  const fresh = earned.filter((b) => !badges.includes(b));
  badges.push(...fresh);
  return fresh;
}

export function doneTaskSet(p: Progress): Set<string> {
  const s = new Set<string>();
  for (const r of Object.values(p.styles)) for (const t of r.tasksDone) s.add(t);
  return s;
}

// 戦法の実績を表示順で返す。未対局や古い保存データなら空
export function badgesOf(p: Progress, styleId: string): string[] {
  const have = p.styles[styleId]?.badges ?? [];
  return BADGE_IDS.filter((id) => have.includes(id));
}

// 全戦法の合計。kaiden は皆伝を取った戦法の数
export function totals(p: Progress): { games: number; wins: number; tasks: number; kaiden: number } {
  const t = { games: 0, wins: 0, tasks: 0, kaiden: 0 };
  for (const r of Object.values(p.styles)) {
    t.games += r.games;
    t.wins += r.wins;
    t.tasks += r.tasksDone.length;
    if (r.badges?.includes('kaiden')) t.kaiden++;
  }
  return t;
}

// 称号。皆伝の数で決まる（0: 門前の小僧、1〜2: 通いの弟子、3〜4: 内弟子、5: 免許皆伝）
export function titleOf(p: Progress): string {
  const n = totals(p).kaiden;
  let name = TITLES[0].name;
  for (const t of TITLES) if (n >= t.kaiden) name = t.name;
  return name;
}
