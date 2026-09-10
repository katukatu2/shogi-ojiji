// public/icon.svg からアイコンの PNG 一式を作る（npm run icons）。@resvg/resvg-js で描くので、ブラウザや ImageMagick は要らない。
//
// 出力（生成物は git に入れる。icon.svg を変えたら作り直す）:
//   public/icons/icon-192.png, icon-512.png ................ PWA 用（purpose any）。角丸の外は透明
//   public/icons/icon-512-maskable.png ...................... PWA 用（purpose maskable）。manifest の background_color で余白を取り、
//                                                             角丸の角まで安全域（中心から半径 40% の円）に収める。どの形に切り抜かれても角が欠けない
//   public/icons/apple-touch-icon-180.png ................... iOS のホーム画面用。透明は黒く塗られるので、地の色で四隅まで塗りつぶす（角の丸めは iOS がする）
//   public/icons/icon-512-square.png ........................ Play Console に出すアイコン。同じく四隅まで塗る（角の丸めは Play がする）
//   android/app/src/main/res/mipmap-*/ic_launcher.png ....... 旧式のランチャー（48dp）。角丸の外は透明
//   android/app/src/main/res/mipmap-*/ic_launcher_round.png . 旧式の丸いランチャー（48dp）。values/ic_launcher_background.xml の色の円に収める
//   android/app/src/main/res/mipmap-*/ic_launcher_foreground.png . adaptive icon の前景（108dp 相当）。中央の安全域（66dp の円）に収め、周りは透明。
//                                                             背景は mipmap-anydpi-v26/ic_launcher.xml の @color/ic_launcher_background が付く
//
// 使い方: node scripts/build-icons.mjs
// src/icons.test.ts が、ここで書き出した寸法と manifest・index.html の整合を確かめる。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { opaqueRgbPng } from './rgb-png.mjs';

/** 端末の密度ごとの倍率（mdpi を 1 とする） */
export const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** 旧式ランチャーの一辺（dp） */
export const LAUNCHER_DP = 48;
/** adaptive icon の一辺（dp）と、その中で必ず見える安全域の円の直径（dp） */
export const ADAPTIVE_DP = 108;
export const ADAPTIVE_SAFE_DP = 66;
/** 前景 PNG は 108dp の 1.5 倍で書き出す（@capacitor/assets と同じ寸法。Android が 108dp に縮めて使う） */
export const FOREGROUND_SCALE = 1.5;
/** maskable アイコンの安全域: 中心から半径 40% の円（W3C の定義） */
export const MASKABLE_SAFE_RADIUS = 0.4;
/** 安全域ぎりぎりに置かず、少し内側に寄せる（縁のにじみ対策） */
export const SAFE_MARGIN = 0.96;
/** manifest や Android の設定が読めないときの余白の色 */
const DEFAULT_WEB_BACKDROP = '#efe6d2';
const DEFAULT_ANDROID_BACKDROP = '#ffffff';

/**
 * 書き出す PNG の一覧。file はリポジトリ直下からの相対パス、kind は composeSvg の描き方。
 * @returns {{ file: string, size: number, kind: IconKind }[]}
 */
export function listOutputs() {
  const list = [
    { file: 'public/icons/icon-192.png', size: 192, kind: 'plain' },
    { file: 'public/icons/icon-512.png', size: 512, kind: 'plain' },
    { file: 'public/icons/icon-512-maskable.png', size: 512, kind: 'maskable' },
    { file: 'public/icons/apple-touch-icon-180.png', size: 180, kind: 'square' },
    { file: 'public/icons/icon-512-square.png', size: 512, kind: 'square' },
    { file: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024, kind: 'square' },
  ];
  for (const suffix of ['', '-1', '-2']) {
    list.push({ file: `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732${suffix}.png`, size: 2732, kind: 'splash' });
  }
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const dir = `android/app/src/main/res/mipmap-${density}`;
    list.push({ file: `${dir}/ic_launcher.png`, size: Math.round(LAUNCHER_DP * scale), kind: 'launcher' });
    list.push({ file: `${dir}/ic_launcher_round.png`, size: Math.round(LAUNCHER_DP * scale), kind: 'launcher-round' });
    list.push({ file: `${dir}/ic_launcher_foreground.png`, size: Math.round(ADAPTIVE_DP * FOREGROUND_SCALE * scale), kind: 'foreground' });
  }
  return list;
}
export const OUTPUTS = listOutputs();

/**
 * 半径 radius の円に収まる角丸正方形の一辺。corner は「角の半径 ÷ 一辺」（0 で普通の正方形、0.5 で円）。
 * 角丸正方形で中心から一番遠いのは角の弧の上の点で、その距離は (1/2 - corner)·√2 + corner（一辺 1 のとき）。
 */
export function fitSide(radius, corner) {
  const k = Math.min(0.5, Math.max(0, corner));
  return radius / ((0.5 - k) * Math.SQRT2 + k);
}

/** リポジトリ直下（scripts/ の一つ上） */
export function repoRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * icon.svg と、余白の色の設定を読む。
 * 角の丸みと地の色は icon.svg の最初の rect から取るので、SVG を描き直しても追従する。
 * @returns {IconContext}
 */
