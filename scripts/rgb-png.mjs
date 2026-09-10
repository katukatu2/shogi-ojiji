import { crc32, deflateSync } from 'node:zlib';

// 不透明なRGBAレンダリングを、画素の色を変えずαチャネルのないPNGへ符号化する。
export function opaqueRgbPng({ width, height, pixels }) {
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      if (pixels[from + 3] !== 255) throw new Error('AppIcon contains a transparent pixel');
      const to = y * (1 + width * 3) + 1 + x * 3;
      rows.set(pixels.subarray(from, from + 3), to);
    }
  }
  const chunk = (name, data) => {
    const typeAndData = Buffer.concat([Buffer.from(name), data]);
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    typeAndData.copy(out, 4);
    out.writeUInt32BE(crc32(typeAndData), out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // truecolour RGB、α・パレットなし
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
