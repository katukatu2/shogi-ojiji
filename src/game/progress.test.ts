import { describe, it, expect } from 'vitest';
import {
  LEVELS, levelById, nextLevel, pickTask, tasksFor, recordGame, emptyProgress, loadProgress, saveProgress, doneTaskSet,
  PROMOTE_WINS, PROMOTE_TASKS, badgesOf, titleOf, totals, BADGE_IDS, BADGE_LABEL, BADGE_CONDITION, TITLES, Progress, Task,
} from './progress';
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

// ===== ここから称号と免許 =====
const TASKS = tasksFor(YAGURA);
const WIN_TASK = TASKS.find((t) => t.id === 'win') as Task;

// 課題つきの一局を記録する省略形
function play(p: Progress, result: 'win' | 'lose' | 'resign' | 'draw', scolded: number, taskDone: boolean, styleId = 'yagura', task: Task | null = TASKS[0]) {
  return recordGame(p, { styleId, result, scolded, task, taskDone });
}

// n 個の戦法で皆伝を取った状態を作る
function withKaiden(n: number): Progress {
  const p = emptyProgress();
  p.level = 'master';
  for (let i = 0; i < n; i++) play(p, 'win', 0, true, `style${i}`);
  return p;
}

describe('引き分け', () => {
  it('対局数は増え、勝ち数は増えない。実績も付かない', () => {
    const p = emptyProgress();
    const r = play(p, 'draw', 0, true);
    expect(r).toEqual({ promotion: null, newBadges: [] });
    expect(p.styles.yagura.games).toBe(1);
    expect(p.styles.yagura.wins).toBe(0);
    expect(p.styles.yagura.tasksDone).toEqual(['yagura:' + TASKS[0].id]); // 課題の達成は数える
    expect(badgesOf(p, 'yagura')).toEqual([]);
    expect(totals(p)).toEqual({ games: 1, wins: 0, tasks: 1, kaiden: 0 });
  });

  it('昇級の勝数に数えない', () => {
    const p = emptyProgress();
    // 課題は 3 つ達成しているが、勝ちが無いので昇級しない
    for (let i = 0; i < PROMOTE_TASKS; i++) expect(play(p, 'draw', 0, true, 'yagura', TASKS[i]).promotion).toBeNull();
    for (let i = 0; i < PROMOTE_WINS; i++) expect(play(p, 'draw', 0, false).promotion).toBeNull();
    expect(p.level).toBe('apprentice');
    // 勝ちを足すと昇級する
    expect(play(p, 'win', 0, false).promotion).toBeNull();
    expect(play(p, 'win', 0, false).promotion?.to.id).toBe('student');
    expect(p.styles.yagura.games).toBe(PROMOTE_TASKS + PROMOTE_WINS * 2);
    expect(p.styles.yagura.wins).toBe(PROMOTE_WINS);
  });

  it('課題「オジジに勝つ」は引き分けでは達成しない', () => {
    const input = { goodIds: new Set<string>(), scolded: 0, badMoves: 0, hints: 0, plies: 60 };
    expect(WIN_TASK.done({ ...input, result: 'draw' })).toBe(false);
    expect(WIN_TASK.done({ ...input, result: 'win' })).toBe(true);
  });
});