export function loadContext(root = repoRoot()) {
  const svg = readFileSync(join(root, 'public', 'icon.svg'), 'utf8');
  const open = svg.match(/<svg\b[^>]*>/);
  if (!open || !svg.includes('</svg>')) throw new Error('public/icon.svg: <svg> が見つからない');
  const viewBox = open[0].match(/\bviewBox="([^"]+)"/)?.[1] ?? '0 0 256 256';
  const width = Number(viewBox.split(/\s+/)[2]);
  const rect = svg.match(/<rect\b[^>]*>/)?.[0] ?? '';
  const rx = Number(rect.match(/\brx="([\d.]+)"/)?.[1] ?? 0);
  const fill = rect.match(/\bfill="([^"]+)"/)?.[1] ?? DEFAULT_WEB_BACKDROP;
  const inner = svg.slice(open.index + open[0].length, svg.lastIndexOf('</svg>'));
  return {
    viewBox,
    inner,
    fill,
    corner: width > 0 ? rx / width : 0,
    webBackdrop: readWebBackdrop(root),
    androidBackdrop: readAndroidBackdrop(root),
  };
}

// manifest.webmanifest の background_color（maskable の余白の色に使う）
function readWebBackdrop(root) {
  try {
    const m = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'));
    return typeof m.background_color === 'string' ? m.background_color : DEFAULT_WEB_BACKDROP;
  } catch {
    return DEFAULT_WEB_BACKDROP;
  }
}

// android の values/ic_launcher_background.xml の色（adaptive icon の背景と同じ色を丸いランチャーにも使う）
function readAndroidBackdrop(root) {
  const file = join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml');
  if (!existsSync(file)) return DEFAULT_ANDROID_BACKDROP;
  const m = readFileSync(file, 'utf8').match(/name="ic_launcher_background">\s*(#[0-9a-fA-F]{6,8})\s*</);
  return m ? m[1] : DEFAULT_ANDROID_BACKDROP;
}

/**
 * kind ごとに、icon.svg を入れ子の <svg> として置いた描画用の SVG を組み立てる。
 * @param {IconKind} kind
 * @param {number} size 出力の一辺（px）
 * @param {IconContext} ctx
 */
export function composeSvg(kind, size, ctx) {
  const c = size / 2;
  // 一辺 side でアイコンを中央に置く
  const icon = (side) => {
    const o = (size - side) / 2;
    return `<svg x="${o}" y="${o}" width="${side}" height="${side}" viewBox="${ctx.viewBox}">${ctx.inner}</svg>`;
  };
  const square = (fill) => `<rect width="${size}" height="${size}" fill="${fill}"/>`;
  let body;
  switch (kind) {
    case 'plain':
    case 'launcher':
      body = icon(size);
      break;
    case 'square':
      body = square(ctx.fill) + icon(size);
      break;
    case 'splash':
      body = square(ctx.webBackdrop) + icon(size * 0.18);
      break;
    case 'maskable':
      body = square(ctx.webBackdrop) + icon(fitSide(size * MASKABLE_SAFE_RADIUS, ctx.corner) * SAFE_MARGIN);
      break;
    case 'launcher-round':
      body = `<circle cx="${c}" cy="${c}" r="${c}" fill="${ctx.androidBackdrop}"/>` + icon(fitSide(c, ctx.corner) * SAFE_MARGIN);
      break;
    case 'foreground':
      body = icon(fitSide((size * ADAPTIVE_SAFE_DP) / ADAPTIVE_DP / 2, ctx.corner) * SAFE_MARGIN);
      break;
    default:
      throw new Error(`unknown icon kind: ${kind}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

/** SVG を size px 四方に描く。pixels は RGBA の生データ（テストで色を見る用）、png はファイルに書く中身 */
export function render(svg, size) {
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
  return { width: image.width, height: image.height, pixels: image.pixels, png: image.asPng() };
}

/** OUTPUTS を全部書き出す。戻り値は書いたファイルと大きさ */
export function buildAll(root = repoRoot()) {
  const ctx = loadContext(root);
  const written = [];
  for (const o of OUTPUTS) {
    const rendered = render(composeSvg(o.kind, o.size, ctx), o.size);
    const { width, height } = rendered;
    const png = o.file.includes('/AppIcon.appiconset/') ? opaqueRgbPng(rendered) : rendered.png;
    if (width !== o.size || height !== o.size) throw new Error(`${o.file}: ${width}x${height} になった（${o.size} のはず）`);
    const path = join(root, o.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    written.push({ file: o.file, size: o.size, bytes: png.length });
  }
  return written;
}

// node scripts/build-icons.mjs として直接呼ばれたときだけ書き出す（テストから import したときは何もしない）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const w of buildAll()) console.log(`${w.file}  ${w.size}x${w.size}  ${(w.bytes / 1024).toFixed(1)} KB`);
}

/**
 * @typedef {'plain' | 'maskable' | 'square' | 'splash' | 'launcher' | 'launcher-round' | 'foreground'} IconKind
 * @typedef {{ viewBox: string, inner: string, fill: string, corner: number, webBackdrop: string, androidBackdrop: string }} IconContext
 */
