import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkArtifacts } from '../scripts/release-artifacts.mjs';

function fixture() {
  const version = '12345678901234567890';
  const bodies: Record<string, Buffer> = { 'dist/index.html': Buffer.from('<h1>release</h1>'), 'dist/LICENSE.txt': Buffer.from('license') };
  const assets = ['./', './LICENSE.txt'];
  bodies['dist/offline-assets.json'] = Buffer.from(JSON.stringify({ version, assets, sha256: Object.fromEntries(assets.map((asset) =>
    [asset, createHash('sha256').update(bodies[asset === './' ? 'dist/index.html' : 'dist/LICENSE.txt']).digest('hex')])) }));
  bodies['dist/coi-serviceworker.js'] = Buffer.from(`const VERSION = '${version}';`);
  return { bodies, read: (file: string) => bodies[file] ?? readFileSync(file) };
}

it('実際のネイティブ設定・アイコンと整合した配布物が通る', () => {
  expect(checkArtifacts(fixture().read)).toEqual([]);
});

it.each(['alpha', 'android', 'ios', 'build', 'missing', 'hash', 'worker'])(
  '配布物の欠陥 %s を検出する', (kind) => {
    const { bodies, read } = fixture();
    if (kind === 'alpha') {
      const file = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
      bodies[file] = readFileSync(file); bodies[file][25] = 6;
    } else if (kind === 'android') {
      const file = 'android/app/build.gradle';
      bodies[file] = Buffer.from(read(file).toString().replace(/versionName "[^"]+"/, 'versionName "9.9.9"'));
    } else if (kind === 'ios' || kind === 'build') {
      const file = 'ios/App/App.xcodeproj/project.pbxproj';
      bodies[file] = Buffer.from(read(file).toString().replace(kind === 'ios' ? /MARKETING_VERSION = [^;]+/ : /CURRENT_PROJECT_VERSION = [^;]+/, 'MARKETING_VERSION = 9.9.9'));
    } else if (kind === 'worker') bodies['dist/coi-serviceworker.js'] = Buffer.from("const VERSION = 'stale';");
    else if (kind === 'hash') bodies['dist/index.html'] = Buffer.from('changed after build');
    expect(checkArtifacts((file) => { if (kind === 'missing' && file === 'dist/LICENSE.txt') throw new Error('ENOENT'); return read(file); })).toHaveLength(1);
  },
);
