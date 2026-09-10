import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Position } from '../src/engine/position';

const lifecycle = vi.hoisted(() => ({ init: vi.fn(), terminate: vi.fn() }));
vi.mock('../src/ai/engine', async (original) => ({
  ...await original<typeof import('../src/ai/engine')>(),
  Engine: class {
    init = lifecycle.init;
    terminate = lifecycle.terminate;
  },
}));

it('対局が例外で終わったら、記録を残して後続も試し、CLIが失敗を返す', async () => {
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
