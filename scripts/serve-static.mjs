// 本番 dist をヘッダー有り／無しで確認するローカルテスト用サーバー。/sub/ 配信も同じビルドで試す。
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const port = Number(process.argv[2] || 5180);
const isolated = process.argv.includes('--isolated');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.txt': 'text/plain' };
createServer((req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.startsWith('/sub/')) path = path.slice(4);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep) || !statSync(file).isFile()) throw new Error('not found');
    const headers = { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (isolated) Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Static test server http://localhost:${port}, isolation=${isolated}`));
