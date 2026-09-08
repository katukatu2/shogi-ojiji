// public/raizo/raizo-rig.js の純粋な部分（姿勢の計算と、描画を回す区間の判定）を Node 上で確かめる。
// Canvas は使わないので、HTMLElement などは空の代用品を渡す。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

type Motion = { face: string; brow: boolean; headAngle: number; jump: number; scale: number; effects: number; shakeX: number };
type Rig = {
  RaizoRigStates: Record<string, { duration: number; loop?: boolean; windows?: [number, number][] }>;
  RaizoRigMotion: (state: string, t: number) => Motion;
  RaizoRigSchedule: { inWindow: (s: string, t: number) => boolean; untilNextWindow: (s: string, t: number) => number | null };
};

function loadRig(): Rig {
  const src = readFileSync('public/raizo/raizo-rig.js', 'utf-8');
  const win: Record<string, unknown> = {};
  class FakeElement {}
  const fn = new Function('window', 'HTMLElement', 'customElements', 'matchMedia', src);
  fn(win, FakeElement, undefined, () => ({ matches: false }));
  return win as unknown as Rig;
}

describe('顔リグ', () => {
  const rig = loadRig();
  const STATES = ['idle', 'thinking', 'nod', 'good', 'doubtful', 'bad', 'angry', 'surprised'];

  it('8 状態がそろい、顔素材は 7 種と眉だけを使う', () => {
    expect(Object.keys(rig.RaizoRigStates).sort()).toEqual([...STATES].sort());
    const faces = new Set<string>();
    for (const s of STATES) for (let t = 0; t < 6; t += 0.05) faces.add(rig.RaizoRigMotion(s, t).face);
    expect([...faces].sort()).toEqual(['blink', 'neutral', 'shout', 'sip', 'sour', 'surprise', 'think']);
  });

  it('状態ごとの表情: 怒りは shout と放射線、驚きは跳ね、悪手は拡大', () => {
    expect(rig.RaizoRigMotion('angry', 0.2)).toMatchObject({ face: 'shout', scale: 1.12 });
    expect(rig.RaizoRigMotion('angry', 0.2).effects).toBeGreaterThan(0);
    expect(rig.RaizoRigMotion('angry', 2.2).effects).toBe(0); // 終わりには収まる
    expect(rig.RaizoRigMotion('surprised', 0.35).jump).toBeLessThan(-30);
    expect(rig.RaizoRigMotion('bad', 0.48).scale).toBeGreaterThan(1.1);
    expect(rig.RaizoRigMotion('bad', 2.2).scale).toBeCloseTo(1, 5);
    expect(rig.RaizoRigMotion('good', 2).face).toBe('sip');
    expect(rig.RaizoRigMotion('doubtful', 0.6).brow).toBe(true);
    expect(rig.RaizoRigMotion('doubtful', 0.2).brow).toBe(false);
  });

  it('ループ状態は、動く区間の外では静止していて、区間の中だけ描画を回す', () => {
    const { inWindow, untilNextWindow } = rig.RaizoRigSchedule;
    // idle: まばたきの前後で表情が変わる。区間はそれを含む
    expect(rig.RaizoRigMotion('idle', 3.75).face).toBe('blink');
    expect(inWindow('idle', 3.75)).toBe(true);
    expect(inWindow('idle', 1.0)).toBe(false);
    expect(untilNextWindow('idle', 1.0)).toBeCloseTo(2.66, 5);
    expect(untilNextWindow('idle', 4.0)).toBeCloseTo(4.46, 5); // 一周して次のまばたきまで
    // 区間の外では姿勢が変わらない（静止画で済む）
    for (const s of ['idle', 'thinking', 'doubtful']) {
      const st = rig.RaizoRigStates[s];
      let prev: Motion | null = null;
      for (let t = 0; t < st.duration; t += 0.01) {
        const m = rig.RaizoRigMotion(s, t);
        if (prev && !inWindow(s, t) && !inWindow(s, t - 0.01)) {
          expect(m.face).toBe(prev.face);
          expect(m.brow).toBe(prev.brow);
          expect(Math.abs(m.headAngle - prev.headAngle)).toBeLessThan(1e-6);
        }
        prev = m;
      }
    }
  });

  it('単発動作は duration で止まり、ループ状態は周期で巻き戻る', () => {
    expect(rig.RaizoRigStates.nod.loop).toBeUndefined();
    expect(rig.RaizoRigMotion('nod', 5).headAngle).toBeCloseTo(rig.RaizoRigMotion('nod', 1.6).headAngle, 9);
    expect(rig.RaizoRigMotion('idle', 4.8 + 3.75).face).toBe('blink');
  });
});
