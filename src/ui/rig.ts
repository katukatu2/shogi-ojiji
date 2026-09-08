// 雷蔵（オジジ）のパーツアニメーション <raizo-rig> の薄いラッパー。
// - 要素は 1 つだけ作り、タイトル・対局・カットイン・結果の間で移動して使う（二重再生と再読み込みを避ける）
// - play() はゲームの出来事が起きたときだけ呼ぶ。描画更新のたびには呼ばない
// - 単発動作（nod / good / bad / angry / surprised）の終了は raizo-complete で受け、
//   古い動作の終了処理が新しい動作を上書きしないよう、再生ごとの番号で見分ける

export type RigState = 'idle' | 'thinking' | 'nod' | 'good' | 'doubtful' | 'bad' | 'angry' | 'surprised';

const ONE_SHOT: ReadonlySet<RigState> = new Set(['nod', 'good', 'bad', 'angry', 'surprised']);

interface RaizoElement extends HTMLElement {
  state: string;
  play(state: string): void;
  pause(): void;
  resume(): void;
  seek(t: number): void;
}

export class OjijiRig {
  readonly el: RaizoElement | null;
  private serial = 0; // play() のたびに増える番号
  private after: (() => void) | null = null; // 今の単発動作が終わったときにすること
  private current: RigState = 'idle';
  private ready = false;
  private pending: RigState | null = null; // 素材の読み込み前に頼まれた状態

  constructor() {
    const supported = typeof window !== 'undefined' && !!window.customElements?.get('raizo-rig');
    this.el = supported ? (document.createElement('raizo-rig') as RaizoElement) : null;
    if (!this.el) return;
    this.el.setAttribute('state', 'idle');
    this.el.addEventListener('raizo-ready', () => {
      this.ready = true;
      if (this.pending) {
        const s = this.pending;
        this.pending = null;
        this.play(s);
      }
    });
    this.el.addEventListener('raizo-complete', (ev) => {
      const detail = (ev as CustomEvent<{ state: string }>).detail;
      if (detail.state !== this.current) return; // 古い動作の終了通知
      const done = this.after;
      this.after = null;
      if (done) done();
    });
    document.addEventListener('visibilitychange', () => {
      if (!this.el) return;
      if (document.hidden) this.el.pause();
      else this.el.resume();
    });
  }

  get available(): boolean {
    return this.el !== null;
  }

  get state(): RigState {
    return this.current;
  }

  // 状態を再生する。単発動作なら、終了後に then() を呼ぶ（新しい play() があれば呼ばない）
  play(state: RigState, then?: () => void): void {
    if (!this.el) return;
    if (!this.ready) {
      this.pending = state;
      this.current = state;
      this.after = then ?? null;
      return;
    }
    this.serial++;
    const mine = this.serial;
    this.current = state;
    this.after = ONE_SHOT.has(state) && then ? () => { if (mine === this.serial) then(); } : null;
    try {
      this.el.play(state);
      this.el.resume();
    } catch (err) {
      console.warn('raizo play failed', err);
    }
  }

  // ループ状態（idle / thinking / doubtful）へ。単発動作の途中なら、その終了を待ってから切り替える
  settle(state: RigState): void {
    if (!this.el) return;
    if (ONE_SHOT.has(this.current) && this.after !== null) {
      // 終了後の行き先を差し替える
      const mine = this.serial;
      this.after = () => { if (mine === this.serial) this.play(state); };
      return;
    }
    if (this.current !== state) this.play(state);
  }

  // 要素を別の親へ移す（同じ要素を使い回すので、再読み込みも二重再生も起きない）
  mount(parent: HTMLElement): void {
    if (!this.el) return;
    if (this.el.parentElement !== parent) parent.append(this.el);
  }

  unmount(): void {
    this.el?.remove();
  }
}
