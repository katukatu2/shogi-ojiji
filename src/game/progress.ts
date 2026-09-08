// 学習ループ: 難易度（オジジの強さ）、対局ごとの「今日の課題」、成績と昇級。
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

export const LEVELS: Level[] = [
  {
    id: 'apprentice',
    name: '見習い',
    description: 'オジジは手を抜く。駒組みは本気だが、そのあとは大らか。まず一勝を。',
    multipv: 5,
    tolerance: 900,
    depth: 3,
    planToleranceScale: 2,
  },
  {
    id: 'student',
    name: '門下生',
    description: 'オジジはそこそこ本気。悪手を咎めてくるが、こちらの良い手も通る。',
    multipv: 4,
    tolerance: 400,
    depth: 5,
    planToleranceScale: 1.3,
  },
  {
    id: 'master',
    name: '師範代',
    description: 'オジジは本気。隙を見せれば一気に来る。',
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
  result: 'win' | 'lose' | 'resign';
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

// まだ達成していない課題から一つ選ぶ。全部達成済みなら共通課題から回す
export function pickTask(style: Style, done: ReadonlySet<string>, random: () => number = Math.random): Task {
  const all = tasksFor(style);
  const remaining = all.filter((t) => !done.has(`${style.id}:${t.id}`));
  const pool = remaining.length > 0 ? remaining : all;
  return pool[Math.floor(random() * pool.length)];
}

// ===== 成績と昇級 =====
export interface StyleRecord {
  games: number;
  wins: number;
  scolded: number;
  tasksDone: string[]; // "styleId:taskId"
}

export interface Progress {
  level: LevelId;
  styles: Record<string, StyleRecord>;
}

const KEY = 'ojiji.progress.v2';

export function emptyProgress(): Progress {
  return { level: 'apprentice', styles: {} };
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Progress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw) as Progress;
    if (!p || typeof p !== 'object' || !p.styles) return emptyProgress();
    p.level = levelById(p.level).id;
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
  result: 'win' | 'lose' | 'resign';
  scolded: number;
  task: Task | null;
  taskDone: boolean;
}

export interface Promotion {
  from: Level;
  to: Level;
}

// 一局の結果を成績に反映する。昇級の条件は「今の難易度で 2 勝、かつ課題を 3 つ達成」
export const PROMOTE_WINS = 2;
export const PROMOTE_TASKS = 3;

export function recordGame(p: Progress, o: GameOutcome): { promotion: Promotion | null } {
  const r = p.styles[o.styleId] ?? { games: 0, wins: 0, scolded: 0, tasksDone: [] };
  r.games++;
  if (o.result === 'win') r.wins++;
  r.scolded += o.scolded;
  if (o.task && o.taskDone) {
    const key = `${o.styleId}:${o.task.id}`;
    if (!r.tasksDone.includes(key)) r.tasksDone.push(key);
  }
  p.styles[o.styleId] = r;

  const winsAtLevel = (p as Progress & { winsAtLevel?: Record<string, number> });
  winsAtLevel.winsAtLevel = winsAtLevel.winsAtLevel ?? {};
  if (o.result === 'win') winsAtLevel.winsAtLevel[p.level] = (winsAtLevel.winsAtLevel[p.level] ?? 0) + 1;
  const tasksTotal = Object.values(p.styles).reduce((n, s) => n + s.tasksDone.length, 0);
  const next = nextLevel(p.level);
  if (next && (winsAtLevel.winsAtLevel[p.level] ?? 0) >= PROMOTE_WINS && tasksTotal >= PROMOTE_TASKS * (LEVELS.findIndex((l) => l.id === p.level) + 1)) {
    const from = levelById(p.level);
    p.level = next.id;
    return { promotion: { from, to: next } };
  }
  return { promotion: null };
}

export function doneTaskSet(p: Progress): Set<string> {
  const s = new Set<string>();
  for (const r of Object.values(p.styles)) for (const t of r.tasksDone) s.add(t);
  return s;
}
