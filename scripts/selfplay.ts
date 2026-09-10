// 自動対局でオジジの台詞を集める（npx vite-node scripts/selfplay.ts -- --games 25 --seed 1 --out logs/a.jsonl）
// 実機と同じ Judge / plan / patterns とエンジンを Node で動かし、プレイヤー側はエンジン弱体化＋戦型スクリプトで指す。

import { createRequire } from 'node:module';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Position } from '../src/engine/position';
import { Move } from '../src/engine/types';
import { moveToUsi, moveToKanji, usiToMove, sqToKanji } from '../src/engine/notation';
import { PIECE_NAME } from '../src/engine/types';
import { Engine, EngineFactory, Analysis } from '../src/ai/engine';
import { chooseMove } from '../src/ai/search';
import { Judge, bestCaptureGain, safeMove } from '../src/style/judge';
import { choosePlanMove, planApplies, planComment, PlanState } from '../src/style/plan';
import { STYLES, findStyle } from '../src/style/index';

const require = createRequire(import.meta.url);

interface Opening {
  name: string;
  moves: string[]; // 先手のスクリプト（合法なら順に指す。合法でなければ飛ばす）
  blunderRate: number; // ランダムな手を指す確率
}

const OPENINGS: Opening[] = [
  { name: '棒銀', moves: ['7g7f', '2g2f', '2f2e', '3i3h', '3h2g', '2g2f', '5i6h', '6h7h'], blunderRate: 0.1 },
  { name: '四間飛車', moves: ['7g7f', '6g6f', '2h6h', '5i4h', '4h3h', '3i3h', '3h2h', '4i5h', '7i7h', '9g9f', '1g1f'], blunderRate: 0.1 },
  { name: '中飛車', moves: ['7g7f', '5g5f', '2h5h', '5f5e', '5i4h', '3i3h', '4h3i', '3i2h', '4i5h'], blunderRate: 0.1 },
  { name: '角換わり', moves: ['7g7f', '2g2f', '8h2b+', '7i8h', '3i3h', '5i6h', '6h7h', '2f2e'], blunderRate: 0.1 },
  { name: '相矢倉', moves: ['7g7f', '6g6f', '7i6h', '5g5f', '3i4h', '4i5h', '6i7h', '5i6i', '5h6g', '6h7g', '8h7i', '3g3f'], blunderRate: 0.05 },
  { name: '右四間', moves: ['7g7f', '4g4f', '3i3h', '2h4h', '3h4g', '5i6h', '6h7h', '4f4e'], blunderRate: 0.15 },
  { name: '居玉突撃', moves: ['7g7f', '2g2f', '2f2e', '3i3h', '3h2g', '2g3f', '3f4e', '8h5e'], blunderRate: 0.3 },
  { name: '端攻め好き', moves: ['9g9f', '9f9e', '1g1f', '1f1e', '7g7f', '5i6h', '6h7h', '9i9h'], blunderRate: 0.2 },
  { name: '早繰り銀', moves: ['7g7f', '2g2f', '3i4h', '4h3g', '3g4f', '2f2e', '5i6h', '6h7h'], blunderRate: 0.1 },
  { name: '玉飛接近癖', moves: ['2g2f', '5i4h', '4h3h', '2f2e', '7g7f', '3i4h'], blunderRate: 0.2 },
  { name: 'ランダム多め', moves: [], blunderRate: 0.4 },
  { name: 'エンジン任せ', moves: ['7g7f'], blunderRate: 0.02 },
];

// 再現できる乱数
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const GAMES = Number(arg('games', '10'));
const SEED = Number(arg('seed', '1'));
const OUT = arg('out', 'logs/selfplay.jsonl');
const MAX_PLIES = Number(arg('plies', '120'));
const JUDGE_MS = Number(arg('judgeMs', '80'));
const STYLE_ID = arg('style', 'yagura');
const STYLE = findStyle(STYLE_ID) ?? STYLES[0];

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, '');
const log = (o: Record<string, unknown>) => appendFileSync(OUT, JSON.stringify(o) + '\n');

async function playerMove(pos: Position, engine: Engine, opening: Opening, random: () => number, ply: number): Promise<Move> {
  const legal = pos.legalMoves();
  const scripted = opening.moves[Math.floor(ply / 2)];
  if (scripted) {
    const m = legal.find((l) => moveToUsi(l) === scripted);
    if (m) return m;
  }
  if (random() < opening.blunderRate) return legal[Math.floor(random() * legal.length)];
  const list = await engine.analyzeMulti(pos.moves.map(moveToUsi), { depth: 5, multipv: 4 });
  const cands = list.map((a) => legal.find((l) => moveToUsi(l) === a.bestmove)).filter((m): m is Move => !!m);
  if (cands.length === 0) return legal[Math.floor(random() * legal.length)];
  // 上位ほど選ばれやすい
  const weights = cands.map((_, i) => 1 / (i + 1));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i];
    if (r <= 0) return cands[i];
  }
  return cands[0];
}

