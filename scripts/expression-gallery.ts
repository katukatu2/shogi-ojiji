// オジジの表情一覧を 1 枚の HTML にする（npx vite-node scripts/expression-gallery.ts）
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { ojijiSvg, Expression } from '../src/ui/ojiji';

const css = readFileSync('src/style.css', 'utf-8');
const items: [Expression, string, string][] = [
  ['normal', '仏頂面', 'タイトル・平常時・負けたとき'],
  ['thinking', '考え顔', '思考中・ヒント・待った・小声の助言・「良い手じゃな」'],
  ['nod', '頷き', '良い手を指したとき'],
  ['stern', '渋い顔', '「むう…」・王手・大駒を取られたとき'],
  ['scold', '渋い顔＋指差し', '「それは悪手じゃろう」（段階4）'],
  ['angry', '怒鳴り顔', '「ばかもーん！」（段階5）'],
  ['shocked', '驚き', 'オジジが負けたとき'],
];
const cards = items.map(([e, name, when]) => `
  <div class="card"><div class="face">${ojijiSvg(e)}</div><b>${name}</b><small>${e}</small><p>${when}</p></div>`).join('');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>オジジ 表情一覧</title>
<style>${css}
body{background:#efe6d2;padding:16px;font-family:system-ui,sans-serif}
h1{font-size:18px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.card{background:#fffaf0;border-radius:12px;padding:10px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.card .face svg{width:100%;height:auto}
.card b{display:block;font-size:15px;margin-top:4px}
.card small{color:#777}
.card p{font-size:12px;margin:6px 0 0;line-height:1.5}
</style></head><body><h1>将棋オジジ 表情一覧（動きつき）</h1><div class="grid">${cards}</div></body></html>`;
mkdirSync('docs', { recursive: true });
writeFileSync('docs/ojiji-expressions.html', html);
console.log('wrote docs/ojiji-expressions.html');
