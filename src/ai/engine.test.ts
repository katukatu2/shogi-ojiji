import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { Engine, EngineFactory, MATE_SCORE, parseInfo, watchdogMs } from './engine';
import { Position } from '../engine/position';
import { moveToUsi, usiToMove } from '../engine/notation';
import { ANALYZE_MS } from '../style/judge';

const require = createRequire(import.meta.url);

describe('やねうら王 WASM', () => {
  let engine: Engine;

  beforeAll(async () => {
    const factory = require('@mizarjp/yaneuraou.k-p') as EngineFactory;
    // 正しさの試験は固定の深さ・1 スレッド。マシンの負荷を探索精度の条件にしない。
    engine = new Engine(factory, 1);
    await engine.init();
  });

  afterAll(() => engine.terminate());

  it('初期局面はほぼ互角', async () => {
    const a = await engine.analyze([], { depth: 10 });
    expect(Math.abs(a.cp)).toBeLessThan(200);
    expect(a.bestmove).toMatch(/^[1-9][a-i][1-9][a-i]\+?$/);
    expect(a.depth).toBeGreaterThanOrEqual(10);
  });

  it('△４五角の両取りを食らった局面は先手が大きく不利', async () => {
    const moves = ['7g7f', '8c8d', '7i6h', '3c3d', '2g2f', '2b8h+', '6h8h', 'B*4e'];
    const a = await engine.analyze(moves, { depth: 10 });
    expect(a.cp).toBeLessThan(-300);
  });

  it('SFEN で局面を渡せる（手番を入れ替えた局面の読み）', async () => {
    // ７九の銀を３八へ移した局面。銀が飛車の横利きを遮り、８八の角が本当にタダになる。
    // 以前の局面は▲同飛で取り返せたため、角取りを唯一の正解とする assert が誤っていた。
    const a = await engine.analyze([], { sfen: 'lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B4SR1/LN1GKGSNL w - 3', depth: 10 });
    expect(a.bestmove).toBe('2b8h+');
    expect(a.cp).toBeLessThan(-300); // 先手視点で大損
  });

  it('後手番の局面でも先手視点の値になる', async () => {
    // 先手が角をタダで捨てた直後（後手番）。先手視点で大きくマイナス
    const a = await engine.analyze(['7g7f', '3c3d', '8h5e'], { depth: 10 });
    expect(a.cp).toBeLessThan(-400);
  });

  it('一手詰めを詰みとして返す', async () => {
    // ５三金に支えられた頭金。SFEN から本当に一手詰めを読む。
    const a = await engine.analyze([], { sfen: '4k4/9/4G4/9/9/9/9/9/4K4 b G 1', depth: 8 });
    expect(a.bestmove).toBe('G*5b');
    expect(a.mate).toBe(1);
    expect(a.cp).toBe(MATE_SCORE - 1);
  });

  it('MultiPV で複数の候補手が返る', async () => {
    const list = await engine.analyzeMulti(['7g7f', '8c8d'], { depth: 8, multipv: 3 });
    expect(list.length).toBe(3);
    expect(new Set(list.map((l) => l.bestmove)).size).toBe(3);
  });
});

it('本体の2スレッド・400ms・MultiPV 2でも合法な応手を返し、到達深さを記録する', async () => {
  const engine = new Engine(require('@mizarjp/yaneuraou.k-p') as EngineFactory, 2);
  await engine.init();
  try {
    const lines = [[], '7g7f 8c8d 2g2f 8d8e 2f2e 3c3d 3i3h 9c9d 3h2g 8e8f'.split(' ')];
    const measured = [];
    for (const moves of lines) {
      const pos = Position.initial();
      for (const move of moves) pos.apply(usiToMove(pos, move));
      const legal = pos.legalMoves().map(moveToUsi);
      const values = await engine.analyzeMulti(moves, { movetime: ANALYZE_MS, multipv: 2 });
      expect(values).toHaveLength(2);
      for (const value of values) {
        expect(legal).toContain(value.bestmove);
        expect(Number.isFinite(value.cp)).toBe(true);
        expect(value.depth).toBeGreaterThan(0);
      }
      measured.push({ ply: moves.length, depth: values[0].depth, cp: values[0].cp, bestmove: values[0].bestmove });
    }
    console.info('実条件での到達深さ（端末依存）:', measured);
  } finally { engine.terminate(); }
});

// ===== 黙り込んだエンジンの扱い（WASM を使わず、偽のモジュールで確かめる）=====

interface FakeModule {
  listeners: ((line: string) => void)[];
  sent: string[];
  terminated: number;
  hang: boolean; // true の間は go に答えない（探索がハングしたエンジン）
  mute: boolean; // true なら usi / isready にも答えない
  addMessageListener(l: (line: string) => void): void;
  removeMessageListener(l: (line: string) => void): void;
  postMessage(cmd: string): void;
  terminate(): void;
  emit(line: string): void;
}

function fakeModule(): FakeModule {
  const mod: FakeModule = {
    listeners: [],
    sent: [],
    terminated: 0,
    hang: false,
    mute: false,
    addMessageListener(l) { mod.listeners.push(l); },
    removeMessageListener(l) { mod.listeners = mod.listeners.filter((x) => x !== l); },
    postMessage(cmd) {
      mod.sent.push(cmd);
      // 本物と同じく、返事は同期では来ない
      queueMicrotask(() => {
        if (mod.mute) return;
        if (cmd === 'usi') mod.emit('usiok');
        else if (cmd === 'isready') mod.emit('readyok');
        else if (cmd.startsWith('go')) {
          if (mod.hang) return;
          mod.emit('info depth 10 multipv 1 score cp 42 pv 7g7f 3c3d');
          mod.emit('bestmove 7g7f');
        }
      });
    },
    terminate() { mod.terminated++; },
    emit(line) { for (const l of [...mod.listeners]) l(line); },
  };
  return mod;
}

