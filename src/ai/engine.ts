// やねうら王 (WebAssembly 版) との USI 通信。
// ブラウザでは index.html で読み込んだ script が global に YaneuraOu_K_P を置く。
// Node（テスト）では require した factory を渡す。

export interface Analysis {
  cp: number; // 先手から見た評価値（詰みは ±MATE_SCORE から手数を引いた値）
  mate: number | null; // 先手から見た詰み手数。正なら先手が詰ます、負なら先手が詰まされる
  bestmove: string | null;
  pv: string[]; // 読み筋（USI）
  depth: number;
}

export interface Evaluator {
  analyze(moves: string[], opts?: AnalyzeOptions): Promise<Analysis>;
  analyzeMulti(moves: string[], opts?: AnalyzeOptions): Promise<Analysis[]>;
}

export interface AnalyzeOptions {
  sfen?: string; // 指定すると moves ではなくこの局面（SFEN）を読む。手番を入れ替えた局面の読みに使う
  movetime?: number; // ミリ秒
  depth?: number;
  multipv?: number;
}

export const MATE_SCORE = 30000;

// エンジンが黙り込んだときに待つのをやめるまでの時間
export const INIT_TIMEOUT_MS = 15000; // init（読み込み・usi・isready）の打ち切り
export const DEPTH_TIMEOUT_MS = 15000; // depth 指定の探索は所要時間が読めないので一律で
export const STOP_GRACE_MS = 200; // 'stop' を送ってから次の探索を始めるまでの猶予

const DEFAULT_MOVETIME = 400;

// 探索を待つ時間。movetime なら 3 倍 + 2 秒、depth 指定なら一律 15 秒
export function watchdogMs(opts: AnalyzeOptions = {}): number {
  if (opts.depth) return DEPTH_TIMEOUT_MS;
  return (opts.movetime ?? DEFAULT_MOVETIME) * 3 + 2000;
}

export interface EngineOptions {
  initTimeoutMs?: number; // 既定は INIT_TIMEOUT_MS
  timeoutMs?: number; // 探索の打ち切り。既定は watchdogMs(opts)
  stopGraceMs?: number; // 既定は STOP_GRACE_MS
}

interface YaneuraOuModule {
  addMessageListener: (listener: (line: string) => void) => void;
  removeMessageListener: (listener: (line: string) => void) => void;
  postMessage: (command: string) => void;
  terminate: () => void;
}

export type EngineFactory = () => Promise<YaneuraOuModule>;

// エンジンからの行を待っている 1 件分。fail は打ち切り・terminate のときに呼ぶ
interface Waiter {
  onLine: (line: string) => void;
  onFail: (err: Error) => void;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ブラウザで SharedArrayBuffer が使えるか（COOP/COEP が効いているか）
export function engineSupported(): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false;
  const g = globalThis as { crossOriginIsolated?: boolean; YaneuraOu_K_P?: unknown };
  if (g.crossOriginIsolated === false) return false;
  return typeof g.YaneuraOu_K_P === 'function';
}

export function browserEngineFactory(): EngineFactory | null {
  const g = globalThis as { YaneuraOu_K_P?: EngineFactory };
  return typeof g.YaneuraOu_K_P === 'function' ? g.YaneuraOu_K_P : null;
}

export class Engine implements Evaluator {
  private mod: YaneuraOuModule | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private waiters: Waiter[] = [];
  private fails = 0;

  // エンジンからの行を全ての待ち手に配る。removeMessageListener で外せるよう参照を固定する
  private onLine = (line: string) => {
    for (const w of [...this.waiters]) w.onLine(line);
  };

  constructor(private factory: EngineFactory, private threads = 2, private opts: EngineOptions = {}) {}

  // 続けて失敗した回数（成功で 0 に戻る）。画面はこれが増えたらエンジンを諦める
  get failures(): number {
    return this.fails;
  }

  async init(): Promise<void> {
    const limit = this.opts.initTimeoutMs ?? INIT_TIMEOUT_MS;
    const deadline = Date.now() + limit;
    const rest = () => Math.max(0, deadline - Date.now());
    try {
      // 読み込みが返らないこともあるので、ここも待ち切らない。
      // 遅れて出来上がったモジュールは捨てる（放っておくとワーカーが残る）
      const loading = this.factory();
      let mod: YaneuraOuModule;
      try {
        mod = await withTimeout(loading, rest(), 'engine init timeout');
      } catch (e) {
        void loading.then((m) => discard(m), () => undefined);
        throw e;
      }
      this.mod = mod;
      mod.addMessageListener(this.onLine);
      await this.send('usi', (l) => l === 'usiok', { ms: rest(), message: 'engine init timeout (usi)' });
      mod.postMessage(`setoption name Threads value ${this.threads}`);
      mod.postMessage('setoption name USI_Hash value 16');
      mod.postMessage('setoption name PvInterval value 0');
      await this.send('isready', (l) => l === 'readyok', { ms: rest(), message: 'engine init timeout (isready)' });
      this.fails = 0;
    } catch (e) {
      this.fails++;
      this.terminate(); // 中途半端に生きたモジュールを残さない
      throw e;
    }
  }

  // 何度呼んでもよい。待っている探索はまとめて失敗にする
  terminate(): void {
    const mod = this.mod;
    this.mod = null;
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w.onFail(new Error('engine terminated'));
    if (!mod) return;
    try {
      mod.removeMessageListener(this.onLine);
    } catch {
      // 既に終了しているモジュールでも構わず進む
    }
    try {
      mod.terminate();
    } catch {
      // 同上
    }
  }

