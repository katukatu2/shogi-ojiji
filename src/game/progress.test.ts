import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  LEVELS, levelById, nextLevel, pickTask, tasksFor, recordGame, emptyProgress, loadProgress, saveProgress, doneTaskSet,
  PROMOTE_WINS, PROMOTE_TASKS, badgesOf, titleOf, totals, BADGE_IDS, BADGE_LABEL, BADGE_CONDITION, KAIDEN_CONDITION, TITLES,
  promotionProgress, promotionLine, Progress, Task,
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

  it('説明文に昇級の条件（勝ち数・課題数・次の難易度）が入っている。最上位は皆伝の条件', () => {
    for (const lv of LEVELS) {
      const p = emptyProgress();
      p.level = lv.id;
      const pp = promotionProgress(p);
      if (pp.next) {
        expect(lv.description, lv.id).toContain(`${pp.winsNeeded} 勝`);
        expect(lv.description, lv.id).toContain(`課題 ${pp.tasksNeeded} つ`);
        expect(lv.description, lv.id).toContain(`${pp.next.name}へ`);
      } else {
        expect(lv.description, lv.id).toContain(KAIDEN_CONDITION);
        expect(lv.description, lv.id).toContain('皆伝');
      }
    }
    expect(levelById('apprentice').description).toContain('2 勝と課題 3 つで門下生へ');
    expect(levelById('student').description).toContain('2 勝と課題 6 つ（累計）で師範代へ');
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
    // 残り 1 つなら seed が何であれそれ
    for (const seed of [0, 1, 7, 100]) expect(pickTask(YAGURA, done, seed).id).toBe(all[all.length - 1].id);
    const allDone = new Set(all.map((t) => `${YAGURA.id}:${t.id}`));
    expect(pickTask(YAGURA, allDone, 0).id).toBe(all[0].id);
    expect(pickTask(YAGURA, allDone, all.length).id).toBe(all[0].id);
    expect(pickTask(YAGURA, allDone, 1).id).toBe(all[1].id);
  });

  describe('seed で決定的に選ぶ', () => {
    afterEach(() => vi.restoreAllMocks());

    it('乱数を使わず、同じ seed なら何度呼んでも同じ課題（設定画面と対局で一致する）', () => {
      const random = vi.spyOn(Math, 'random');
      for (const st of STYLES) {
        for (let seed = 0; seed < 10; seed++) {
          const first = pickTask(st, new Set(), seed);
          for (let i = 0; i < 20; i++) expect(pickTask(st, new Set(), seed).id, `${st.id} seed=${seed}`).toBe(first.id);
        }
      }
      expect(random).not.toHaveBeenCalled();
    });

    it('seed 省略時は 0 と同じ（既存の呼び方でも決定的）', () => {
      expect(pickTask(YAGURA, new Set()).id).toBe(pickTask(YAGURA, new Set(), 0).id);
      expect(pickTask(YAGURA, new Set()).id).toBe(tasksFor(YAGURA)[0].id);
    });

    it('未達成の候補を戦法固有 → 共通の定義順に回り、候補数で一周する', () => {
      const all = tasksFor(YAGURA);
      // 戦法固有が先、共通（castle … win）が後に並んでいる
      expect(all.slice(-5).map((t) => t.id)).toEqual(['castle', 'no-scold', 'no-bad', 'no-hint', 'win']);
      expect(all[0].id).toBe('bishop-exchange');
      for (let seed = 0; seed < all.length * 2; seed++) {
        expect(pickTask(YAGURA, new Set(), seed).id, `seed=${seed}`).toBe(all[seed % all.length].id);
      }
    });

    it('達成済みは飛ばして残りだけで回る', () => {
      const all = tasksFor(YAGURA);
      const done = new Set([`${YAGURA.id}:${all[0].id}`, `${YAGURA.id}:${all[2].id}`, `${YAGURA.id}:win`]);
      const remaining = all.filter((t) => !done.has(`${YAGURA.id}:${t.id}`));
      expect(remaining.length).toBe(all.length - 3);
      for (let seed = 0; seed < remaining.length * 2; seed++) {
        const t = pickTask(YAGURA, done, seed);
        expect(done.has(`${YAGURA.id}:${t.id}`), `seed=${seed}`).toBe(false);
        expect(t.id, `seed=${seed}`).toBe(remaining[seed % remaining.length].id);
      }
    });

    it('別の戦法の達成は数えない（done のキーは戦法つき）', () => {
      const all = tasksFor(YAGURA);
      const done = new Set([`bougin:${all[0].id}`, 'bougin:castle']);
      expect(pickTask(YAGURA, done, 0).id).toBe(all[0].id);
    });

    it('対局数を seed にすると、対局ごとに次の課題へ進み、達成した課題は次から出ない', () => {
      const p = emptyProgress();
      const all = tasksFor(YAGURA);
      const seen: string[] = [];
      for (let g = 0; g < 4; g++) {
        const games = p.styles.yagura?.games ?? 0;
        // 設定画面のプレビューと startGame が同じ seed を渡せば同じ課題になる
        const preview = pickTask(YAGURA, doneTaskSet(p), games);
        const task = pickTask(YAGURA, doneTaskSet(p), games);
        expect(task.id).toBe(preview.id);
        expect(seen).not.toContain(task.id);
        seen.push(task.id);
        recordGame(p, { styleId: 'yagura', result: 'lose', scolded: 0, task, taskDone: true });
      }
      // 順に回る: 0 → all[0]、達成後 seed 1 で残り [1..] の 1 番目 = all[2]、…
      expect(seen[0]).toBe(all[0].id);
      expect(seen[1]).toBe(all[2].id);
    });

    it('壊れた seed（負・小数・NaN）でも落ちず、候補の中から返す', () => {
      const all = tasksFor(YAGURA);
      const ids = new Set(all.map((t) => t.id));
      for (const seed of [-1, -7, 1.9, NaN, Infinity, -Infinity]) {
        expect(ids.has(pickTask(YAGURA, new Set(), seed).id), `seed=${seed}`).toBe(true);
      }
      expect(pickTask(YAGURA, new Set(), 1.9).id).toBe(all[1].id);
      expect(pickTask(YAGURA, new Set(), NaN).id).toBe(all[0].id);
    });
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

  it('門下生では課題が累計 6 つ必要', () => {
    const p = emptyProgress();
    p.level = 'student';
    const tasks = tasksFor(YAGURA);
    // 課題 5 つと 2 勝では昇級しない
    for (let i = 0; i < 5; i++) expect(recordGame(p, { styleId: 'yagura', result: i < 2 ? 'win' : 'lose', scolded: 0, task: tasks[i], taskDone: true }).promotion).toBeNull();
    expect(p.level).toBe('student');
    // 6 つ目で昇級
    expect(recordGame(p, { styleId: 'yagura', result: 'lose', scolded: 0, task: tasks[5], taskDone: true }).promotion?.to.id).toBe('master');
    expect(p.level).toBe('master');
  });
});

