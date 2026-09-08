import { describe, it, expect } from 'vitest';
import { formationOf } from './formation';
import { STYLES } from '../style/index';
import { SHIKENBISHA } from '../style/shikenbisha';

// 盤の座標: x は９筋が 0、１筋が 8。y は一段目が 0
describe('囲いの形', () => {
  it('四間飛車は飛車が４二、玉が８二に収まる', () => {
    const pos = formationOf(SHIKENBISHA);
    expect(pos.get(5, 1)).toEqual({ type: 'HI', color: 1 });
    expect(pos.get(1, 1)).toEqual({ type: 'OU', color: 1 });
  });

  it('全戦法で例外なく作れ、先手の駒は初期配置のまま', () => {
    for (const st of STYLES) {
      const pos = formationOf(st);
      const init = formationOf({ ...st, plans: [] });
      for (let y = 6; y < 9; y++) for (let x = 0; x < 9; x++) expect(pos.get(x, y)).toEqual(init.get(x, y));
      expect(pos.moves.length).toBeGreaterThan(5); // 駒組みが進んでいる
    }
  });
});
