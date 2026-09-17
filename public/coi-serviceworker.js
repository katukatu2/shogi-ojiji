// オフライン保存が不完全でも初回のCOOP/COEP補助は有効にする。
// 更新版は全資源の内容を検証してから待機させ、既存タブの版を途中で変えない。
if (typeof window === 'undefined') {
  const VERSION = 'development';
  const scope = self.registration.scope;
  const prefix = 'ojiji:' + new URL(scope).pathname + ':';
  const CACHE = prefix + VERSION;
  const META = prefix + 'meta';
  const READY = new URL('.ojiji-ready', scope).href;
  const ACTIVE = new URL('.ojiji-active', scope).href;
  let filling;
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
    headers.delete('Content-Encoding');
    if (start > end || start >= body.byteLength) {
      headers.delete('Content-Length');
      headers.set('Content-Range', 'bytes */' + body.byteLength);
      return withIsolation(new Response(null, { status: 416, headers }));
    }
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + body.byteLength);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return withIsolation(new Response(body.slice(start, end + 1), { status: 206, headers }));
  };
  const readyManifest = async (name = CACHE) => {
    const res = await (await caches.open(name)).match(READY);
    return res ? res.json() : null;
  };
  const notify = async (ready) => {
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      client.postMessage({ type: 'ojiji-offline', ready });
    }
  };
  const matches = async (res, hash) => {
    if (!res?.ok || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
    const digest = await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer());
    return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('') === hash;
  };
  // 動作中の版と最新の待機版だけ残す。初めて旧実装から更新するときはactivateまで保守的に残す。
  const pruneWaiting = async () => {
    const active = await (await caches.open(META)).match(ACTIVE);
    const keep = active ? await active.text() : null;
    if (self.registration.active && !keep) return;
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== META && name !== CACHE && name !== keep) await caches.delete(name);
    }
  };
  const fill = () => {
    if (filling) return filling;
    filling = (async () => {
      try {
        if (await readyManifest()) return true;
        const res = await fetch(new URL('offline-assets.json', scope), { cache: 'no-store' });
        if (!res.ok) throw new Error('offline manifest unavailable');
        const manifest = await res.json();
        if (manifest.version !== VERSION || !Array.isArray(manifest.assets) || !manifest.assets.includes('./')) {
          throw new Error('offline manifest version/format mismatch');
        }
        const cache = await caches.open(CACHE);
        const reusable = [];
        for (const name of await caches.keys()) {
          if (name.startsWith(prefix) && name !== CACHE && name !== META) {
            const info = await readyManifest(name);
            if (info) reusable.push({ cache: await caches.open(name), info });
          }
        }
        const outcomes = await Promise.allSettled(manifest.assets.map(async (path) => {
          const url = new URL(path, scope);
          const hash = manifest.sha256?.[path];
          if (!url.href.startsWith(scope) || !/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('invalid asset: ' + path);
          if (await matches(await cache.match(url.href, { ignoreVary: true }), hash)) return; // 初回の途中までの保存を再利用
          for (const old of reusable) {
            if (old.info.sha256?.[path] === hash) {
              const prior = await old.cache.match(url.href, { ignoreVary: true });
              if (await matches(prior, hash)) { await cache.put(url.href, prior); return; }
            }
          }
          const response = await fetch(new Request(url, { cache: 'reload' }));
          if (!await matches(response, hash)) throw new Error('asset unavailable or changed: ' + path);
          await cache.put(url.href, response);
        }));
        const failed = outcomes.flatMap((r, i) => r.status === 'rejected' ? [manifest.assets[i]] : []);
        if (failed.length) throw new Error('offline assets failed: ' + failed.join(', '));
        await cache.put(READY, new Response(JSON.stringify(manifest)));
        await pruneWaiting().catch((error) => console.warn('[ojiji] 待機版の整理に失敗しました。', error));
        return true;
      } catch (error) {
        console.warn('[ojiji] オフライン保存を完了できませんでした。', error);
        return false;
      }
    })().finally(() => { filling = null; });
    return filling;
  };
  self.addEventListener('install', (event) => {
    if (VERSION === 'development') {
      // 開発時だけ、開いたタブを残したまま旧キャッシュの掃除へ進む。
      event.waitUntil(self.skipWaiting());
      return;
    }
    event.waitUntil((async () => {
      const ready = await fill();
      // 初回は保存できなくてもヘッダー補助を提供。更新失敗なら動作中の旧版を維持する。
      if (!ready && self.registration.active) {
        await caches.delete(CACHE);
        throw new Error('Incomplete update; keeping the active release');
      }
    })());
  });
  self.addEventListener('activate', (event) => {
    if (VERSION === 'development') {
      event.waitUntil((async () => {
        // 先に旧Workerへの新規取得を止め、その後で残った開発用保存を消す。
        await self.clients.claim();
        await caches.delete(CACHE);
      })());
      return;
    }
    event.waitUntil((async () => {
      try {
        await (await caches.open(META)).put(ACTIVE, new Response(CACHE));
        for (const name of await caches.keys()) {
          if (name.startsWith(prefix) && name !== CACHE && name !== META) await caches.delete(name);
        }
        const manifest = await readyManifest();
        if (manifest) {
          // 旧実装の共通名から、このスコープで今回保存したURLだけ取り除く。他のURLは残す。
          for (const name of await caches.keys()) {
            if (!/^ojiji-v\d+$/.test(name)) continue;
            const legacy = await caches.open(name);
            const index = await legacy.match(scope);
            const ours = index && (await index.text()).includes('将棋オジジの定石指南');
            for (const path of manifest.assets) await legacy.delete(new URL(path, scope).href, { ignoreSearch: true });
            if (ours) {
              for (const req of await legacy.keys()) {
                const relative = req.url.startsWith(scope) ? req.url.slice(scope.length) : '';
                if (/^(assets|engine|raizo|sfx)\//.test(relative)) await legacy.delete(req);
              }
            }
            if (!(await legacy.keys()).length) await caches.delete(name);
          }
        }
      } catch (error) { console.warn('[ojiji] キャッシュ整理に失敗しました。', error); }
      await self.clients.claim();
    })());
  });
  self.addEventListener('message', (event) => {
    if (!['ojiji-offline-status', 'ojiji-offline-retry'].includes(event.data?.type)) return;
    if (VERSION === 'development') return;
    event.waitUntil((async () => {
      const ready = event.data.type === 'ojiji-offline-retry' ? await fill() : !!await readyManifest().catch(() => null);
      await notify(ready);
    })());
  });
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || (req.cache === 'only-if-cached' && req.mode !== 'same-origin')) return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
    if (url.pathname.endsWith('/offline-assets.json') || url.pathname.endsWith('/coi-serviceworker.js')) return;
    event.respondWith((async () => {
      // 開発中のソースは保存も代替取得もしない。通信失敗をそのまま伝える。
      if (VERSION === 'development') return withIsolation(await fetch(req));
      let cache, complete = false, hit;
      try {
        cache = await caches.open(CACHE);
        complete = !!await readyManifest();
        // 不完全な保存を完成版として返さない。クエリ付き音声も同じ版の素材へ揃える。
        // 配信元（エックスサーバーの nginx など）は圧縮する応答に Vary: Accept-Encoding を付ける。照合が Vary を見ると、
        // 保存済みでも一致せず通信を取りに行き、通信なしでは起動できなかった。中身は保存時に SHA-256 で検証済みなので無視してよい。
        if (complete) hit = await cache.match(req, { ignoreSearch: complete, ignoreVary: true });
      } catch { /* 保存不可でもオンラインのヘッダー付与は続ける */ }
      if (complete && hit) return cachedResponse(hit, req);
      try {
        const res = await fetch(req);
        return withIsolation(res);
      } catch (error) {
        const fallback = hit || (complete && req.mode === 'navigate' ? await cache.match(scope, { ignoreVary: true }) : null);
        if (fallback) return cachedResponse(fallback, req);
        throw error;
      }
    })());
  });
} else if ('serviceWorker' in navigator) {
  const script = document.currentScript.src;
  const key = 'ojiji:coi-reloaded:' + new URL('.', script).pathname;
  let reloaded = false;
  const status = (ready) => {
    const render = () => {
      let notice = document.getElementById('offline-status');
      const syncHeight = () => document.documentElement.style.setProperty('--offline-status-height', `${notice.hidden ? 0 : notice.getBoundingClientRect().height}px`);
      if (!notice) {
        notice = document.createElement('p');
        notice.id = 'offline-status';
        notice.setAttribute('role', 'status');
        document.body.prepend(notice);
        // 折り返し・文字拡大・画面回転でも、案内の実寸だけアプリの場所を空ける。
        new ResizeObserver(syncHeight).observe(notice);
      }
      notice.hidden = ready;
      notice.textContent = ready ? '' : 'オフライン保存は未完了です。接続中は遊べます。通信が戻ると再試行します。';
      syncHeight();
    };
    if (document.body) render(); else document.addEventListener('DOMContentLoaded', render, { once: true });
  };
  const reloadForIsolation = () => {
    if (window.crossOriginIsolated || !navigator.serviceWorker.controller || reloaded) return;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { return; }
    reloaded = true;
    location.reload();
  };
  const retry = () => navigator.serviceWorker.controller?.postMessage({ type: 'ojiji-offline-retry' });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'ojiji-offline') status(event.data.ready);
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => { reloadForIsolation(); retry(); });
  window.addEventListener('online', retry);
  navigator.serviceWorker.register(script).then(() => {
    reloadForIsolation();
    retry();
  }).catch((error) => { console.warn('[ojiji] オフライン機能を準備できませんでした。', error); status(false); });
}
