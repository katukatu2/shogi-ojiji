export type ScreenName = 'title' | 'settings' | 'game';
const DEPTH: Record<ScreenName, number> = { title: 0, settings: 1, game: 2 };

// history.go(-2) が発火する popstate は 1 回。戻った「件数」でイベントを消費しない。
// 履歴の移動は非同期なので、完了前に届いた画面遷移も最後の希望画面へ揃える。
export class ScreenHistory {
  private screen: ScreenName = 'title';
  private depth = 0;
  private moving = false;

  constructor(private onBack: (screen: ScreenName) => void) {
    history.replaceState({ ...history.state, ojiji: 0 }, '');
    window.addEventListener('popstate', this.onPop);
  }

  go(name: ScreenName): void {
    this.screen = name;
    if (!this.moving) this.align();
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
      return;
    }
    this.onBack(this.screen);
  };
}
