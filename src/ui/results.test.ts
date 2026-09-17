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

describe('結果画面のオジジの一言（一つだけ）', () => {
  const style = STYLES.find((s) => s.id === 'yagura')!;
  const g = (hints: number) => ({ style, pos: Position.initial(), hints, scolded: 0, badMoves: 0 });
  it('勝ちは戦法ごとの台詞', () => {
    expect(closingWord(g(0), 'win')).toBe(style.winLine);
    expect(closingWord(g(9), 'win')).toBe(style.winLine);
  });
  it('ヒントに頼りすぎた勝ちは、それを言う', () => {
    expect(closingWord(g(10), 'win')).toContain('ヒントに頼りすぎ');
  });
  it('負けたときの台詞だったものは、戦法の教えの候補に残っている', () => {
    expect(style.lessons).toContain('矢倉は堅い。崩し方を覚えてから来い。');
  });
});
