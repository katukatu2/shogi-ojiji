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

interface YaneuraOuModule {
  addMessageListener: (listener: (line: string) => void) => void;
  removeMessageListener: (listener: (line: string) => void) => void;
  postMessage: (command: string) => void;
  terminate: () => void;
}

export type EngineFactory = () => Promise<YaneuraOuModule>;

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
  private listeners: ((line: string) => void)[] = [];

  constructor(private factory: EngineFactory, private threads = 2) {}

  async init(): Promise<void> {
    const mod = await this.factory();
    this.mod = mod;
    mod.addMessageListener((line) => {
      for (const l of this.listeners) l(line);
    });
    await this.send('usi', (l) => l === 'usiok');
    mod.postMessage(`setoption name Threads value ${this.threads}`);
    mod.postMessage('setoption name USI_Hash value 16');
    mod.postMessage('setoption name PvInterval value 0');
    await this.send('isready', (l) => l === 'readyok');
  }

  terminate(): void {
    this.mod?.terminate();
    this.mod = null;
  }

  // コマンドを送り、条件を満たす行が来るまでの全行を返す
  private send(command: string, done: (line: string) => boolean): Promise<string[]> {
    const mod = this.mod;
    if (!mod) return Promise.reject(new Error('engine not initialized'));
    return new Promise((resolve) => {
      const lines: string[] = [];
      const listener = (line: string) => {
        lines.push(line);
        if (done(line)) {
          this.listeners = this.listeners.filter((l) => l !== listener);
          resolve(lines);
        }
      };
      this.listeners.push(listener);
      mod.postMessage(command);
    });
  }

  // 探索は同時に 1 つだけ。呼び出しを直列化する
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  analyze(moves: string[], opts: AnalyzeOptions = {}): Promise<Analysis> {
    return this.analyzeMulti(moves, { ...opts, multipv: 1 }).then((r) => r[0]);
  }

  analyzeMulti(moves: string[], opts: AnalyzeOptions = {}): Promise<Analysis[]> {
    return this.enqueue(async () => {
      const mod = this.mod;
      if (!mod) throw new Error('engine not initialized');
      const multipv = opts.multipv ?? 1;
      // 0 = 先手番。SFEN なら手番の欄（b / w）で決める
      const sideToMove = opts.sfen ? (opts.sfen.split(' ')[1] === 'w' ? 1 : 0) : moves.length % 2 === 0 ? 0 : 1;
      mod.postMessage(`setoption name MultiPV value ${multipv}`);
      mod.postMessage(opts.sfen ? `position sfen ${opts.sfen}` : `position startpos${moves.length ? ' moves ' + moves.join(' ') : ''}`);
      const go = opts.depth ? `go depth ${opts.depth}` : `go movetime ${opts.movetime ?? 400}`;
      const lines = await this.send(go, (l) => l.startsWith('bestmove'));
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
    });
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
