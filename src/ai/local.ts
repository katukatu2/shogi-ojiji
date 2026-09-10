import type { Position } from '../engine/position';
import type { Move } from '../engine/types';
import { chooseMove } from './search';

// WASM 不可時の探索も UI と分離する。Worker 自体が使えない環境では短時間の探索に留める。
export function chooseLocalMove(position: Position): Promise<Move | null> {
  return new Promise((resolve) => {
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (move: Move | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker?.terminate();
      resolve(move);
    };
    const fallback = () => finish(chooseMove(position, { depth: 2, timeMs: 30, noise: 0.5 }));
    try {
      worker = new Worker(new URL('./local-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<Move | null>) => finish(event.data);
      worker.onerror = fallback;
      timer = setTimeout(fallback, 3000);
      worker.postMessage({ position: position.clone(), options: { depth: 2, timeMs: 300, noise: 0.5 } });
    } catch { fallback(); }
  });
}
