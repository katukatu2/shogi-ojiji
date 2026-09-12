// 効果音。オジジの声は使わない。
// - 駒音（public/sfx/koma.mp3、約 15KB）: 駒を動かすたびに鳴らす。
//   「無料効果音で遊ぼう！（小森平）https://taira-komori.net/」の「将棋の駒パチン４」（nc260487）を利用
// - 雷（public/sfx/bakamon_thunder.mp3）: 「ばかもーん！」の場面だけ。元の WAV は assets-src/sfx にあり、scripts/encode-sfx.mjs で変換する
// - 駒音と雷は別の <audio> 要素。雷は鳴らす前に前の雷を止める（重なりなし）。駒音は短いので頭出しして鳴らすだけ
// - ミュート・再生失敗・自動再生制限のときは何もしない。ゲームの進行は音に依存しない
// - 最初のタップでは無音PCMで本番の要素を解錠する。効果音は解錠の後始末が済んでから再生する

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
const warming = new Map<HTMLAudioElement, Promise<void>>();
const requests = new Map<HTMLAudioElement, number>();
let stopSerial = 0;

// 10ms・8kHz・16bit mono の無音WAV。効果音素材を再生せず、同じ要素の再生許可だけ得る。
function silence(): string {
  const bytes = new Uint8Array(44 + 160);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => [...value].forEach((c, i) => { bytes[offset + i] = c.charCodeAt(0); });
  label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, 160, true);
  return 'data:audio/wav;base64,' + btoa(String.fromCharCode(...bytes));
}

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
  stopSerial++; // 解錠待ちの音も取り消す（タイトルへ戻った後などに遅れて鳴らさない）
  for (const a of [audio, piece]) {
    if (a && !a.paused && !warming.has(a)) {
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
  playAfterWarmUp(pieceElement(), PIECE, PIECE_VOLUME);
}

// 「ばかもーん！」の雷。1 回だけ鳴らす
export function playThunder(): void {
  stopSfx();
  if (muted) return;
  playAfterWarmUp(element(), THUNDER, THUNDER_VOLUME);
}

function playAfterWarmUp(a: HTMLAudioElement, path: string, volume: number): void {
  const serial = stopSerial;
  const request = (requests.get(a) ?? 0) + 1;
  requests.set(a, request);
  const play = () => {
    if (muted || serial !== stopSerial || requests.get(a) !== request) return;
    const src = `${path}?v=${SFX_VERSION}`;
    if (!a.src.endsWith(src)) a.src = src;
    a.volume = volume;
    try { a.currentTime = 0; } catch { /* 読み込み前の頭出し失敗は無視 */ }
    a.play().catch(() => undefined);
  };
  const ready = warming.get(a);
  if (ready) void ready.then(play);
  else play();
}

// 解錠は要素ごと。専用の別要素への許可が本番要素に引き継がれるとは限らないため、
// 本番の2要素を無音で準備する。muted/volume は変更せず、実再生は必ず後始末を待つ。
export function warmUp(): void {
  if (unlocked || warming.size > 0) return;
  unlocked = true;
  const src = silence();
  for (const x of [element(), pieceElement()]) {
    x.src = src;
    const ready = x.play()
      .catch(() => { unlocked = false; }) // 拒否されたら次の開始操作で再試行できる
      .then(() => {
        try { x.pause(); x.currentTime = 0; } catch { /* 読み込めない環境でも進行は止めない */ }
        warming.delete(x);
      });
    warming.set(x, ready);
  }
}

// 開発時の確認用: 内部の <audio> 要素
export function sfxElementForDebug(): HTMLAudioElement | null {
  return audio;
}

export function pieceElementForDebug(): HTMLAudioElement | null {
  return piece;
}