describe('実績（バッジ）', () => {
  it('負けや投了では何も付かない', () => {
    const p = emptyProgress();
    expect(play(p, 'lose', 0, true).newBadges).toEqual([]);
    expect(play(p, 'resign', 0, true).newBadges).toEqual([]);
    expect(badgesOf(p, 'yagura')).toEqual([]);
    expect(p.styles.yagura.games).toBe(2);
  });

  it('初めて勝つと「初勝利」。叱られていれば他は付かない', () => {
    const p = emptyProgress();
    const r = play(p, 'win', 2, true);
    expect(r).toEqual({ promotion: null, newBadges: ['first-win'] });
    expect(badgesOf(p, 'yagura')).toEqual(['first-win']);
  });

  it('ばかもん 0 で勝つと「叱られず勝利」。師範代でなければ皆伝ではない', () => {
    for (const level of ['apprentice', 'student'] as const) {
      const p = emptyProgress();
      p.level = level;
      expect(play(p, 'win', 0, true).newBadges).toEqual(['first-win', 'clean-win']);
      expect(badgesOf(p, 'yagura')).toEqual(['first-win', 'clean-win']);
    }
  });

  it('師範代でばかもん 0 かつ課題達成で勝つと「皆伝」', () => {
    const p = emptyProgress();
    p.level = 'master';
    expect(play(p, 'win', 0, true).newBadges).toEqual(['first-win', 'clean-win', 'kaiden']);
    expect(badgesOf(p, 'yagura')).toEqual(['first-win', 'clean-win', 'kaiden']);
    expect(totals(p).kaiden).toBe(1);
  });

  it('師範代でも、課題未達成・課題なし・叱られた勝ちは皆伝にならない', () => {
    const p = emptyProgress();
    p.level = 'master';
    expect(play(p, 'win', 0, false).newBadges).toEqual(['first-win', 'clean-win']);
    expect(play(p, 'win', 0, true, 'yagura', null).newBadges).toEqual([]);
    expect(play(p, 'win', 1, true).newBadges).toEqual([]);
    expect(badgesOf(p, 'yagura')).toEqual(['first-win', 'clean-win']);
    expect(totals(p).kaiden).toBe(0);
  });

  it('同じ実績は二度付かず、newBadges には新しく付いたものだけ入る', () => {
    const p = emptyProgress();
    expect(play(p, 'win', 1, true).newBadges).toEqual(['first-win']);
    expect(play(p, 'win', 1, true).newBadges).toEqual([]);
    expect(play(p, 'win', 0, true).newBadges).toEqual(['clean-win']);
    p.level = 'master';
    expect(play(p, 'win', 0, true).newBadges).toEqual(['kaiden']);
    expect(play(p, 'win', 0, true).newBadges).toEqual([]);
    expect(p.styles.yagura.badges).toEqual(['first-win', 'clean-win', 'kaiden']);
    expect(p.styles.yagura.wins).toBe(5);
  });

  it('実績は戦法ごとに別', () => {
    const p = emptyProgress();
    play(p, 'win', 0, true, 'yagura');
    expect(badgesOf(p, 'yagura')).toEqual(['first-win', 'clean-win']);
    expect(badgesOf(p, 'bougin')).toEqual([]);
    expect(play(p, 'win', 3, false, 'bougin').newBadges).toEqual(['first-win']);
    expect(badgesOf(p, 'yagura')).toEqual(['first-win', 'clean-win']);
  });

  it('対局した難易度を level で渡せる（省略時は今の難易度）', () => {
    const p = emptyProgress();
    p.level = 'apprentice';
    expect(recordGame(p, { styleId: 'yagura', result: 'win', scolded: 0, task: TASKS[0], taskDone: true, level: 'master' }).newBadges).toContain('kaiden');
    const q = emptyProgress();
    q.level = 'master';
    expect(recordGame(q, { styleId: 'yagura', result: 'win', scolded: 0, task: TASKS[0], taskDone: true, level: 'student' }).newBadges).not.toContain('kaiden');
  });

  it('badgesOf は表示順で返し、未対局の戦法なら空', () => {
    const p = emptyProgress();
    p.styles.yagura = { games: 1, wins: 1, scolded: 0, tasksDone: [], badges: ['kaiden', 'first-win', 'unknown'] };
    expect(badgesOf(p, 'yagura')).toEqual(['first-win', 'kaiden']);
    expect(badgesOf(p, 'nakabisha')).toEqual([]);
  });

  it('すべての実績に表示名と取り方がある', () => {
    expect(BADGE_IDS).toEqual(['first-win', 'clean-win', 'kaiden']);
    for (const id of BADGE_IDS) {
      expect(BADGE_LABEL[id], id).toBeTruthy();
      expect(BADGE_CONDITION[id], id).toBeTruthy();
    }
  });
});

