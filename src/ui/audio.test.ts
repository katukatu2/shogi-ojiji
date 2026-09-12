import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAudio {
  static all: FakeAudio[] = [];
  src = ''; muted = false; volume = 1; currentTime = 0; preload = ''; paused = true;
  calls: { src: string; muted: boolean; volume: number }[] = [];
  finish!: () => void;
  reject!: () => void;
  constructor() { FakeAudio.all.push(this); }
  pause = vi.fn(() => { this.paused = true; });
  play(): Promise<void> {
    this.paused = false;
    this.calls.push({ src: this.src, muted: this.muted, volume: this.volume });
    if (this.src.startsWith('data:')) return new Promise((resolve, reject) => {
      this.finish = resolve; this.reject = () => reject(new Error('autoplay denied'));
    });
    return Promise.resolve();
  }
}
beforeEach(() => { vi.resetModules(); FakeAudio.all = []; vi.stubGlobal('Audio', FakeAudio); });
afterEach(() => vi.unstubAllGlobals());
const settled = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('効果音の解錠と実再生の順序', () => {
  it('開始時は無音だけ。解錠中の駒音を待たせ、後始末で実再生を止めたりミュートしない', async () => {
    const sfx = await import('./audio');
    sfx.warmUp();
    const [thunder, piece] = FakeAudio.all;
    sfx.playPiece();
    expect(piece.calls).toHaveLength(1);
    expect(piece.calls[0].src).toMatch(/^data:audio\/wav/);
    piece.finish(); await settled();
    expect(piece.calls[1]).toMatchObject({src: expect.stringContaining('koma.mp3'), muted: false, volume: 0.6});
    expect(piece.paused).toBe(false);
    thunder.finish(); await settled();
    expect(piece.paused).toBe(false);
    expect(piece.pause).toHaveBeenCalledTimes(1);
    expect(thunder.calls).toHaveLength(1);
  });

  it.each(['stop', 'mute'] as const)('%s は解錠待ちの効果音も取り消す', async (action) => {
    const sfx = await import('./audio');
    sfx.warmUp(); sfx.playPiece();
    if (action === 'stop') sfx.stopSfx(); else sfx.setMuted(true);
    FakeAudio.all.forEach(a => a.finish()); await settled();
    expect(FakeAudio.all.every(a => a.calls.length === 1 && a.paused)).toBe(true);
    sfx.setMuted(false); sfx.playPiece();
    expect(FakeAudio.all[1].calls).toHaveLength(2);
  });

  it('解錠中の雷が待機中の駒音を取り消し、10%で一度だけ鳴る', async () => {
    const sfx = await import('./audio');
    sfx.warmUp(); sfx.playPiece(); sfx.playThunder();
    FakeAudio.all.forEach(a => a.finish()); await settled();
    const [thunder,piece] = FakeAudio.all;
    expect(piece.calls).toHaveLength(1);
    expect(thunder.calls[1]).toMatchObject({src: expect.stringContaining('bakamon_thunder.mp3'), muted:false, volume:0.1});
  });

  it('解錠失敗の後始末も再生より先に完了し、次の開始で再試行できる', async () => {
    const sfx = await import('./audio');
    sfx.warmUp(); sfx.playPiece();
    FakeAudio.all.forEach(a => a.reject()); await settled();
    expect(FakeAudio.all[1].paused).toBe(false);
    sfx.stopSfx(); sfx.warmUp();
    expect(FakeAudio.all[0].calls).toHaveLength(2);
    FakeAudio.all.forEach(a => a.finish()); await settled();
  });
});
