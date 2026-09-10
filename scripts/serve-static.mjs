// 本番 dist をヘッダー有り／無しで確認するローカルテスト用サーバー。/sub/ 配信も同じビルドで試す。
import { createServer } from 'node:http';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export function createStaticServer({ root = resolve('dist'), isolated = false, faultsEnabled = false } = {}) {
  const faults = new Map();
  const updates = new Map();
  const downloads = new Map();
  function updateFixture(version) {
    const files = { './': Buffer.from('<!doctype html><script src="./app.js"></script><h1>Update fixture</h1>'),
      './app.js': Buffer.from(`window.release = '${version}';`), './shared.bin': Buffer.alloc(1024, 7) };
    const manifest = { version, assets: Object.keys(files), sha256: Object.fromEntries(Object.entries(files).map(([key, body]) =>
      [key, createHash('sha256').update(body).digest('hex')])) };
    files['./offline-assets.json'] = Buffer.from(JSON.stringify(manifest));
    // 製品のSWをそのまま使用し、版識別子だけ固定する。最小HTMLでブラウザー本来の更新・待機を検証。
    files['./coi-serviceworker.js'] = Buffer.from(readFileSync(resolve(root, 'coi-serviceworker.js'), 'utf8')
      .replace(/const VERSION = '[^']+';/, `const VERSION = '${version}';`));
    return files;
  }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.txt': 'text/plain' };
  return createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (faultsEnabled && path === '/__test/update') {
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 2048) throw new Error('too large'); }
          const value = JSON.parse(body);
          if (!/^[a-z0-9-]+$/.test(value.id) || !/^[abc]$/.test(value.version)) throw new Error('invalid update');
          updates.set(value.id, value);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(Object.fromEntries(downloads))); return;
      }
      const updatePath = faultsEnabled && path.match(/^\/updates\/([a-z0-9-]+)\/(.*)$/);
      if (updatePath) {
        const [, id, file] = updatePath;
        const config = updates.get(id) || { version: 'a' };
        downloads.set(path, (downloads.get(path) || 0) + 1);
        if (config.fail && file === 'app.js') throw new Error('simulated incomplete update');
        const body = updateFixture(config.version)['./' + file];
        if (!body) throw new Error('not found');
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || (file ? 'application/octet-stream' : 'text/html'), 'Cache-Control': 'no-store' });
        res.end(body); return;
      }
      if (faultsEnabled && req.method === 'POST' && path === '/__test/fault') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 2048) throw new Error('too large'); }
        const { path: target, mode } = JSON.parse(body);
        if (!/^\/fault\/[a-z0-9-]+\/[^?]+$/.test(target) || !['missing', 'version', 'none'].includes(mode)) throw new Error('invalid fault');
        if (mode === 'none') faults.delete(target); else faults.set(target, mode);
        res.writeHead(200); res.end('ok'); return;
      }
      const fault = faultsEnabled && faults.get(path);
      if (fault === 'missing') throw new Error('simulated missing asset');
      if (faultsEnabled) path = path.replace(/^\/fault\/[a-z0-9-]+\//, '/');
      if (path.startsWith('/sub/')) path = path.slice(4);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(root, '.' + path);
      if (!file.startsWith(root + sep) || !statSync(file).isFile()) throw new Error('not found');
      const headers = { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
      if (isolated) Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
      res.writeHead(200, headers);
      if (fault === 'version') res.end(JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version: 'mismatched-release' }));
      else createReadStream(file).pipe(res);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}

// CLIの配信と通し試験で同じハンドラーを使う。import時には起動しない。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 5180);
  const isolated = process.argv.includes('--isolated');
  createStaticServer({ isolated, faultsEnabled: process.argv.includes('--faults') })
    .listen(port, '127.0.0.1', () => console.log(`Static test server http://localhost:${port}, isolation=${isolated}`));
}
