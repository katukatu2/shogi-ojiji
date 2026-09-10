import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

// 公開先が未定でも生成物の欠陥を独立して検出する。read は壊れた配布物の回帰試験にも使う。
export function checkArtifacts(read = (file) => readFileSync(file)) {
  const errors = [];
  const check = (name, fn) => { try { fn(); } catch (e) { errors.push(`${name}: ${e.message}`); } };
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  check('iOS AppIcon', () => {
    const png = read('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
    require(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'PNGではない');
    require(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, '1024×1024が必要');
    require(png[24] === 8 && png[25] === 2, '8bit RGB（αチャネルなし）が必要');
  });
  check('バージョン', () => {
    const version = JSON.parse(read('package.json').toString()).version;
    const android = read('android/app/build.gradle').toString();
    const ios = read('ios/App/App.xcodeproj/project.pbxproj').toString();
    const code = android.match(/versionCode\s+(\d+)/)?.[1];
    require(android.match(/versionName\s+"([^"]+)"/)?.[1] === version, 'Android versionNameがpackage.jsonと不一致');
    const versions = [...ios.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
    const builds = [...ios.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1]);
    require(versions.length >= 2 && versions.every((v) => v === version), 'iOS MARKETING_VERSIONがpackage.jsonと不一致');
    require(!!code && builds.length >= 2 && builds.every((v) => v === code), 'iOS CURRENT_PROJECT_VERSIONがAndroid versionCodeと不一致');
  });
  check('オフライン配布物', () => {
    const manifest = JSON.parse(read('dist/offline-assets.json').toString());
    const sw = read('dist/coi-serviceworker.js').toString();
    require(/^[0-9a-f]{20}$/.test(manifest.version) && sw.includes(`const VERSION = '${manifest.version}';`), 'SWとmanifestのバージョンが不一致');
    require(Array.isArray(manifest.assets) && manifest.assets.includes('./') && manifest.assets.includes('./LICENSE.txt'), 'HTMLまたはGPL本文が対象外');
    for (const asset of manifest.assets) {
      const path = 'dist/' + (asset === './' ? 'index.html' : asset.slice(2));
      require(asset.startsWith('./') && resolve(path).startsWith(resolve('dist') + sep), `範囲外のパス: ${asset}`);
      require(createHash('sha256').update(read(path)).digest('hex') === manifest.sha256?.[asset], `欠落またはハッシュ不一致: ${asset}`);
    }
  });
  return errors;
}
