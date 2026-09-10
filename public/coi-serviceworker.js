// 配信サーバーに COOP/COEP が無い場合の補助と、リリース単位のオフライン保存。
// build 時に VERSION と offline-assets.json を同じ内容ハッシュから生成する。
if (typeof window === 'undefined') {
  const VERSION = 'development';
  const scope = self.registration.scope;
  const prefix = 'ojiji:' + new URL(scope).pathname + ':';
  const CACHE = prefix + VERSION;
  const CACHE_FIRST = /\/(engine|raizo|sfx)\//;

  const withIsolation = (res) => {
    if (!res || res.status === 0 || res.type === 'opaque') return res;
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };

  const cachedResponse = async (res, req) => {
    const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
    if (!range) return withIsolation(res);
    const body = await res.arrayBuffer();
    const start = range[1] ? Number(range[1]) : Math.max(0, body.byteLength - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), body.byteLength - 1) : body.byteLength - 1;
    const headers = new Headers(res.headers);
    // arrayBuffer() は復号済みなので、部分応答に圧縮時の符号化情報を引き継がない。
    headers.delete('Content-Encoding');
    if (start > end || start >= body.byteLength) {
      headers.set('Content-Range', `bytes */${body.byteLength}`);
      return withIsolation(new Response(null, { status: 416, headers }));
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${body.byteLength}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return withIsolation(new Response(body.slice(start, end + 1), { status: 206, headers }));
  };

  self.addEventListener('install', (event) => {
    if (VERSION === 'development') return;
    event.waitUntil((async () => {
      const res = await fetch(new URL('offline-assets.json', scope), { cache: 'no-store' });
      if (!res.ok) throw new Error('offline manifest unavailable');
      const manifest = await res.json();
      if (manifest.version !== VERSION) throw new Error('incomplete deployment');
      const cache = await caches.open(CACHE);
      // 全部揃わない更新は採用しない。旧バージョンは既存タブを閉じるまで使える。
      await cache.addAll(manifest.assets.map((path) => new Request(new URL(path, scope), { cache: 'reload' })));
    })());
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      // 同じドメインの他アプリ・別サブディレクトリのキャッシュは消さない。
      await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })());
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || (req.cache === 'only-if-cached' && req.mode !== 'same-origin')) return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
    // 更新確認用のファイルは旧バージョンのキャッシュから返さない。
    if (url.pathname.endsWith('/offline-assets.json') || url.pathname.endsWith('/coi-serviceworker.js')) return;

    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      // 効果音の ?v=... も同じリリースに入っている素材へ対応させる。
      const hit = await cache.match(req, { ignoreSearch: CACHE_FIRST.test(url.pathname) });
      // 本番は HTML と JS を同じビルドに固定。開発中のソースだけはネットワーク優先。
      if (hit && (VERSION !== 'development' || CACHE_FIRST.test(url.pathname))) return cachedResponse(hit, req);
      try {
        const res = await fetch(req);
        if (res.ok) {
          try { await cache.put(req, res.clone()); } catch { /* 容量不足でもオンライン表示は続ける */ }
        }
        return withIsolation(res);
      } catch (error) {
        const fallback = hit || (req.mode === 'navigate' ? await cache.match(new URL('./', scope).href) : null);
        if (fallback) return cachedResponse(fallback, req);
        throw error;
      }
    })());
  });
} else if ('serviceWorker' in navigator) {
  const script = document.currentScript.src;
  const key = 'ojiji:coi-reloaded:' + new URL('.', script).pathname;
  let reloaded = false;
  const reloadForIsolation = () => {
    if (window.crossOriginIsolated || !navigator.serviceWorker.controller || reloaded) return;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { return; } // 保存不可環境でリロードを繰り返さない
    reloaded = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reloadForIsolation);
  navigator.serviceWorker.register(script).then(reloadForIsolation).catch(() => {});
}
