// public/coi-serviceworker.js を Node 上で読み込み、fetch ハンドラの振る舞いを確かめる。
// 確認用ブラウザでは Service Worker を登録できないため、ここで最低限の動作を保証する。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

type Handler = (event: unknown) => void;

function loadWorker() {
  const src = readFileSync('public/coi-serviceworker.js', 'utf-8');
  const handlers: Record<string, Handler[]> = {};
  const store = new Map<string, Response>();
  const cache = {
    match: async (req: Request | string) => store.get(typeof req === 'string' ? req : req.url) ?? null,
    put: async (req: Request, res: Response) => { store.set(req.url, res); },
  };
  const deleted: string[] = [];
  const self = {
    location: { origin: 'https://app.example' },
    addEventListener: (name: string, h: Handler) => { (handlers[name] ??= []).push(h); },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const caches = {
    open: async () => cache,
    keys: async () => ['ojiji-v1', 'ojiji-v4'],
    delete: async (k: string) => { deleted.push(k); return true; },
  };
  const fetched: string[] = [];
  let failNetwork = false;
  const fetchStub = async (req: Request) => {
    fetched.push(req.url);
    if (failNetwork) throw new Error('offline');
    return new Response('body-of-' + req.url, { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  // window が無い側（Service Worker）として評価する
  const fn = new Function('self', 'caches', 'fetch', 'Response', 'Headers', 'URL', src);
  fn(self, caches, fetchStub, Response, Headers, URL);
  return { handlers, store, deleted, fetched, setOffline: (v: boolean) => { failNetwork = v; } };
}

async function runFetch(handlers: Record<string, Handler[]>, url: string, mode: RequestMode = 'same-origin'): Promise<Response | null> {
  let out: Promise<Response> | null = null;
  const req = new Request(url, { mode });
  handlers.fetch[0]({ request: req, respondWith: (p: Promise<Response>) => { out = p; } });
  return out ? await out : null;
}

describe('Service Worker', () => {
  it('素材はキャッシュ優先で、COOP/COEP ヘッダーを付けて返す', async () => {
    const w = loadWorker();
    const first = await runFetch(w.handlers, 'https://app.example/engine/yaneuraou.k-p.wasm');
    expect(first?.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(first?.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(w.fetched.length).toBe(1);
    const second = await runFetch(w.handlers, 'https://app.example/engine/yaneuraou.k-p.wasm');
    expect(await second?.text()).toContain('body-of-');
    expect(w.fetched.length).toBe(1); // 2 回目はネットワークに行かない
  });

  it('アプリ本体はネットワーク優先で、オフラインならキャッシュを返す', async () => {
    const w = loadWorker();
    await runFetch(w.handlers, 'https://app.example/assets/index.js');
    w.setOffline(true);
    const res = await runFetch(w.handlers, 'https://app.example/assets/index.js');
    expect(res?.status).toBe(200);
    expect(res?.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  });

  it('他のオリジンと GET 以外には手を出さない', async () => {
    const w = loadWorker();
    const cross = await runFetch(w.handlers, 'https://other.example/x.js', 'cors');
    expect(cross).toBeNull();
    let touched = false;
    w.handlers.fetch[0]({ request: new Request('https://app.example/api', { method: 'POST' }), respondWith: () => { touched = true; } });
    expect(touched).toBe(false);
  });

  it('activate で古いキャッシュを消す', async () => {
    const w = loadWorker();
    let done: Promise<unknown> | null = null;
    w.handlers.activate[0]({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(w.deleted).toEqual(['ojiji-v1']);
  });
});
