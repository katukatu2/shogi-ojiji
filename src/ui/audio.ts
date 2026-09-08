// 効果音。オジジの声は使わない。「ばかもーん！」の場面だけ、雷の効果音（public/sfx/bakamon_thunder.wav）を鳴らす。
// - 1 本の <audio> 要素で鳴らし、鳴らす前に前の音を止める（重なりなし）
// - ミュート・再生失敗・自動再生制限のときは何もしない。ゲームの進行は音に依存しない
// - スマートフォンの自動再生制限に備え、最初のタップで一度だけ要素を鳴らして解錠する

// ファイルを差し替えたときはここを変えると、古いキャッシュを使わなくなる
const SFX_VERSION = '2026-09-08a';
const THUNDER = 'sfx/bakamon_thunder.wav';
const THUNDER_VOLUME = 0.1; // 雷は大きすぎるので 10% の音量で鳴らす

let muted = false;
let audio: HTMLAudioElement | null = null;
let unlocked = false;

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
  }
  return audio;
}

export function setMuted(v: boolean): void {
  muted = v;
  if (v) stopSfx();
}

export function isMuted(): boolean {
  return muted;
}

// 鳴っている効果音を止める
export function stopSfx(): void {
  const a = audio;
  if (a && !a.paused) {
    try {
      a.pause();
    } catch {
      // 無視
    }
  }
}

// 「ばかもーん！」の雷。1 回だけ鳴らす
export function playThunder(): void {
  stopSfx();
  if (muted) return;
  const a = element();
  const src = `${THUNDER}?v=${SFX_VERSION}`;
  if (!a.src.endsWith(src)) a.src = src;
  a.volume = THUNDER_VOLUME;
  a.currentTime = 0;
  a.play().catch(() => undefined);
}

// 最初のタップで <audio> を解錠しておく（iOS などは操作の中で一度鳴らした要素しか鳴らせない）
export function warmUp(): void {
  if (unlocked) return;
  unlocked = true;
  const a = element();
  a.muted = true;
  a.src = `${THUNDER}?v=${SFX_VERSION}`;
  a.play()
    .then(() => {
      a.pause();
      a.currentTime = 0;
    })
    .catch(() => undefined)
    .finally(() => {
      a.muted = false;
    });
}

// 開発時の確認用: 内部の <audio> 要素
export function sfxElementForDebug(): HTMLAudioElement | null {
  return audio;
}
