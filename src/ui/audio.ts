// 雷蔵の声。VOICEVOX:麒ヶ島宗麟 の確定素材（public/sfx/raizo_*.wav）をそのまま鳴らす。
// - 再生は 1 本の <audio> 要素で行い、新しい声を鳴らす前に前の声を止める（重なりなし）
// - play() は再生終了（または失敗・ミュート）で解決する Promise を返す。
//   終了イベントに合わせて動作（お茶を飲むなど）をつなぐために使う。途中で止められたときは ended: false
// - スマートフォンの自動再生制限に備え、最初のタップで一度だけ要素を鳴らして解錠する

export type VoiceName = 'nod' | 'good' | 'doubtful' | 'bad' | 'angry';

// ファイルを差し替えたときはここを変えると、古いキャッシュを使わなくなる
const VOICE_VERSION = '2026-09-06a';

const FILES: Record<VoiceName, string> = {
  nod: 'sfx/raizo_nod.wav',
  good: 'sfx/raizo_good.wav',
  doubtful: 'sfx/raizo_doubtful.wav',
  bad: 'sfx/raizo_bad.wav',
  angry: 'sfx/raizo_angry.wav',
};

export interface VoiceResult {
  ended: boolean; // 最後まで鳴った
  // ended でないときの理由。stopped = 別の声や画面遷移で止めた（続きの動作はしない）、
  // muted / failed = 鳴らせなかっただけ（続きの動作はそのまま進める）
  reason: 'ended' | 'stopped' | 'muted' | 'failed';
}

let muted = false;
let audio: HTMLAudioElement | null = null;
let serial = 0;
let unlocked = false;
let current: { serial: number; resolve: (r: VoiceResult) => void } | null = null;

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => finish('ended'));
    audio.addEventListener('error', () => finish('failed'));
  }
  return audio;
}

function finish(reason: VoiceResult['reason']): void {
  const c = current;
  current = null;
  if (c) c.resolve({ ended: reason === 'ended', reason });
}

export function setMuted(v: boolean): void {
  muted = v;
  if (v) stopVoice();
}

export function isMuted(): boolean {
  return muted;
}

// 再生中の声を止める。止められた再生の Promise は ended: false で解決する
export function stopVoice(): void {
  const a = audio;
  if (a && !a.paused) {
    try {
      a.pause();
    } catch {
      // 無視
    }
  }
  finish('stopped');
}

// 声を 1 回鳴らす。前の声は止める。ミュート・失敗・自動再生制限のときは即座に解決する
export function playVoice(name: VoiceName): Promise<VoiceResult> {
  stopVoice();
  if (muted) return Promise.resolve({ ended: false, reason: 'muted' });
  const a = element();
  const mine = ++serial;
  return new Promise<VoiceResult>((resolve) => {
    current = { serial: mine, resolve };
    a.src = `${FILES[name]}?v=${VOICE_VERSION}`;
    a.currentTime = 0;
    a.play().catch(() => {
      // 自動再生制限や読み込み失敗。ゲームの進行は止めない
      if (current && current.serial === mine) finish('failed');
    });
  });
}

// 最初のタップで <audio> を解錠しておく（iOS などは操作の中で一度鳴らした要素しか鳴らせない）
export function warmUp(): void {
  if (unlocked) return;
  unlocked = true;
  const a = element();
  if (current) return; // すでに何か鳴っている
  a.muted = true;
  a.src = `${FILES.nod}?v=${VOICE_VERSION}`;
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
export function voiceElementForDebug(): HTMLAudioElement | null {
  return audio;
}