// テストが待たされないよう、打ち切りまでの時間を短くする（既定値の式は watchdogMs のテストで見る）
const FAST = { initTimeoutMs: 80, timeoutMs: 60, stopGraceMs: 10 };

async function readyEngine(mod: FakeModule): Promise<Engine> {
  const engine = new Engine(() => Promise.resolve(mod), 1, FAST);
  await engine.init();
  return engine;
}

describe('探索の見張り時間', () => {
  it('movetime は 3 倍 + 2 秒、depth 指定は 15 秒', () => {
    expect(watchdogMs({ movetime: 400 })).toBe(3200);
    expect(watchdogMs({})).toBe(3200); // movetime 既定の 400 と同じ
    expect(watchdogMs({ movetime: 1500 })).toBe(6500);
    expect(watchdogMs({ depth: 8 })).toBe(15000);
    expect(watchdogMs({ depth: 8, movetime: 100 })).toBe(15000);
  });
});

describe('黙り込んだエンジン', () => {
  it('bestmove が来なければ指定時間で reject し、エンジンに stop を送る', async () => {
    const mod = fakeModule();
    mod.hang = true;
    const engine = await readyEngine(mod);
    await expect(engine.analyzeMulti([], { movetime: 10 })).rejects.toThrow(/timeout/);
    expect(mod.sent).toContain('stop');
    expect(engine.failures).toBe(1);
    engine.terminate();
  });

  it('失敗が続けば failures が増え、成功すれば 0 に戻る', async () => {
    const mod = fakeModule();
    mod.hang = true;
    const engine = await readyEngine(mod);
    await expect(engine.analyze([], { movetime: 10 })).rejects.toThrow(/timeout/);
    await expect(engine.analyze([], { movetime: 10 })).rejects.toThrow(/timeout/);
    expect(engine.failures).toBe(2);
    mod.hang = false;
    const a = await engine.analyze([], { movetime: 10 });
    expect(a.bestmove).toBe('7g7f');
    expect(engine.failures).toBe(0);
    engine.terminate();
  });

  it('先の探索がハングしても、待たされていた次の探索は動く', async () => {
    const mod = fakeModule();
    mod.hang = true;
    const engine = await readyEngine(mod);
    const first = engine.analyzeMulti([], { movetime: 10 });
    const second = engine.analyzeMulti(['7g7f'], { movetime: 10 });
    await expect(first).rejects.toThrow(/timeout/);
    mod.hang = false; // 2 件目の go はまだ送られていない（stop の猶予待ち）
    const list = await second;
    expect(list[0].bestmove).toBe('7g7f');
    expect(list[0].cp).toBe(-42); // 後手番の局面なので先手視点では符号が反転する
    expect(engine.failures).toBe(0);
    engine.terminate();
  });

  it('init が返らなければ reject する', async () => {
    const engine = new Engine(() => new Promise<never>(() => undefined), 1, FAST);
    await expect(engine.init()).rejects.toThrow(/init timeout/);
    expect(engine.failures).toBe(1);
  });

  it('usiok が来なければ init を打ち切り、モジュールを片づける', async () => {
    const mod = fakeModule();
    mod.mute = true;
    const engine = new Engine(() => Promise.resolve(mod), 1, FAST);
    await expect(engine.init()).rejects.toThrow(/init timeout/);
    expect(mod.terminated).toBe(1);
    expect(mod.listeners.length).toBe(0);
  });

  it('terminate は何度呼んでもよく、待っている探索は失敗にする', async () => {
    const mod = fakeModule();
    mod.hang = true;
    const engine = await readyEngine(mod);
    const pending = engine.analyzeMulti([], { movetime: 10 });
    await new Promise((r) => setTimeout(r, 5)); // go が送られるまで待つ
    engine.terminate();
    engine.terminate();
    engine.terminate();
    await expect(pending).rejects.toThrow(/terminated/);
    expect(mod.terminated).toBe(1);
    expect(mod.listeners.length).toBe(0);
    await expect(engine.analyze([], { movetime: 10 })).rejects.toThrow(/not initialized/);
  });
});

describe('info 行の読み取り', () => {
  it('"mate -0"（手番側がすでに詰んでいる）は、相手の詰みとして扱う', () => {
    const a = parseInfo('info depth 1 seldepth 1 score mate -0 nodes 1 pv', 1)!.analysis;
    expect(a.mate).toBeGreaterThan(0); // 後手番で詰まされている = 先手の勝ち
    expect(a.cp).toBeGreaterThan(MATE_SCORE - 10);
  });

  it('先手視点への符号の変換', () => {
    expect(parseInfo('info depth 5 score cp 120 pv 7g7f', 0)!.analysis.cp).toBe(120);
    expect(parseInfo('info depth 5 score cp 120 pv 8c8d', 1)!.analysis.cp).toBe(-120);
    expect(parseInfo('info depth 5 score mate 3 pv 2b3a', 1)!.analysis.mate).toBe(-3);
  });
});
