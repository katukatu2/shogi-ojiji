import { test, expect, type Page } from '@playwright/test';
import { startBouginGame, playMove, gameState, readProgress, waitForQuiet } from './helpers';

// 初期局面から双方の駒を運ぶ長い棋譜に依存させず、入玉直前だけ開発用口から用意する。
// 以後の入玉・応手・宣言・結果表示は本番と同じ盤とボタンを操作し、Judgeも差し替えない。
async function prepare(page: Page, kind: 'entry' | 'short' | 'npc' | 'check'): Promise<void> {
  await page.route('**/engine/yaneuraou.k-p.js', route => route.abort());
  await startBouginGame(page);
  await expect(page.locator('.start-banner')).toBeHidden();
  await page.evaluate(kind => {
    const api = (window as any).__ojiji;
    const g = api.game();
    const p = new g.pos.constructor();
    p.set(8,kind === 'entry' ? 3 : 2,{type:'OU',color:0});
    p.set(0,kind === 'entry' ? 5 : 6,{type:'OU',color:1});
    for(const x of [0,1,2,3]) p.set(x,0,{type:'KI',color:0});
    for(const x of [4,5,6,7]) p.set(x,0,{type:'GI',color:0});
    p.set(6,1,{type:'HI',color:0}); p.set(7,1,{type:'KA',color:0});
    p.hands[0].KE=4; p.hands[0].KY=kind === 'short' || kind === 'npc' ? 1 : 2;
    p.hands[0].FU=kind === 'entry' || kind === 'check' ? 4 : 0;
    if(kind !== 'entry') {
      p.set(1,8,{type:'RY',color:1}); p.set(2,8,{type:'UM',color:1});
      for(const x of [3,4,5,6]) p.set(x,8,{type:'TO',color:1});
      for(const x of [1,2,3,4]) p.set(x,7,{type:'FU',color:1});
      p.hands[1].FU=kind === 'npc' ? 9 : 6;
    }
    if(kind === 'check') p.set(8,0,{type:'KY',color:1});
    g.pos = p; api.render();
  },kind);
}

test('片側の入玉を知らせ、宣言を選ぶまで続行し、宣言すると勝利を一局だけ記録する', async ({page}, info) => {
  await page.setViewportSize({width:390,height:844});
  await prepare(page,'entry');
  await expect(page.getByRole('button',{name:'持将棋を宣言する'})).toHaveCount(0);
  await playMove(page,[1,4],[1,3]);
  await expect(page.locator('.bubble')).toContainText('おぬしの玉が入玉したぞ');
  await expect.poll(async () => (await gameState(page))?.busy).toBe(false);
  const declare = page.getByRole('button',{name:'持将棋を宣言する'});
  await expect(declare).toBeEnabled();
  await expect(page.locator('.entering-status')).toContainText('点数 28/28点');
  expect((await gameState(page))?.result).toBeNull();
  const logs = await page.evaluate(() => (window as any).__ojiji.game().logs);
  expect(logs).toHaveLength(1);
  expect(logs[0].level).toBe(1); // 安全な入玉を簡易Judgeが悪手扱いしない
  await info.attach('入玉時の実判定', {body:JSON.stringify(logs,null,2),contentType:'application/json'});
  for (const [width,height] of [[390,844],[360,640]]) {
    await page.setViewportSize({width,height});
    await declare.scrollIntoViewIfNeeded();
    await info.attach(`入玉-${width}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  }
  await declare.click();
  await expect(page.locator('.mate-banner')).toContainText('入玉宣言（あなた）');
  await expect(page.locator('.mate-banner')).toContainText('あなたの勝ち');
  await page.getByRole('button',{name:'オジジの一言を聞く'}).click();
  await expect(page.locator('.result')).toBeVisible();
  const progress = await readProgress(page) as any;
  expect(progress.styles.bougin.games).toBe(1);
  expect(progress.styles.bougin.wins).toBe(1);
});

test('双方が入玉していても先手23点では自動負けにせず、宣言を無効にして不足点を見せる', async ({page}) => {
  await prepare(page,'short');
  await playMove(page,[1,3],[1,2]);
  await expect.poll(async () => (await gameState(page))?.busy).toBe(false);
  await expect(page.getByRole('button',{name:'持将棋を宣言する'})).toBeDisabled();
  await expect(page.locator('.entering-status')).toContainText('点数 23/28点');
  expect((await gameState(page))?.result).toBeNull();
  await expect(page.locator('.mate-banner')).toHaveCount(0);
});

test('オジジは後手27点の条件がある自分の手番だけ入玉宣言して決着する', async ({page}) => {
  await prepare(page,'npc');
  await playMove(page,[1,3],[1,2]);
  await expect(page.locator('.mate-banner')).toContainText('入玉宣言（オジジ）');
  await expect(page.locator('.mate-banner')).toContainText('後手（オジジ）の勝ち');
});

test('王手中は点数があっても宣言を押せず、王手を防ぐ案内が出る', async ({page}) => {
  await prepare(page,'check');
  await expect(page.getByRole('button',{name:'持将棋を宣言する'})).toBeDisabled();
  await expect(page.locator('.entering-status')).toContainText('王手中は宣言できません');
});

test('待ったで入玉前に戻して指し直しても、入玉の一言を繰り返さない', async ({page}) => {
  await prepare(page,'entry');
  await playMove(page,[1,4],[1,3]);
  await expect(page.locator('.bubble')).toContainText('おぬしの玉が入玉したぞ');
  await expect.poll(async () => (await gameState(page))?.busy).toBe(false);
  await waitForQuiet(page);
  await page.getByRole('button',{name:'待った',exact:true}).click();
  await waitForQuiet(page);
  await playMove(page,[1,4],[1,3]);
  await expect.poll(async () => (await gameState(page))?.busy).toBe(false);
  // 無言なら可視の吹き出し自体がない。「要素が存在して文言が違う」を要求しない。
  await expect(page.locator('.bubble:visible').filter({hasText:'おぬしの玉が入玉したぞ'})).toHaveCount(0);
  await expect(page.locator('.entering-status')).toContainText('あなたが入玉');
});
