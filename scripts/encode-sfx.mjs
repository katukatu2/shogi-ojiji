// 雷の効果音を WAV から MP3 にする（ffmpeg なしで動くよう、純 JS の lamejs を使う）。
// 入力: assets-src/sfx/bakamon_thunder.wav（48kHz ステレオ 24bit、約 790KB）
// 出力: public/sfx/bakamon_thunder.mp3（モノラル 96kbps、約 35KB）。iOS / Android / 主要ブラウザで再生できる
// 使い方: node scripts/encode-sfx.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// lamejs 1.2.1 の src ビルドは MPEGMode 未定義で落ちる。結合済みの lame.all.js はブラウザ向けのグローバル定義なので、
// 中身を読んで関数として評価し、lamejs() を一度呼んで Mp3Encoder を組み立てる
const lamejs = new Function(readFileSync(require.resolve('lamejs/lame.all.js'), 'utf8') + ';return lamejs;')();
lamejs();
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'assets-src', 'sfx', 'bakamon_thunder.wav');
const out = join(root, 'public', 'sfx', 'bakamon_thunder.mp3');
const KBPS = 96;

// RIFF/WAVE を読む。PCM 16/24/32bit に対応
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = buf.subarray(p + 8, p + 8 + size);
    if (id === 'fmt ') fmt = { format: body.readUInt16LE(0), channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    if (id === 'data') data = body;
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('fmt/data chunk not found');
  if (fmt.format !== 1 && fmt.format !== 0xfffe) throw new Error('unsupported WAV format ' + fmt.format);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytes;
      let v;
      if (bytes === 2) v = data.readInt16LE(o) / 32768;
      else if (bytes === 3) v = ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8 >> 8) / 8388608;
      else v = data.readInt32LE(o) / 2147483648;
      sum += v;
    }
    mono[i] = Math.max(-32768, Math.min(32767, Math.round((sum / fmt.channels) * 32767)));
  }
  return { rate: fmt.rate, samples: mono, channels: fmt.channels, bits: fmt.bits };
}

const wav = readWav(readFileSync(src));
const enc = new lamejs.Mp3Encoder(1, wav.rate, KBPS);
const parts = [];
const BLOCK = 1152;
for (let i = 0; i < wav.samples.length; i += BLOCK) {
  const chunk = enc.encodeBuffer(wav.samples.subarray(i, i + BLOCK));
  if (chunk.length > 0) parts.push(Buffer.from(chunk));
}
const tail = enc.flush();
if (tail.length > 0) parts.push(Buffer.from(tail));
mkdirSync(dirname(out), { recursive: true });
const mp3 = Buffer.concat(parts);
writeFileSync(out, mp3);
console.log(`${wav.channels}ch ${wav.bits}bit ${wav.rate}Hz ${(wav.samples.length / wav.rate).toFixed(2)}s -> mono ${KBPS}kbps mp3, ${(mp3.length / 1024).toFixed(1)} KB`);