describe('称号', () => {
  it('皆伝の数で決まる（0: 門前の小僧、1〜2: 通いの弟子、3〜4: 内弟子、5: 免許皆伝）', () => {
    const expected = ['門前の小僧', '通いの弟子', '通いの弟子', '内弟子', '内弟子', '免許皆伝'];
    expected.forEach((name, n) => {
      const p = withKaiden(n);
      expect(totals(p).kaiden, `kaiden=${n}`).toBe(n);
      expect(titleOf(p), `kaiden=${n}`).toBe(name);
    });
    // 戦法が増えても最高位のまま
    expect(titleOf(withKaiden(7))).toBe('免許皆伝');
    expect(TITLES.map((t) => t.kaiden)).toEqual([0, 1, 3, 5]);
  });

  it('皆伝は戦法ごとに 1 つまでしか数えない。勝ちだけでは称号は上がらない', () => {
    const p = emptyProgress();
    p.level = 'master';
    for (let i = 0; i < 5; i++) play(p, 'win', 0, true, 'yagura', TASKS[i]);
    expect(totals(p).kaiden).toBe(1);
    expect(titleOf(p)).toBe('通いの弟子');
    const q = emptyProgress();
    for (let i = 0; i < 5; i++) play(q, 'win', 0, true, `style${i}`);
    expect(totals(q)).toEqual({ games: 5, wins: 5, tasks: 5, kaiden: 0 });
    expect(titleOf(q)).toBe('門前の小僧');
  });
});

describe('合計', () => {
  it('空なら全部 0', () => {
    expect(totals(emptyProgress())).toEqual({ games: 0, wins: 0, tasks: 0, kaiden: 0 });
    expect(titleOf(emptyProgress())).toBe('門前の小僧');
  });

  it('全戦法の合計を返す', () => {
    const p = emptyProgress();
    play(p, 'win', 1, true, 'yagura', TASKS[0]);
    play(p, 'lose', 0, true, 'yagura', TASKS[1]);
    play(p, 'draw', 0, false, 'yagura');
    play(p, 'win', 0, true, 'bougin', TASKS[0]); // 同じ課題でも戦法が違えば別に数える
    p.level = 'master';
    play(p, 'win', 0, true, 'nakabisha', TASKS[0]);
    expect(totals(p)).toEqual({ games: 5, wins: 3, tasks: 4, kaiden: 1 });
    expect(doneTaskSet(p).size).toBe(4);
  });
});

describe('古い保存データ', () => {
  it('badges の無い JSON を読んでも壊れず、既定値で補う', () => {
    const st = memoryStorage();
    st.setItem('ojiji.progress.v2', JSON.stringify({
      level: 'student',
      styles: { yagura: { games: 3, wins: 1, scolded: 2, tasksDone: ['yagura:win'] } },
      lastStyle: 'yagura',
      winsAtLevel: { apprentice: 2 },
    }));
    const p = loadProgress(st);
    expect(p.level).toBe('student');
    expect(p.lastStyle).toBe('yagura');
    expect(p.winsAtLevel).toEqual({ apprentice: 2 });
    expect(p.styles.yagura).toEqual({ games: 3, wins: 1, scolded: 2, tasksDone: ['yagura:win'], badges: [] });
    expect(badgesOf(p, 'yagura')).toEqual([]);
    expect(totals(p)).toEqual({ games: 3, wins: 1, tasks: 1, kaiden: 0 });
    expect(titleOf(p)).toBe('門前の小僧');
    // そのまま続きを記録でき、保存して読み戻しても実績が残る
    expect(play(p, 'win', 0, true).newBadges).toEqual(['first-win', 'clean-win']);
    saveProgress(p, st);
    const again = loadProgress(st);
    expect(badgesOf(again, 'yagura')).toEqual(['first-win', 'clean-win']);
    expect(again.styles.yagura.games).toBe(4);
  });

  it('壊れた欄は既定値に直し、styles が無ければ空の成績にする', () => {
    const st = memoryStorage();
    st.setItem('ojiji.progress.v2', JSON.stringify({
      level: 'master',
      styles: { yagura: { games: 'x', wins: null, badges: 'kaiden', tasksDone: [1, 'yagura:win'] }, bougin: null },
      winsAtLevel: 'nope',
    }));
    const p = loadProgress(st);
    expect(p.styles.yagura).toEqual({ games: 0, wins: 0, scolded: 0, tasksDone: ['yagura:win'], badges: [] });
    expect(p.styles.bougin).toEqual({ games: 0, wins: 0, scolded: 0, tasksDone: [], badges: [] });
    expect(p.winsAtLevel).toBeUndefined();
    expect(titleOf(p)).toBe('門前の小僧');
    expect(play(p, 'win', 0, true, 'bougin').newBadges).toEqual(['first-win', 'clean-win', 'kaiden']);
    st.setItem('ojiji.progress.v2', JSON.stringify({ level: 'master', styles: 'nope' }));
    expect(loadProgress(st)).toEqual(emptyProgress());
  });
});
