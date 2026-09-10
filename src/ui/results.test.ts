import { describe, it, expect, vi, afterEach } from 'vitest';
import { closingWord } from './results';
import { STYLES } from '../style';
import { Position } from '../engine/position';

afterEach(() => vi.restoreAllMocks());
describe('結果に出す戦法別の助言', () => {
  it.each(STYLES)('$name の一般的な助言が実際の表示関数から返る', (style) => {
    const random = vi.spyOn(Math, 'random');
    for (const [i, expected] of style.lessons.entries()) {
      random.mockReturnValue((i + 0.5) / style.lessons.length);
      const text = closingWord({ style, pos: Position.initial(), hints: 0, scolded: 0, badMoves: 1 }, 'resign');
      expect(text).toBe(expected);
    }
  });
  it('銀が出ていない局面には銀の進出を述べず、実際に進出したときだけ述べる', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99999);
    const style = STYLES.find((s) => s.id === 'bougin')!;
    const g = { style, pos: Position.initial(), hints: 0, scolded: 0, badMoves: 1 };
    expect(closingWord(g, 'lose')).not.toContain('銀が前に出');
    g.pos.set(6, 0, null);
    g.pos.set(6, 3, { type: 'GI', color: 1 });
    expect(closingWord(g, 'lose')).toContain('相手の銀が前に出ておる');
  });
});
