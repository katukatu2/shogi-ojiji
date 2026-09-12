import { test, expect } from '@playwright/test';
import { playMove, startBouginGame } from './helpers';

test('対局開始は駒音なし、最初の着手ではミュートされていない駒音が鳴る', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).audioCalls = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as any).audioCalls.push({ src: this.src, muted: this.muted, volume: this.volume });
      return original.call(this);
    };
  });
  await startBouginGame(page);
  await expect(page.locator('.start-banner')).toBeHidden();
  const pieces = () => page.evaluate(() => (window as any).audioCalls.filter((c: any) => c.src.includes('koma.mp3')));
  expect(await pieces()).toHaveLength(0);
  await playMove(page, [7, 7], [7, 6]);
  await expect.poll(async () => (await pieces()).length).toBeGreaterThan(0);
  expect((await pieces())[0]).toMatchObject({ muted: false, volume: 0.6 });
});