async function ojijiMove(pos: Position, engine: Engine, judge: Judge, variant: string[], state: PlanState, random: () => number): Promise<Move | null> {
  let m: Move | null = null;
  if (planApplies(pos)) {
    const current = await judge.evalOf(pos).catch(() => undefined);
    m = await choosePlanMove(pos, variant, state, { evaluator: engine, current, analyzeMs: JUDGE_MS, reactions: STYLE.reactions, tolerance: STYLE.planTolerance });
  }
  if (!m) {
    const list = await engine.analyzeMulti(pos.moves.map(moveToUsi), { depth: 6, multipv: 3 });
    if (list.length && list[0].bestmove) {
      const best = -list[0].cp;
      const okay = list.filter((a) => a.bestmove && best - -a.cp <= 150);
      const pick = okay[Math.floor(random() * okay.length)] ?? list[0];
      m = safeMove(pos, pick.bestmove!) ?? safeMove(pos, list[0].bestmove);
    }
  }
  if (!m) m = chooseMove(pos, { depth: 2, timeMs: 300, noise: 0.5 });
  return m;
}

async function playGame(id: number, engine: Engine, random: () => number): Promise<void> {
  const opening = OPENINGS[id % OPENINGS.length];
  const variant = STYLE.plans[Math.floor(random() * STYLE.plans.length)];
  const pos = Position.initial();
  const judge = new Judge(engine, { analyzeMs: JUDGE_MS, bad: STYLE.badPatterns, good: STYLE.goodPatterns });
  const state: PlanState = { done: new Set() };
  let lastWhisper = -100;
  let lastCheck = -100;
  const counts = { scold: 0, bad: 0, l3: 0, l2: 0, praise: 0, redo: 0 };
  let result = 'draw';

  while (pos.moves.length < MAX_PLIES) {
    // 先手（プレイヤー）
    let m = await playerMove(pos, engine, opening, random, pos.moves.length);
    const before = pos.moves.map(moveToUsi).join(' ');
    const j = await judge.judge(pos, m);
    const base = { game: id, opening: opening.name, variant: variant.name, ply: pos.moves.length + 1, before, move: moveToKanji(m, 0, null, pos), usi: moveToUsi(m) };
    if (j.verdict) {
      const v = j.verdict;
      const redo = v.level >= 4 && random() < 0.5 && v.better !== null;
      log({ ...base, type: 'verdict', level: v.level, kind: v.kind, headline: v.headline, why: v.why, evalLine: v.evalLine ?? '', better: v.better ? moveToKanji(v.better, 0, null, pos) : '', redo });
      if (v.level === 5) counts.scold++;
      else if (v.level === 4) counts.bad++;
      else if (v.level === 3) counts.l3++;
      else counts.l2++;
      if (redo) {
        counts.redo++;
        m = v.better!;
      } else if (v.level >= 4) {
        judge.ignore(v.ignoreKey);
      }
    } else if (j.praise) {
      counts.praise++;
      log({ ...base, type: 'praise', why: j.praise.comment });
    }
    pos.apply(m);
    if (pos.isGameOver()) { result = 'win'; break; }

    // 後手（オジジ）
    const om = await ojijiMove(pos, engine, judge, variant.moves, state, random);
    if (!om) { result = 'win'; break; }
    const obase = { game: id, opening: opening.name, variant: variant.name, ply: pos.moves.length + 1, before: pos.moves.map(moveToUsi).join(' '), move: moveToKanji(om, 1, null, pos), usi: moveToUsi(om) };
    pos.apply(om);
    if (pos.isGameOver()) { result = 'lose'; break; }
    const comment = planComment(STYLE, pos, om);
    if (comment) log({ ...obase, type: 'mutter', why: comment });
    else if (pos.inCheck(0)) {
      if (pos.moves.length - lastCheck >= 6) {
        lastCheck = pos.moves.length;
        log({ ...obase, type: 'mutter', why: '王手じゃ。' });
      }
    }
    else if (pos.moves.length - lastWhisper >= 6) {
      const threat = bestCaptureGain(pos, 1);
      if (threat.gain >= 5 && threat.target && threat.victim) {
        lastWhisper = pos.moves.length;
        log({ ...obase, type: 'whisper', why: `……${sqToKanji(threat.target.to)}の${PIECE_NAME[threat.victim]}に狙いをつけたぞ。気づいておるか。`, gain: threat.gain });
      }
    }
  }
  log({ game: id, style: STYLE.id, opening: opening.name, variant: variant.name, type: 'result', result, plies: pos.moves.length, ...counts });
  console.log(`game ${id} ${opening.name}/${variant.name} ${result} ${pos.moves.length}ply scold=${counts.scold} bad=${counts.bad} l3=${counts.l3} l2=${counts.l2} praise=${counts.praise}`);
}

(async () => {
  let engine: Engine | undefined;
  let failures = 0;
  try {
    const factory = require('@mizarjp/yaneuraou.k-p') as EngineFactory;
    engine = new Engine(factory, 1);
    await engine.init();
    const random = rng(SEED);
    const start = Number(arg('start', '0'));
    for (let i = start; i < start + GAMES; i++) {
      try {
        await playGame(i, engine, random);
      } catch (err) {
        failures++;
        console.error('game failed', i, err);
        log({ game: i, type: 'error', message: String(err) });
      }
    }
  } catch (err) {
    failures++;
    console.error('selfplay failed', err);
    log({ type: 'error', message: String(err) });
  } finally {
    engine?.terminate();
  }
  process.exit(failures > 0 ? 1 : 0);
})();
