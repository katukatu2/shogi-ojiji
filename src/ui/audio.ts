// 効果音。オジジの声は使わない。
// - 駒音（public/sfx/koma.mp3、約 15KB）: 駒を動かすたびに鳴らす。
//   「無料効果音で遊ぼう！（小森平）https://taira-komori.net/」の「将棋の駒パチン４」（nc260487）を利用
// - 雷（public/sfx/bakamon_thunder.mp3）: 「ばかもーん！」の場面だけ。元の WAV は assets-src/sfx にあり、scripts/encode-sfx.mjs で変換する
// - 駒音と雷は別の <audio> 要素。雷は鳴らす前に前の雷を止める（重なりなし）。駒音は短いので頭出しして鳴らすだけ
// - ミュート・再生失敗・自動再生制限のときは何もしない。ゲームの進行は音に依存しない
// - スマートフォンの自動再生制限に備え、最初のタップで一度だけ両方の要素を鳴らして解錠する

// ファイルを差し替えたときはここを変えると、古いキャッシュを使わなくなる
const SFX_VERSION = '2026-09-09b';
const THUNDER = 'sfx/bakamon_thunder.mp3';
const THUNDER_VOLUME = 0.1; // 雷は大きすぎるので 10% の音量で鳴らす
const PIECE = 'sfx/koma.mp3';
const PIECE_VOLUME = 0.6;

let muted = false;
let audio: HTMLAudioElement | null = null;
let piece: HTMLAudioElement | null = null;
let unlocked = false;

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
  }
  return audio;
}

function pieceElement(): HTMLAudioElement {
  if (!piece) {
    piece = new Audio();
    piece.preload = 'auto';
    piece.src = `${PIECE}?v=${SFX_VERSION}`;
    piece.volume = PIECE_VOLUME;
  }
  return piece;
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
  for (const a of [audio, piece]) {
    if (a && !a.paused) {
      try {
        a.pause();
      } catch {
        // 無視
      }
    }
  }
}

// 駒音。駒を動かすたびに鳴らす（連続で鳴っても頭出しするだけ）
export function playPiece(): void {
  if (muted) return;
  const a = pieceElement();
  try {
    a.currentTime = 0;
  } catch {
    // まだ読み込めていないときは無視
  }
  a.play().catch(() => undefined);
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
  a.src = `${THUNDER}?v=${SFX_VERSION}`;
  for (const x of [a, pieceElement()]) {
    x.muted = true;
    x.play()
      .then(() => {
        x.pause();
        x.currentTime = 0;
      })
      .catch(() => undefined)
      .finally(() => {
        x.muted = false;
      });
  }
}

// 開発時の確認用: 内部の <audio> 要素
export function sfxElementForDebug(): HTMLAudioElement | null {
  return audio;
}

export function pieceElementForDebug(): HTMLAudioElement | null {
  return piece;
}
