import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('dist');
// 配布物にも GPL 本文を同梱する。ソース公開の代わりになるものではない。
copyFileSync('LICENSE', resolve(root, 'LICENSE.txt'));
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name).slice(root.length + 1).replaceAll('\\', '/'))
  .filter((file) => !['offline-assets.json', 'coi-serviceworker.js'].includes(file))
  .sort();
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(readFileSync(resolve(root, file)));
const worker = readFileSync('public/coi-serviceworker.js', 'utf8');
hash.update(worker);
const version = hash.digest('hex').slice(0, 20);
writeFileSync(resolve(root, 'coi-serviceworker.js'), worker.replace("const VERSION = 'development';", `const VERSION = '${version}';`));
writeFileSync(resolve(root, 'offline-assets.json'), JSON.stringify({ version, assets: ['./', ...files.map((file) => './' + file)] }, null, 2) + '\n');
console.log(`Offline release ${version}: ${files.length + 1} resources`);
