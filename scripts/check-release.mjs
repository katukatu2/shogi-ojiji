// 公開情報の入力漏れを検出する事前チェック。ストア審査・実機検証・ライセンス確認の代替ではない。
import { readFileSync, existsSync } from 'node:fs';
import { checkArtifacts } from './release-artifacts.mjs';
const pending = checkArtifacts();
const artifactsOnly = process.argv.includes('--artifacts-only');
for (const file of artifactsOnly ? [] : ['src/main.ts', 'public/privacy.html', 'docs/store/listing.md', 'README.md']) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('（公開先 URL）') || text.includes('data-release-pending=')) pending.push(`${file}: 公開情報が未確定`);
}
if (!existsSync('dist/LICENSE.txt')) pending.push('dist/LICENSE.txt: GPL本文が未同梱（npm run build が必要）');
if (pending.length) {
  console.error('公開前の未完了項目:\n' + pending.map((item) => '- ' + item).join('\n'));
  process.exitCode = 1;
} else {
  console.log(artifactsOnly ? '生成物チェック完了（アイコン・版番号・資源ハッシュ）。' : '公開情報・生成物のチェック完了。別途、実機・配布条件・署名を確認してください。');
}
