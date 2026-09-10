import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ init: vi.fn(), terminate: vi.fn() }));
vi.mock('../src/ai/engine', async (original) => ({
  ...await original<typeof import('../src/ai/engine')>(),
  Engine: class {
    init = lifecycle.init;
    terminate = lifecycle.terminate;
  },
}));

it('対局が例外で終わったら、記録を残して後続も試し、CLIが失敗を返す', async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const { Position } = await import('../src/engine/position');
  const dir = mkdtempSync(join(tmpdir(), 'ojiji-selfplay-'));
  const out = join(dir, 'failure.jsonl');
  const argv = process.argv;
  process.argv = ['node', 'selfplay.ts', '--games', '2', '--out', out];
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Position, 'initial').mockImplementation(() => { throw new Error('injected game failure'); });
  try {
    await import('./selfplay');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledWith(1);
    const rows = readFileSync(out, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(rows.map(({ game, type, message }) => ({ game, type, message }))).toEqual([
      { game: 0, type: 'error', message: 'Error: injected game failure' },
      { game: 1, type: 'error', message: 'Error: injected game failure' },
    ]);
    expect(lifecycle.terminate).toHaveBeenCalledOnce();
  } finally {
    process.argv = argv;
    vi.restoreAllMocks();
    unlinkSync(out);
    rmdirSync(dir);
  }
});

it.each([false, true])('--all-styles は登録済み全戦法を2局ずつ処理する（途中の例外: %s）', async (failFirst) => {
  vi.resetModules();
  vi.clearAllMocks();
  const { Position } = await import('../src/engine/position');
  const { STYLES } = await import('../src/style');
  const dir = mkdtempSync(join(tmpdir(), 'ojiji-selfplay-'));
  const out = join(dir, 'all.jsonl');
  const argv = process.argv;
  // 手数0はCLIのループと記録だけを検査するため。実際の対局はCIの60手採取で行う。
  process.argv = ['node', 'selfplay.ts', '--all-styles', '--games', '2', '--plies', '0', '--out', out];
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  if (failFirst) vi.spyOn(Position, 'initial').mockImplementationOnce(() => { throw new Error('first game failed'); });
  try {
    await import('./selfplay');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledWith(failFirst ? 1 : 0);
    const rows = readFileSync(out, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(rows.map(({ style, game }) => ({ style, game }))).toEqual(STYLES.flatMap((s) => [0, 1].map((game) => ({ style: s.id, game }))));
    expect(rows.filter((r) => r.type === 'error')).toHaveLength(failFirst ? 1 : 0);
    expect(rows.filter((r) => r.type === 'result')).toHaveLength(STYLES.length * 2 - (failFirst ? 1 : 0));
    expect(lifecycle.init).toHaveBeenCalledOnce();
    expect(lifecycle.terminate).toHaveBeenCalledOnce();
  } finally {
    process.argv = argv;
    vi.restoreAllMocks();
    unlinkSync(out);
    rmdirSync(dir);
  }
});

it.each([
  ['不明なID', ['--style', 'typo-style']],
  ['末尾に値がない', ['--style']],
  ['値の位置が別の引数', ['--style', '--seed', '1']],
  ['全戦法と個別指定の併用', ['--all-styles', '--style', 'yagura']],
] as const)('無効な戦法指定（%s）を、エンジン起動とログ上書きより先に拒否する', async (_name, flags) => {
  vi.resetModules();
  vi.clearAllMocks();
  const dir = mkdtempSync(join(tmpdir(), 'ojiji-selfplay-'));
  const out = join(dir, 'existing.jsonl');
  writeFileSync(out, 'keep existing evidence\n');
  const argv = process.argv;
  process.argv = ['node', 'selfplay.ts', '--games', '1', '--plies', '0', '--out', out, ...flags];
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await import('./selfplay');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledWith(1);
    expect(lifecycle.init).not.toHaveBeenCalled();
    expect(readFileSync(out, 'utf8')).toBe('keep existing evidence\n');
    const message = error.mock.calls.flat().join(' ');
    for (const id of ['yagura', 'shikenbisha', 'kakugawari', 'bougin', 'nakabisha']) expect(message).toContain(id);
  } finally {
    process.argv = argv;
    vi.restoreAllMocks();
    unlinkSync(out);
    rmdirSync(dir);
  }
});