describe('昇級の進み具合', () => {
  it('最初は見習い。門下生へ 2 勝と課題 3 つ、まだ 0', () => {
    const pp = promotionProgress(emptyProgress());
    expect(pp).toEqual({ next: levelById('student'), winsNeeded: PROMOTE_WINS, tasksNeeded: PROMOTE_TASKS, winsHave: 0, tasksHave: 0 });
    expect(promotionLine(emptyProgress())).toBe('昇級まで: あと 2 勝・課題 3（門下生へ）');
  });

  it('勝ちと課題を重ねると have が増え、残りが減る', () => {
    const p = emptyProgress();
    const tasks = tasksFor(YAGURA);
    recordGame(p, { styleId: 'yagura', result: 'win', scolded: 0, task: tasks[0], taskDone: true });
    expect(promotionProgress(p)).toMatchObject({ winsHave: 1, tasksHave: 1, winsNeeded: 2, tasksNeeded: 3 });
    expect(promotionLine(p)).toBe('昇級まで: あと 1 勝・課題 2（門下生へ）');
    // 別の戦法の課題も累計に入る。引き分けは勝ちに数えない
    recordGame(p, { styleId: 'bougin', result: 'draw', scolded: 0, task: tasks[1], taskDone: true });
    expect(promotionProgress(p)).toMatchObject({ winsHave: 1, tasksHave: 2 });
    expect(promotionLine(p)).toBe('昇級まで: あと 1 勝・課題 1（門下生へ）');
    // 負けと未達成では変わらない
    recordGame(p, { styleId: 'yagura', result: 'lose', scolded: 2, task: tasks[2], taskDone: false });
    expect(promotionProgress(p)).toMatchObject({ winsHave: 1, tasksHave: 2 });
  });

  it('昇級すると次の難易度の条件に切り替わり、勝ち数は 0 から。課題は累計のまま', () => {
    const p = emptyProgress();
    const tasks = tasksFor(YAGURA);
    for (let i = 0; i < 3; i++) recordGame(p, { styleId: 'yagura', result: 'win', scolded: 0, task: tasks[i], taskDone: true });
    expect(p.level).toBe('student');
    expect(promotionProgress(p)).toEqual({ next: levelById('master'), winsNeeded: PROMOTE_WINS, tasksNeeded: PROMOTE_TASKS * 2, winsHave: 0, tasksHave: 3 });
    expect(promotionLine(p)).toBe('昇級まで: あと 2 勝・課題 3（師範代へ）');
  });

  it('必要数を超えても「あと」は 0 で止まる', () => {
    const p = emptyProgress();
    p.level = 'student';
    p.winsAtLevel = { student: 5 };
    p.styles.yagura = { games: 5, wins: 5, scolded: 0, tasksDone: ['yagura:win', 'yagura:castle'], badges: [] };
    expect(promotionProgress(p)).toMatchObject({ winsHave: 5, winsNeeded: 2, tasksHave: 2, tasksNeeded: 6 });
    expect(promotionLine(p)).toBe('昇級まで: あと 0 勝・課題 4（師範代へ）');
  });

  it('師範代なら next は null で、一行も出さない', () => {
    const p = emptyProgress();
    p.level = 'master';
    p.winsAtLevel = { apprentice: 2, student: 2, master: 1 };
    const pp = promotionProgress(p);
    expect(pp.next).toBeNull();
    expect(pp.winsNeeded).toBe(0);
    expect(pp.tasksNeeded).toBe(0);
    expect(pp.winsHave).toBe(1);
    expect(promotionLine(p)).toBeNull();
  });

  it('winsHave は今の難易度の勝ち数だけ（前の難易度の勝ちは数えない）', () => {
    const p = emptyProgress();
    p.level = 'student';
    p.winsAtLevel = { apprentice: 4 };
    expect(promotionProgress(p).winsHave).toBe(0);
    p.winsAtLevel.student = 1;
    expect(promotionProgress(p).winsHave).toBe(1);
  });
});

describe('皆伝の条件文', () => {
  it('KAIDEN_CONDITION は免状の説明と同じ文で、いつでも取れる', () => {
    expect(KAIDEN_CONDITION).toBeTruthy();
    expect(KAIDEN_CONDITION).toBe(BADGE_CONDITION.kaiden);
    expect(KAIDEN_CONDITION).toContain('師範代');
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
