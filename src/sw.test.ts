import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';

const ORIGIN = 'https://app.example';
const scope = ORIGIN + '/sub/';
const readyKey = scope + '.ojiji-ready';
type Stores = Map<string, Map<string, Response>>;
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const urlOf = (req: Request | URL | string) => typeof req === 'string' ? req : req instanceof URL ? req.href : req.url;

function server(version = 'one') {
  const bodies: Record<string, string> = { './': '<title>将棋オジジの定石指南</title>' + version, './assets/app.js': version, './sfx/sound.mp3': '0123456789' };
  const manifest = { version, assets: Object.keys(bodies), sha256: Object.fromEntries(Object.entries(bodies).map(([p, b]) => [p, hash(b)])) };
  const resources = new Map(Object.entries(bodies).map(([p, b]) => [new URL(p, scope).href, b]));
  resources.set(scope + 'offline-assets.json', JSON.stringify(manifest));
  return { resources, manifest };
}

function worker(version = 'one', network = server(version), stores: Stores = new Map(), active = false) {
  const handlers: Record<string, (event: any) => void> = {};
  const fetched: string[] = [], warnings: unknown[][] = [], messages: any[] = [];
  let offline = false, quota = false;
  const cacheApi = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name)!;
    const find = (req: Request | string | URL, options?: { ignoreSearch?: boolean }) => {
      const url = urlOf(req);
      return [...entries.keys()].find((key) => options?.ignoreSearch ? key.split('?')[0] === url.split('?')[0] : key === url);
    };
    return {
      match: async (req: Request | string | URL, options?: { ignoreSearch?: boolean }) => entries.get(find(req, options) ?? '')?.clone(),
      put: async (req: Request | string | URL, res: Response) => {
        if (quota) throw new Error('QuotaExceededError');
        entries.set(urlOf(req), res.clone());
      },
      delete: async (req: Request | string | URL, options?: { ignoreSearch?: boolean }) => entries.delete(find(req, options) ?? ''),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
    };
  };
  const caches = { open: async (name: string) => cacheApi(name), keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) };
  const self = {
    location: { origin: ORIGIN }, registration: { scope, active: active ? {} : null },
    addEventListener: (name: string, handler: (e: any) => void) => { handlers[name] = handler; },
    clients: { claim: async () => undefined, matchAll: async () => [{ postMessage: (msg: any) => messages.push(msg) }] },
  };
  const fetch = async (req: Request | URL | string) => {
    const url = urlOf(req); fetched.push(url);
    if (offline) throw new TypeError('offline');
    const body = network.resources.get(url);
    return new Response(body ?? 'missing', { status: body === undefined ? 404 : 200 });
  };
  const source = readFileSync('public/coi-serviceworker.js', 'utf8').replace("const VERSION = 'development';", "const VERSION = '" + version + "';");
  new Function('self', 'caches', 'fetch', 'Response', 'Headers', 'URL', 'Request', 'crypto', 'console', source)(
    self, caches, fetch, Response, Headers, URL, Request, webcrypto, { warn: (...args: unknown[]) => warnings.push(args) },
  );
  const event = async (type: string, data?: unknown) => {
    let pending: Promise<unknown> | undefined;
    handlers[type]({ data, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
  };
  const request = async (path: string, init?: RequestInit, navigate = false) => {
    const req = new Request(new URL(path, scope), init);
    if (navigate) Object.defineProperty(req, 'mode', { value: 'navigate' });
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => { response = p; } });
    return response ? await response : null;
  };
  return { stores, network, fetched, warnings, messages, event, request, setOffline: (b: boolean) => { offline = b; }, setQuota: (b: boolean) => { quota = b; } };
}

