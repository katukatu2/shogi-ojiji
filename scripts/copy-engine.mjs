// node_modules のやねうら王 WASM を public/engine にコピーする（npm run engine:copy）
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('node_modules/@mizarjp/yaneuraou.k-p/lib');
const dst = resolve('public/engine');
mkdirSync(dst, { recursive: true });
for (const f of ['yaneuraou.k-p.js', 'yaneuraou.k-p.wasm', 'yaneuraou.k-p.worker.js']) {
  copyFileSync(resolve(src, f), resolve(dst, f));
  console.log('copied', f);
}
