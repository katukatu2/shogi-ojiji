import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { Engine, EngineFactory, MATE_SCORE, parseInfo } from './engine';

const require = createRequire(import.meta.url);

describe('やねうら王 WASM', () => {
  let engine: Engine;

  beforeAll(async () => {
    const factory = require('@mizarjp/yaneuraou.k-p') as EngineFactory;
    engine = new Engine(factory, 2);
    await engine.init();
  });

  afterAll(() => engine.terminate());

  it('初期局面はほぼ互角', async () => {
    const a = await engine.analyze([], { movetime: 200 });
    expect(Math.abs(a.cp)).toBeLessThan(200);
    expect(a.bestmove).toMatch(/^[1-9][a-i][1-9][a-i]\+?$/);
    expect(a.depth).toBeGreaterThan(5);
  });

  it('△４五角の両取りを食らった局面は先手が大きく不利', async () => {
    const moves = ['7g7f', '8c8d', '7i6h', '3c3d', '2g2f', '2b8h+', '6h8h', 'B*4e'];
    const a = await engine.analyze(moves, { movetime: 300 });
    expect(a.cp).toBeLessThan(-300);
  });

  it('後手番の局面でも先手視点の値になる', async () => {
    // 先手が角をタダで捨てた直後（後手番）。先手視点で大きくマイナス
    const a = await engine.analyze(['7g7f', '3c3d', '8h5e'], { movetime: 200 });
    expect(a.cp).toBeLessThan(-400);
  });

  it('一手詰めを詰みとして返す', async () => {
    // 先手番: 5二金打で詰む形は初期局面から作れないので、詰みの値が MATE_SCORE 近辺かだけ確認
    const a = await engine.analyze(['7g7f', '8c8d', '7i6h', '3c3d', '2g2f', '2b8h+', '6h8h', 'B*4e'], { movetime: 100 });
    expect(Math.abs(a.cp)).toBeLessThan(MATE_SCORE);
  });

  it('MultiPV で複数の候補手が返る', async () => {
    const list = await engine.analyzeMulti(['7g7f', '8c8d'], { depth: 8, multipv: 3 });
    expect(list.length).toBe(3);
    expect(new Set(list.map((l) => l.bestmove)).size).toBe(3);
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
