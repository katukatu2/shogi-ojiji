// 配信に使う静的ファイルの記載を確かめる: プライバシーポリシー（public/privacy.html）、ストア掲載文（docs/store/listing.md）、
// リリース手順書（docs/release-checklist.md）、Android の CI（.github/workflows/android.yml）。
// YAML の解析ライブラリは入れていないので、ワークフローは文字列で「手順とパスの整合」だけ見る。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('プライバシーポリシー（public/privacy.html）', () => {
  const html = read('public/privacy.html');

  it('日本語の単体ページで、収集しない・通信は配信元だけ・端末内保存・広告解析なし を明記', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html).toContain('個人情報を収集しません');
    expect(html).toContain('配信元');
    expect(html).toContain('localStorage');
    expect(html).toContain('ojiji.progress.v2');
    expect(html).toContain('広告を表示しません');
    expect(html).toContain('解析ツールを組み込んでいません');
    expect(html).toContain('README');
    expect(html).not.toContain('href="（公開先 URL）"');
  });

  it('外部の CSS・スクリプトを読まず、アプリへ戻るリンクがある', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    expect(html).toContain('href="./"');
  });
});

describe('ストア掲載文（docs/store/listing.md）', () => {
  const md = read('docs/store/listing.md');

  it('短い説明は 80 字以内', () => {
    const m = md.match(/## 短い説明[^\n]*\n\n> ([^\n]+)/);
    expect(m).not.toBeNull();
    const text = m![1].trim();
    expect(text.length).toBeGreaterThan(20);
    expect([...text].length).toBeLessThanOrEqual(80);
  });

  it('学習の仕組み・5 戦法・3 段階・やねうら王 を説明している', () => {
    for (const s of ['学習の仕組み', '5 戦法', '3 段階', 'やねうら王', '矢倉', '四間飛車', '角換わり', '棒銀', '中飛車', '見習い', '門下生', '師範代']) {
      expect(md, s).toContain(s);
    }
  });

  it('スクリーンショット 5 枚、クレジット、公開先 URL の置き場、対象年齢、カテゴリ', () => {
    expect((md.match(/^\| [1-5] \|/gm) ?? []).length).toBe(5);
    expect(md).toContain('やねうら王 WebAssembly 版（GPLv3）');
    expect(md).toContain('水匠 Petite');
    expect(md).toContain('無料効果音で遊ぼう！（小森平）');
    expect(md).toContain('https://taira-komori.net/');
    expect(md).toContain('## GPL に基づくソース公開先');
    expect(md).toMatch(/- ソース公開先: (?:https:\/\/\S+|（公開先 URL）)/);
    expect(md).toContain('## 対象年齢とカテゴリ');
    expect(md).toMatch(/- 対象ユーザー: /);
    expect(md).toMatch(/- カテゴリ: /);
    // ストア用アイコンとして案内しているファイルが実在する
    expect(existsSync('public/app-icons/icon-512-square.png')).toBe(true);
  });
});

describe('リリース手順書（docs/release-checklist.md）', () => {
  const md = read('docs/release-checklist.md');

  it('Web → Android → iOS の順に節がある', () => {
    const web = md.indexOf('## 1. Web');
    const android = md.indexOf('## 2. Android');
    const ios = md.indexOf('## 3. iOS');
    expect(web).toBeGreaterThan(0);
    expect(android).toBeGreaterThan(web);
    expect(ios).toBeGreaterThan(android);
  });

  it('COOP/COEP、署名、Play Console、GPL、cap add ios、crossOriginIsolated の手順がある', () => {
    for (const s of [
      'Cross-Origin-Opener-Policy: same-origin', 'Cross-Origin-Embedder-Policy: require-corp', 'coi-serviceworker.js',
      'keytool -genkeypair', 'bundleRelease', 'Play Console', 'GPL', 'npx cap add ios', 'crossOriginIsolated', '判定: 簡易',
    ]) expect(md, s).toContain(s);
  });

  it('チェック項目が [ ] で書かれ、コマンドがコードブロックにある', () => {
    expect((md.match(/^- \[ \] /gm) ?? []).length).toBeGreaterThan(20);
    expect((md.match(/^```bash$/gm) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe('Android の CI（.github/workflows/android.yml）', () => {
  const yml = read('.github/workflows/android.yml');

  it('main への push と手動実行で、Node 22・JDK・Android SDK を入れて APK を残す', () => {
    expect(yml).toMatch(/\non:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n/);
    expect(yml).toContain('node-version: 22');
    expect(yml).toContain('uses: actions/setup-java@v4');
    expect(yml).toContain('uses: android-actions/setup-android@v3');
    expect(yml).toContain('- run: npm ci');
    expect(yml).toContain('- run: npm run build');
    expect(yml).toContain('- run: npx cap sync android');
    expect(yml).toContain('uses: actions/upload-artifact@v4');
    expect(yml).toContain('path: android/app/build/outputs/apk/debug/app-debug.apk');
    // 手順の順序: build → sync → gradle → upload
    const at = (s: string) => yml.indexOf(s);
    expect(at('npm run build')).toBeLessThan(at('npx cap sync android'));
    expect(at('npx cap sync android')).toBeLessThan(at('./gradlew assembleDebug'));
    expect(at('./gradlew assembleDebug')).toBeLessThan(at('upload-artifact'));
  });

  it('gradle は android/ の wrapper に実行ビットを付けてから呼ぶ', () => {
    expect(existsSync('android/gradlew')).toBe(true);
    expect(existsSync('android/gradle/wrapper/gradle-wrapper.jar')).toBe(true);
    expect(existsSync('android/gradle/wrapper/gradle-wrapper.properties')).toBe(true);
    expect(yml).toMatch(/- run: chmod \+x gradlew\n\s+working-directory: android\n/);
    expect(yml).toMatch(/- run: \.\/gradlew assembleDebug[^\n]*\n\s+working-directory: android\n/);
  });

  it('JDK の版は Capacitor の gradle が求める Java の版以上で、手順書とも一致する', () => {
    const java = Number(yml.match(/java-version: (\d+)/)?.[1]);
    const gradles = ['android/app/capacitor.build.gradle', 'node_modules/@capacitor/android/capacitor/build.gradle'].filter((f) => existsSync(f));
    const need = Math.max(...gradles.map((f) => Number(read(f).match(/JavaVersion\.VERSION_(\d+)/)?.[1] ?? 0)));
    expect(need).toBeGreaterThan(0);
    expect(java).toBeGreaterThanOrEqual(need);
    expect(read('docs/release-checklist.md')).toContain(`JDK ${java}`);
  });

  it('SDK の版は android/variables.gradle の compileSdkVersion と同じ', () => {
    const sdk = Number(read('android/variables.gradle').match(/compileSdkVersion = (\d+)/)?.[1]);
    expect(sdk).toBeGreaterThan(0);
    expect(yml).toContain(`platforms;android-${sdk}`);
  });
});

describe('配信先の Apache で横取りされるフォルダー名', () => {
  // Apache の既定設定は /icons/ /error/ /manual/ /cgi-bin/ をサーバー内蔵の場所へ Alias している。
  // エックスサーバーでも /icons/ が横取りされ、public/icons/ に置いたアイコン 5 枚が全部 404 になった。
  // .htaccess では外せない（Alias はディレクトリの設定より先に処理される）ので、名前を避けるしかない。
  it('public/ の直下に、その名前のフォルダーを置かない', () => {
    const reserved = ['icons', 'error', 'manual', 'cgi-bin'];
    const dirs = readdirSync('public', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs.filter((d) => reserved.includes(d))).toEqual([]);
  });
});

// LINE・X でリンクを共有したときの表示。知人に送る最初の一通が、題名と絵の付いた見た目になるように
describe('共有したときの表示（OGP）', () => {
  const html = read('index.html');
  const meta = (attr: string, key: string) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];

  it('題名・説明・URL・画像を持ち、URL は公開先の絶対 URL', () => {
    expect(meta('property', 'og:title')).toBe('将棋オジジの定石指南');
    expect(meta('property', 'og:url')).toBe('https://shogi.godo-amity.com/');
    expect(meta('property', 'og:image')).toBe('https://shogi.godo-amity.com/ogp.jpg');
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
    // 説明文はストア掲載文の短い説明と同じもの
    const lines = read('docs/store/listing.md').split(String.fromCharCode(10));
    const short = lines[lines.findIndex((l) => l.startsWith('## 短い説明')) + 2].replace(/^> /, '').trim();
    expect(meta('property', 'og:description')).toBe(short);
    expect(meta('name', 'description')).toBe(short);
  });

  it('画像は public にあり、宣言した 1200×630 の JPEG で、重すぎない', () => {
    const jpg = readFileSync('public/ogp.jpg');
    expect(jpg[0]).toBe(0xff);
    expect(jpg[1]).toBe(0xd8);
    // JPEG の SOF マーカーから幅と高さを読む
    let size: [number, number] | null = null;
    for (let i = 2; i < jpg.length - 9; ) {
      if (jpg[i] !== 0xff) { i++; continue; }
      const marker = jpg[i + 1];
      const len = jpg.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) { size = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)]; break; }
      i += 2 + len;
    }
    expect(size).toEqual([Number(meta('property', 'og:image:width')), Number(meta('property', 'og:image:height'))]);
    expect(size).toEqual([1200, 630]);
    expect(jpg.length).toBeLessThan(300 * 1024);
  });

  it('共有用の画像はオフライン保存の対象に入れない（遊ぶ人の端末には要らない）', () => {
    expect(read('scripts/prepare-offline.mjs')).toContain("'ogp.jpg'");
  });
});
