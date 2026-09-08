import { describe, it, expect } from 'vitest';
import { LEVELS, levelById, nextLevel, pickTask, tasksFor, recordGame, emptyProgress, loadProgress, saveProgress, doneTaskSet, PROMOTE_WINS, PROMOTE_TASKS } from './progress';
import { YAGURA } from '../style/yagura';
import { STYLES } from '../style/index';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

describe('難易度', () => {
  it('3 段階あり、上に行くほどオジジが強い', () => {
    expect(LEVELS.length).toBe(3);
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].tolerance).toBeLessThan(LEVELS[i - 1].tolerance);
      expect(LEVELS[i].depth).toBeGreaterThanOrEqual(LEVELS[i - 1].depth);
    }
    expect(levelById('nope').id).toBe('apprentice');
    expect(nextLevel('master')).toBeNull();
    expect(nextLevel('apprentice')?.id).toBe('student');
  });
});

describe('今日の課題', () => {
  it('全戦法に戦法固有の課題があり、頷く形の id と対応している', () => {
    for (const st of STYLES) {
      const tasks = tasksFor(st);
      expect(tasks.length).toBeGreaterThan(3);
      const goodIds = new Set(st.goodPatterns.map((p) => p.id));
      for (const t of tasks) {
        // 戦法固有の課題は、その戦法の頷く形で達成できる
        const input = { goodIds, scolded: 0, badMoves: 0, hints: 0, result: 'win' as const, plies: 40 };
        expect(t.done(input), `${st.id}:${t.id}`).toBe(true);
      }
    }
  });

  it('未達成の課題から選び、全部達成済みなら全体から回す', () => {
    const all = tasksFor(YAGURA);
    const done = new Set(all.slice(0, all.length - 1).map((t) => `${YAGURA.id}:${t.id}`));
    const t = pickTask(YAGURA, done, () => 0.99);
    expect(t.id).toBe(all[all.length - 1].id);
    const t2 = pickTask(YAGURA, new Set(all.map((t) => `${YAGURA.id}:${t.id}`)), () => 0);
    expect(t2.id).toBe(all[0].id);
  });
});

describe('成績と昇級', () => {
  it('保存と読み込み', () => {
    const s = memoryStorage();
    const p = emptyProgress();
    p.level = 'student';
    saveProgress(p, s);
    expect(loadProgress(s).level).toBe('student');
    expect(loadProgress(memoryStorage()).level).toBe('apprentice');
  });

  it('見習いで 2 勝し課題を 3 つ達成すると門下生へ昇級する', () => {
    const p = emptyProgress();
    const tasks = tasksFor(YAGURA);
    let promo = null;
    for (let i = 0; i < PROMOTE_TASKS; i++) {
      const r = recordGame(p, { styleId: 'yagura', result: i < PROMOTE_WINS ? 'win' : 'lose', scolded: 1, task: tasks[i], taskDone: true });
      promo = r.promotion ?? promo;
    }
    expect(promo?.to.id).toBe('student');
    expect(p.level).toBe('student');
    expect(doneTaskSet(p).size).toBe(PROMOTE_TASKS);
    expect(p.styles.yagura.games).toBe(PROMOTE_TASKS);
    expect(p.styles.yagura.wins).toBe(PROMOTE_WINS);
  });

  it('勝っても課題が足りなければ昇級しない', () => {
    const p = emptyProgress();
    for (let i = 0; i < 5; i++) {
      const r = recordGame(p, { styleId: 'yagura', result: 'win', scolded: 0, task: null, taskDone: false });
      expect(r.promotion).toBeNull();
    }
    expect(p.level).toBe('apprentice');
  });
});

describe('前回の戦法', () => {
  it('保存され、読み戻せる。壊れた値は捨てる', () => {
    const st = memoryStorage();
    const p = emptyProgress();
    p.lastStyle = 'yagura';
    saveProgress(p, st);
    expect(loadProgress(st).lastStyle).toBe('yagura');
    st.setItem('ojiji.progress.v2', JSON.stringify({ level: 'student', styles: {}, lastStyle: 5 }));
    expect(loadProgress(st).lastStyle).toBeUndefined();
    expect(loadProgress(st).level).toBe('student');
  });
});