  // コマンドを送り、条件を満たす行が来るまでの全行を返す。
  // timeout を渡すと、その時間で待つのをやめて reject する（返事が来なくなったエンジンで詰まらないため）
  private send(
    command: string,
    done: (line: string) => boolean,
    timeout?: { ms: number; message: string; onTimeout?: () => void },
  ): Promise<string[]> {
    const mod = this.mod;
    if (!mod) return Promise.reject(new Error('engine not initialized'));
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drop = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== waiter);
      };
      const waiter: Waiter = {
        onLine: (line) => {
          lines.push(line);
          if (done(line)) {
            drop();
            resolve(lines);
          }
        },
        onFail: (err) => {
          if (timer !== undefined) clearTimeout(timer);
          reject(err);
        },
      };
      this.waiters.push(waiter);
      if (timeout) {
        timer = setTimeout(() => {
          drop();
          timeout.onTimeout?.();
          reject(new Error(timeout.message));
        }, timeout.ms);
      }
      try {
        mod.postMessage(command);
      } catch (e) {
        drop();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  // 探索は同時に 1 つだけ。呼び出しを直列化する
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    // 失敗した探索のあとは 'stop' が届くのを少し待ってから次へ進む（前の bestmove を拾わないため）
    this.queue = run.then(() => undefined, () => delay(this.opts.stopGraceMs ?? STOP_GRACE_MS));
    return run;
  }

  analyze(moves: string[], opts: AnalyzeOptions = {}): Promise<Analysis> {
    return this.analyzeMulti(moves, { ...opts, multipv: 1 }).then((r) => r[0]);
  }

  analyzeMulti(moves: string[], opts: AnalyzeOptions = {}): Promise<Analysis[]> {
    return this.enqueue(() => this.search(moves, opts)).then(
      (out) => {
        this.fails = 0;
        return out;
      },
      (e) => {
        this.fails++;
        throw e;
      },
    );
  }

  private async search(moves: string[], opts: AnalyzeOptions): Promise<Analysis[]> {
    const mod = this.mod;
    if (!mod) throw new Error('engine not initialized');
    const multipv = opts.multipv ?? 1;
    // 0 = 先手番。SFEN なら手番の欄（b / w）で決める
    const sideToMove = opts.sfen ? (opts.sfen.split(' ')[1] === 'w' ? 1 : 0) : moves.length % 2 === 0 ? 0 : 1;
    mod.postMessage(`setoption name MultiPV value ${multipv}`);
    mod.postMessage(opts.sfen ? `position sfen ${opts.sfen}` : `position startpos${moves.length ? ' moves ' + moves.join(' ') : ''}`);
    const go = opts.depth ? `go depth ${opts.depth}` : `go movetime ${opts.movetime ?? DEFAULT_MOVETIME}`;
    const ms = this.opts.timeoutMs ?? watchdogMs(opts);
    const lines = await this.send(go, (l) => l.startsWith('bestmove'), {
      ms,
      message: `engine timeout (${ms}ms)`,
      // 待つのはやめるが、エンジンには探索を切り上げさせる。そうしないと次の探索を受け付けない
      onTimeout: () => {
        try {
          mod.postMessage('stop');
        } catch {
          // 既に壊れているなら次の探索が 'engine not initialized' で落ちる
        }
      },
    });
    const best = lines.find((l) => l.startsWith('bestmove'))!.split(' ')[1] ?? null;
    const results: Analysis[] = [];
    for (const line of lines) {
      const a = parseInfo(line, sideToMove);
      if (a) results[a.index] = a.analysis;
    }
    if (results.length === 0) {
      results[0] = { cp: 0, mate: null, bestmove: best === 'resign' ? null : best, pv: [], depth: 0 };
    }
    const out = results.filter(Boolean);
    if (out[0] && !out[0].bestmove) out[0].bestmove = best === 'resign' || best === 'win' ? null : best;
    return out;
  }
}

// 指定時間で諦める。元の Promise は止められないので、呼び出し側で後始末する
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// 間に合わなかったモジュールを黙って始末する
function discard(mod: YaneuraOuModule): void {
  try {
    mod.terminate();
  } catch {
    // 何もしない
  }
}

// "info depth 12 seldepth 15 multipv 2 score cp -35 nodes ... pv 7g7f 8c8d" を読む
export function parseInfo(line: string, sideToMove: 0 | 1): { index: number; analysis: Analysis } | null {
  if (!line.startsWith('info ') || !line.includes(' score ')) return null;
  const t = line.split(' ');
  let depth = 0;
  let index = 0;
  let cp = 0;
  let mate: number | null = null;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': depth = Number(t[++i]); break;
      case 'multipv': index = Number(t[++i]) - 1; break;
      case 'score':
        if (t[i + 1] === 'cp') { cp = Number(t[i + 2]); i += 2; }
        else if (t[i + 1] === 'mate') {
          const raw = t[i + 2];
          // やねうら王は手数不明のとき "mate +" / "mate -" を返すことがある。
          // "mate 0" / "mate -0" は手番側がすでに詰まされている局面
          let n = raw === '+' ? 1 : raw === '-' ? -1 : Number(raw);
          if (n === 0) n = -1;
          mate = n;
          cp = n > 0 ? MATE_SCORE - n : -MATE_SCORE - n;
          i += 2;
        }
        break;
      case 'pv': pv = t.slice(i + 1); i = t.length; break;
      case 'lowerbound':
      case 'upperbound':
        break;
    }
  }
  // 手番視点 → 先手視点に直す
  const sign = sideToMove === 0 ? 1 : -1;
  return {
    index,
    analysis: {
      cp: cp * sign,
      mate: mate === null ? null : mate * sign,
      bestmove: pv[0] ?? null,
      pv,
      depth,
    },
  };
}