describe('出荷時Service Worker', () => {
  it('完全保存したHTML/JSをオンラインでも同じ版で返し、オフライン起動に使う', async () => {
    const w = worker();
    await w.event('install'); await w.event('activate');
    w.network.resources.set(scope, 'new HTML'); w.network.resources.set(scope + 'assets/app.js', 'new JS');
    expect(await (await w.request('./'))?.text()).toContain('one');
    expect(await (await w.request('./assets/app.js'))?.text()).toBe('one');
    w.setOffline(true);
    const res = await w.request('./?from=home', undefined, true);
    expect(await res?.text()).toContain('one');
    expect(res?.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res?.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  });

  for (const failure of ['manifest missing', 'version mismatch', 'asset missing', 'asset changed', 'quota']) {
    it('初回の ' + failure + ' でも登録を残し、オンラインのヘッダー付与と後の再試行が働く', async () => {
      const network = server();
      const original = new Map(network.resources);
      const w = worker('one', network);
      if (failure === 'manifest missing') network.resources.delete(scope + 'offline-assets.json');
      if (failure === 'version mismatch') network.resources.set(scope + 'offline-assets.json', JSON.stringify({ ...network.manifest, version: 'wrong' }));
      if (failure === 'asset missing') network.resources.delete(scope + 'sfx/sound.mp3');
      if (failure === 'asset changed') network.resources.set(scope + 'sfx/sound.mp3', 'incorrect deployment');
      if (failure === 'quota') w.setQuota(true);
      await expect(w.event('install')).resolves.toBeUndefined();
      await w.event('activate');
      expect(w.stores.get('ojiji:/sub/:one')?.has(readyKey)).toBeFalsy();
      expect((await w.request('./assets/app.js'))?.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
      expect(w.warnings.length).toBeGreaterThan(0);
      await w.event('message', { type: 'ojiji-offline-retry' });
      expect(w.messages.at(-1)).toEqual({ type: 'ojiji-offline', ready: false });
      w.setOffline(true);
      await expect(w.request('./', undefined, true)).rejects.toThrow('offline');
      w.setOffline(false); w.setQuota(false);
      network.resources = original;
      await w.event('message', { type: 'ojiji-offline-retry' });
      expect(w.messages.at(-1)).toEqual({ type: 'ojiji-offline', ready: true });
      w.setOffline(true);
      expect(await (await w.request('./'))?.text()).toContain('one');
    });
  }

  it.each([
    ['bytes=2-4', 206, '234', 'bytes 2-4/10'],
    ['bytes=7-', 206, '789', 'bytes 7-9/10'],
    ['bytes=-3', 206, '789', 'bytes 7-9/10'],
    ['bytes=10-', 416, '', 'bytes */10'],
    ['bytes=5-2', 416, '', 'bytes */10'],
  ])('クエリ付き音声 %s は正しい部分応答になる', async (range, status, body, contentRange) => {
    const w = worker(); await w.event('install'); w.setOffline(true);
    const res = await w.request('./sfx/sound.mp3?v=one', { headers: { Range: range } });
    expect(res?.status).toBe(status);
    expect(res?.headers.get('content-range')).toBe(contentRange);
    expect(await res?.text()).toBe(body);
  });

  it('更新が不完全なら動作中の旧版を守り、次の更新で変更のない音声を再取得しない', async () => {
    const old = worker(); await old.event('install'); await old.event('activate');
    const bad = worker('two', server('two'), old.stores, true);
    bad.network.resources.delete(scope + 'sfx/sound.mp3');
    bad.network.manifest.sha256['./sfx/sound.mp3'] = hash('different');
    bad.network.resources.set(scope + 'offline-assets.json', JSON.stringify(bad.network.manifest));
    await expect(bad.event('install')).rejects.toThrow('keeping the active release');
    expect(await (await old.request('./assets/app.js'))?.text()).toBe('one');
    const next = worker('three', server('three'), old.stores, true);
    await next.event('install');
    expect(next.fetched).not.toContain(scope + 'sfx/sound.mp3');
    const newest = worker('four', server('four'), old.stores, true);
    await newest.event('install');
    expect([...old.stores.keys()].sort()).toEqual(['ojiji:/sub/:four', 'ojiji:/sub/:meta', 'ojiji:/sub/:one']);
    expect(await (await old.request('./assets/app.js'))?.text()).toBe('one'); // 旧タブの版は変わらない
    await newest.event('activate');
    expect([...old.stores.keys()].sort()).toEqual(['ojiji:/sub/:four', 'ojiji:/sub/:meta']);
  });

  it('古い共通名の自アプリ資源を整理し、他スコープと他アプリの保存を残す', async () => {
    const stores: Stores = new Map([
      ['other-app', new Map([[ORIGIN + '/other', new Response('other')]])],
      ['ojiji:/another/:one', new Map()],
      ['ojiji-v4', new Map([
        [scope, new Response('<title>将棋オジジの定石指南</title>')],
        [scope + 'assets/old-hash.js', new Response('old')],
        [ORIGIN + '/another/keep', new Response('keep')],
      ])],
    ]);
    const w = worker('one', server(), stores); await w.event('install'); await w.event('activate');
    expect(stores.has('other-app')).toBe(true); expect(stores.has('ojiji:/another/:one')).toBe(true);
    expect([...stores.get('ojiji-v4')!.keys()]).toEqual([ORIGIN + '/another/keep']);
    expect(await w.request(ORIGIN + '/another/keep')).toBeNull();
    expect(await w.request('./api', { method: 'POST' })).toBeNull();
  });
});
