// Service Worker。役割は 2 つ。
// 1. SharedArrayBuffer を使うために必要な COOP/COEP ヘッダーを、サーバー側で設定できない環境
//    （静的ホスティング、Capacitor の WebView など）で代わりに付与する。
// 2. エンジン・雷蔵の画像・音声・アプリ本体をキャッシュし、2 回目以降とオフラインで動くようにする。
// ページ側では index.html の小さなスクリプトが、未分離なら登録して一度だけ再読み込みする。

if (typeof window === 'undefined') {
  // ===== Service Worker 側 =====
  const CACHE = 'ojiji-v3'; // 中身を大きく変えたら上げる。古いキャッシュは activate で消す
  // 変わらない大きな素材はキャッシュ優先。それ以外（アプリ本体）はネットワーク優先でキャッシュを控えに使う
  const CACHE_FIRST = /\/(engine|raizo|sfx)\//;

  const withIsolation = (res) => {
    if (!res || res.status === 0 || res.type === 'opaque') return res;
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };

  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
    );
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    if (CACHE_FIRST.test(url.pathname)) {
      event.respondWith(
        caches.open(CACHE).then(async (cache) => {
          const hit = await cache.match(req);
          if (hit) return withIsolation(hit);
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return withIsolation(res);
        }),
      );
      return;
    }

    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return withIsolation(res);
        } catch (err) {
          const hit = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('./') : null);
          if (hit) return withIsolation(hit);
          throw err;
        }
      }),
    );
  });
} else if ('serviceWorker' in navigator) {
  // ===== ページ側 =====
  const key = 'coi-reloaded';
  navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
    if (window.crossOriginIsolated) return; // すでに分離できていれば再読み込みは不要
    if (sessionStorage.getItem(key)) return; // 再読み込み後も分離できない環境（無限ループ防止）
    sessionStorage.setItem(key, '1');
    if (reg.active && !navigator.serviceWorker.controller) location.reload();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw && sw.addEventListener('statechange', () => { if (sw.state === 'activated' && !window.crossOriginIsolated) location.reload(); });
    });
  }).catch(() => {});
}
