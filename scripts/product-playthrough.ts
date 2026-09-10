// 手動採取用CLI。継続的な回帰検査は npm run e2e:fullgame で実行する。
import { chromium } from '@playwright/test';
import { runProductGame } from './product-game';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await runProductGame(page, {
    url: arg('url', 'http://127.0.0.1:5181'),
    out: arg('out', 'logs/product-playthrough'),
    maxPlies: Number(arg('plies', '240')),
  });
} finally {
  await browser.close();
}
