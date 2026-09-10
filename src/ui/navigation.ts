export type ScreenName = 'title' | 'settings' | 'game';
const DEPTH: Record<ScreenName, number> = { title: 0, settings: 1, game: 2 };

// history.go(-2) が発火する popstate は 1 回。戻った「件数」でイベントを消費しない。
// 履歴の移動は非同期なので、完了前に届いた画面遷移も最後の希望画面へ揃える。
export class ScreenHistory {
  private screen: ScreenName = 'title';
  private depth = 0;
  private moving = false;
  private onAligned?: () => void;

  constructor(private onBack: (screen: ScreenName) => void) {
    const stale = history.state?.ojiji;
    history.replaceState({ ...history.state, ojiji: 0 }, '');
    window.addEventListener('popstate', this.onPop);
    // 再読み込み前に積んだ同一URLの段を畳んでから、今回の画面履歴を始める。
    if (Number.isInteger(stale) && stale > 0 && stale <= 2) {
      this.moving = true;
      history.go(-stale);
    }
  }

  // 戻りの履歴移動が未完了なら、次画面の表示を最後の要求1件だけ待たせる。
  // 古い段数が偶然同じでも、次画面を表示する時点ではその画面の履歴が確定している。
  go(name: ScreenName, onAligned?: () => void): boolean {
    this.screen = name;
    this.onAligned = onAligned;
    if (!this.moving) this.align();
    if (this.moving) return false;
    this.onAligned = undefined;
    return true;
  }

  private align(): void {
    const target = DEPTH[this.screen];
    if (target > this.depth) {
      while (this.depth < target) history.pushState({ ojiji: ++this.depth }, '');
    } else if (target < this.depth) {
      this.moving = true;
      history.go(target - this.depth);
    }
  }

  private onPop = (event: PopStateEvent): void => {
    const depth = event.state?.ojiji;
    this.depth = Number.isInteger(depth) && depth >= 0 && depth <= 2 ? depth : 0;
    if (this.moving) {
      this.moving = false;
      this.align();
      if (!this.moving) {
        const ready = this.onAligned;
        this.onAligned = undefined;
        ready?.();
      }
      return;
    }
    this.onBack(this.screen);
  };
}
