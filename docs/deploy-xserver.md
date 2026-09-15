# エックスサーバーへの配信手順

対象: Web 版（PWA）。Android・iOS のネイティブ版は別工程（[release-checklist.md](release-checklist.md)）。

## なぜエックスサーバーか

やねうら王 WASM は `SharedArrayBuffer` を使うので、配信元が **COOP / COEP** を返す必要がある。

- **GitHub Pages はヘッダーを設定できない。** 同梱の `public/coi-serviceworker.js` が Service Worker でヘッダーを補う回避策になり、初回だけ非分離で読み込んでから再読み込みが入る。
- **エックスサーバーは Apache なので `.htaccess` で直接返せる。** 回避策が不要になり、初回から分離された状態で開ける。

値は `scripts/serve-static.mjs` と同じで、**PWA 試験 24 件（static-with-headers）が通っている構成**である。

## 置き場所

**サブドメインに置く。** 会社サイト（`godo-amity.com`）とは別オリジンになるので、COOP / COEP が会社サイトに影響しない。同じドメインのサブディレクトリに置くと、`.htaccess` の効果範囲が会社サイトに及びうる。

## 手順

### 1. サブドメインを作る

エックスサーバーのサーバーパネル →「サブドメイン設定」で追加し、無料独自 SSL を有効にする。

**HTTPS は必須。** `SharedArrayBuffer` は安全なコンテキストでしか使えないため、http では動かず「判定: 簡易」に落ちる。

### 2. 空欄を埋める

サブドメインが決まったら、`（公開先 URL）` と `data-release-pending` を一斉に差し替える。

| 場所 | 種類 |
|---|---|
| `src/main.ts` の `SOURCE_URL` | ソース公開先 |
| `docs/store/listing.md`（2 か所） | ソース公開先 |
| `public/privacy.html` の `data-release-pending="source"` | ソース公開先 |
| `public/privacy.html` の `data-release-pending="hosting"` | 配信元 |
| `README.md` | ソース公開先 |

`npm run release:check` が通ることで漏れが無いと確かめる。

### 3. ビルドする

```bash
npm run build
```

`dist/` に 31 ファイル、約 2.1MB。末尾に `Offline release <版番号>: 30 resources` が出る。**この版番号は `dist/offline-assets.json` と `dist/coi-serviceworker.js` に埋め込まれ、更新の判定に使われる。**

### 4. アップロードする

**`dist/` の中身**を、サブドメインの公開ディレクトリ直下に置く（`dist` フォルダーごとではない）。

そのうえで、**`deploy/xserver/.htaccess` を同じ階層に置く。**

> **`.htaccess` を `dist/` や `public/` に入れてはいけない。**
> `scripts/prepare-offline.mjs` は `dist/` の全ファイルをオフライン目録に入れるので、
> Apache が既定で拒否する `.htaccess` を Service Worker が取りに行き、
> **オフライン保存が必ず失敗する**（画面に「オフライン保存は未完了です」が出続ける）。

完成した配置:

```
（サブドメインの公開ディレクトリ）/
├── .htaccess           ← deploy/xserver/ から
├── index.html
├── offline-assets.json
├── coi-serviceworker.js
├── assets/
├── engine/
├── icons/
├── raizo/
└── sfx/
```

### 5. 確かめる

ブラウザーで開き、開発者ツールのコンソールで次を実行する。

```js
crossOriginIsolated
```

- **`true`** … `.htaccess` が効いている。狙いどおり。
- **`false` のあと再読み込みで `true`** … `mod_headers` が無効で、Service Worker が補っている。動くが初回が遅い。サーバー側の設定を確認する。
- **ずっと `false`** … HTTPS になっているか、`.htaccess` が正しい階層にあるかを確認する。

あわせて画面上部の判定表示を見る。

- **「判定: エンジン」** … やねうら王が動いている。正常。
- **「判定: 簡易」** … エンジンが起動していない。上の `crossOriginIsolated` を確認する。

`.wasm` が正しい型で返っているかは、ネットワークタブで `yaneuraou.k-p.wasm` の `Content-Type` が `application/wasm` であることで確かめる。

### 6. iPhone 実機で確かめる

Safari で開き、共有 →「ホーム画面に追加」。

- 盤が縦画面に収まり、指で駒が動かせる
- 駒音が鳴る（Safari の自動再生制限を通過している）
- 「判定: エンジン」になっている
- ホーム画面から起動し、アプリを切り替えて戻っても対局が続く

## 更新するとき

1. `npm run build`
2. `dist/` の中身を上書きアップロード（`.htaccess` はそのまま）
3. 利用者の端末では、次回アクセス時に Service Worker が新しい `offline-assets.json` の版番号を見て更新する。**開いているタブは途中で版が変わらない**（製品の方針）

`index.html` `offline-assets.json` `coi-serviceworker.js` `manifest.webmanifest` は `.htaccess` で `no-cache` にしてあるので、更新が滞留しない。

## GPLv3 について

**自前サーバーで配信しても、ソース公開の義務は残る。** やねうら王（GPLv3）を組み込んでいるため、アプリ全体が GPLv3 になる。配布した版と同じソースを入手できる場所を、プライバシーポリシーとタイトル画面のクレジット欄から示す必要がある。

リポジトリ `katukatu2/shogi-ojiji` を公開にするのが最も簡単。`dist/LICENSE.txt`（GPL 全文）はビルド時に自動で同梱される。
