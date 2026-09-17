// scripts/build-icons.mjs（アイコン生成）の描き方と、書き出した PNG・manifest・index.html の整合を確かめる。
// 生成物は git に入れてあるので、icon.svg を変えて `npm run icons` を忘れると、ここで寸法の違いとして見つかる。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADAPTIVE_DP, ADAPTIVE_SAFE_DP, DENSITIES, MASKABLE_SAFE_RADIUS, OUTPUTS, SAFE_MARGIN,
  composeSvg, fitSide, loadContext, render, repoRoot,
  type IconKind, type Rendered,
} from '../scripts/build-icons.mjs';

const root = repoRoot();
const ctx = loadContext(root);

// PNG の IHDR から幅と高さを読む
function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.toString('ascii', 1, 4)).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function pixel(img: Rendered, x: number, y: number): [number, number, number, number] {
  const o = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2], img.pixels[o + 3]];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function draw(kind: IconKind, size: number): Rendered {
  return render(composeSvg(kind, size, ctx), size);
}

// 半径 radius の安全域に収めたアイコンの、中心から上辺までの距離（生成側と同じ式）
function halfSide(radius: number): number {
  return (fitSide(radius, ctx.corner) * SAFE_MARGIN) / 2;
}

describe('アイコン生成（scripts/build-icons.mjs）', () => {
  it('iOSの実PNGを独立したデコーダで読み、元のレンダリングと全画素の色が一致する', () => {
    const png = readFileSync(join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));
    const decoded = render(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><image width="1024" height="1024" href="data:image/png;base64,${png.toString('base64')}"/></svg>`, 1024);
    const source = draw('square', 1024);
    expect(Buffer.from(decoded.pixels).equals(Buffer.from(source.pixels))).toBe(true);
  });
  it('icon.svg から地の色と角の丸みを読む', () => {
    expect(ctx.viewBox).toBe('0 0 256 256');
    expect(ctx.fill).toBe('#2b3a55');
    expect(ctx.corner).toBeCloseTo(56 / 256, 6);
    expect(ctx.webBackdrop).toBe('#efe6d2'); // manifest の background_color
    expect(ctx.androidBackdrop.toLowerCase()).toBe('#efe6d2'); // values/ic_launcher_background.xml（Web と同じ生成り色）
    // 今のオジジ（雷蔵）の顔を JPEG で埋め込む（scripts/build-icon-svg.py）。手描きの図形だった以前の icon.svg とは作りが違う
    expect(ctx.inner).toContain('<image');
  });

  it('fitSide: 角丸が無ければ円に内接する正方形、角丸が半分なら円そのもの', () => {
    expect(fitSide(1, 0)).toBeCloseTo(Math.SQRT2, 6);
    expect(fitSide(1, 0.5)).toBeCloseTo(2, 6);
    const side = fitSide(1, ctx.corner);
    expect(side).toBeGreaterThan(Math.SQRT2);
    expect(side).toBeLessThan(2);
    // 角の弧の上の一番遠い点が、ちょうど半径 1 に乗る
    const far = (side / 2 - side * ctx.corner) * Math.SQRT2 + side * ctx.corner;
    expect(far).toBeCloseTo(1, 6);
  });

  it('any 用と旧式ランチャー: 角丸の外は透明で、中は描かれている', () => {
    for (const [kind, size] of [['plain', 192], ['launcher', 48]] as const) {
      const img = draw(kind, size);
      expect(pixel(img, 0, 0)[3]).toBe(0);
      expect(pixel(img, size / 2, size / 2)[3]).toBe(255);
      expect(pixel(img, size / 2, 1)).toEqual([...hexToRgb(ctx.fill), 255]); // 上辺の中央は地の色
    }
  });

  it('maskable: 余白は manifest の色で塗り、角丸の角まで安全域の円に収める', () => {
    const size = 512;
    const img = draw('maskable', size);
    const backdrop: [number, number, number, number] = [...hexToRgb(ctx.webBackdrop), 255];
    expect(pixel(img, 0, 0)).toEqual(backdrop);
    expect(pixel(img, size / 2, 1)).toEqual(backdrop);
    // 安全域の円のすぐ外（対角線上）はまだ余白
    const d = (MASKABLE_SAFE_RADIUS * size) / Math.SQRT2 + 2;
    expect(pixel(img, size / 2 + d, size / 2 + d)).toEqual(backdrop);
    // 中央には顔があり、アイコンの上辺のすぐ内側は地の色
    expect(pixel(img, size / 2, size / 2)[3]).toBe(255);
    expect(pixel(img, size / 2, size / 2 - halfSide(MASKABLE_SAFE_RADIUS * size) * 0.95)).toEqual([...hexToRgb(ctx.fill), 255]);
    // 透明な画素が一つも無い
    for (let i = 3; i < img.pixels.length; i += 4) if (img.pixels[i] !== 255) throw new Error(`透明な画素がある: ${i / 4}`);
  });

  it('apple-touch-icon と Play 用: 四隅まで地の色で、透明が無い', () => {
    const img = draw('square', 180);
    expect(pixel(img, 0, 0)).toEqual([...hexToRgb(ctx.fill), 255]);
    expect(pixel(img, 179, 179)).toEqual([...hexToRgb(ctx.fill), 255]);
    expect(pixel(img, 90, 90)[3]).toBe(255);
  });

  it('丸いランチャー: 円の外は透明、円の中は Android の背景色の上にアイコン', () => {
    const size = 192;
    const img = draw('launcher-round', size);
    expect(pixel(img, 0, 0)[3]).toBe(0);
    expect(pixel(img, size / 2, 1)).toEqual([...hexToRgb(ctx.androidBackdrop), 255]);
    expect(pixel(img, size / 2, size / 2)[3]).toBe(255);
    expect(pixel(img, size / 2, size / 2 - halfSide(size / 2) * 0.95)).toEqual([...hexToRgb(ctx.fill), 255]);
  });

  it('adaptive icon の前景: 周りは透明で、角丸の角が 66dp の安全域に収まる', () => {
    const size = 648;
    const img = draw('foreground', size);
    const c = size / 2;
    const safe = (size * ADAPTIVE_SAFE_DP) / ADAPTIVE_DP / 2;
    expect(pixel(img, 0, 0)[3]).toBe(0);
    expect(pixel(img, c, 1)[3]).toBe(0);
    const d = safe / Math.SQRT2 + 2;
    expect(pixel(img, c + d, c + d)[3]).toBe(0); // 安全域の円のすぐ外
    expect(pixel(img, c, c)[3]).toBe(255);
    expect(pixel(img, c, c - halfSide(safe) * 0.95)).toEqual([...hexToRgb(ctx.fill), 255]); // アイコンの上辺のすぐ内側は地の色
  });

  it('書き出す一覧: Web 5 点と Android 5 密度 × 3 点で、寸法が dp に合う', () => {
    const byFile = new Map(OUTPUTS.map((o) => [o.file, o]));
    expect(byFile.get('public/app-icons/icon-192.png')).toMatchObject({ size: 192, kind: 'plain' });
    expect(byFile.get('public/app-icons/icon-512.png')).toMatchObject({ size: 512, kind: 'plain' });
    expect(byFile.get('public/app-icons/icon-512-maskable.png')).toMatchObject({ size: 512, kind: 'maskable' });
    expect(byFile.get('public/app-icons/apple-touch-icon-180.png')).toMatchObject({ size: 180, kind: 'square' });
    expect(byFile.get('public/app-icons/icon-512-square.png')).toMatchObject({ size: 512, kind: 'square' });
    const expected: Record<string, [number, number]> = { mdpi: [48, 162], hdpi: [72, 243], xhdpi: [96, 324], xxhdpi: [144, 486], xxxhdpi: [192, 648] };
    for (const density of Object.keys(DENSITIES)) {
      const dir = `android/app/src/main/res/mipmap-${density}`;
      expect(byFile.get(`${dir}/ic_launcher.png`)).toMatchObject({ size: expected[density][0], kind: 'launcher' });
      expect(byFile.get(`${dir}/ic_launcher_round.png`)).toMatchObject({ size: expected[density][0], kind: 'launcher-round' });
      expect(byFile.get(`${dir}/ic_launcher_foreground.png`)).toMatchObject({ size: expected[density][1], kind: 'foreground' });
    }
    expect(OUTPUTS.length).toBe(9 + 5 * 3);
  });

  it('生成物が git に入っていて、寸法が一覧どおり', () => {
    for (const o of OUTPUTS) {
      const path = join(root, o.file);
      expect(existsSync(path), o.file).toBe(true);
      expect(pngSize(readFileSync(path)), o.file).toEqual({ width: o.size, height: o.size });
      if (o.file.includes('/AppIcon.appiconset/')) expect(readFileSync(path)[25]).toBe(2);
    }
  });

  it('Android の adaptive icon の xml は前景 PNG と背景色を参照したまま', () => {
    const res = join(root, 'android', 'app', 'src', 'main', 'res');
    for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = readFileSync(join(res, 'mipmap-anydpi-v26', f), 'utf8');
      expect(xml).toContain('@mipmap/ic_launcher_foreground');
      expect(xml).toContain('@color/ic_launcher_background');
    }
    expect(existsSync(join(res, 'values', 'ic_launcher_background.xml'))).toBe(true);
  });
});

describe('manifest と index.html のアイコン参照', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8')) as {
    icons: { src: string; sizes: string; type: string; purpose: string }[];
    background_color: string;
  };

  it('manifest の PNG アイコンは実在し、sizes が中身と合う', () => {
    const pngs = manifest.icons.filter((i) => i.type === 'image/png');
    expect(pngs.length).toBeGreaterThanOrEqual(3);
    for (const icon of pngs) {
      const path = join(root, 'public', icon.src.replace(/^\.\//, ''));
      expect(existsSync(path), icon.src).toBe(true);
      const { width, height } = pngSize(readFileSync(path));
      expect(icon.sizes, icon.src).toBe(`${width}x${height}`);
    }
  });

  it('manifest に any の 192・512 と maskable の 512 がある', () => {
    const find = (purpose: string, sizes: string) => manifest.icons.find((i) => i.purpose === purpose && i.sizes === sizes && i.type === 'image/png');
    expect(find('any', '192x192')?.src).toBe('./app-icons/icon-192.png');
    expect(find('any', '512x512')?.src).toBe('./app-icons/icon-512.png');
    expect(find('maskable', '512x512')?.src).toBe('./app-icons/icon-512-maskable.png');
    // maskable の余白の色は manifest の background_color（生成側が読む値）
    expect(manifest.background_color).toBe(ctx.webBackdrop);
  });

  it('index.html の apple-touch-icon は 180px の PNG を指し、manifest も参照している', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    const m = html.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/);
    expect(m?.[1]).toBe('./app-icons/apple-touch-icon-180.png');
    expect(existsSync(join(root, 'public', 'app-icons', 'apple-touch-icon-180.png'))).toBe(true);
    expect(html).toContain('<link rel="manifest" href="./manifest.webmanifest" />');
  });
});
