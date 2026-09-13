# 開発時 Service Worker キャッシュ修正の報告

作成: 2026-09-12 / Codex。起点: `57745d5`。

実装とローカル自動検証を完了した。**完了条件 6（ユーザー本人がいつもの 5173 で、Clear site data なしに帯と駒の動作を確認すること）は回答待ち**であり、全条件達成とは判定していない。評価点は変更しない。今回の結果を GitHub Actions の成功としては扱わない。

## 修正前の再現と因果の範囲

`src/sw.test.ts` に、ファイルの `VERSION = 'development'` を差し替えず実行する経路を追加した。開発キャッシュに `/sub/src/main.ts` の古い本文を入れ、通信を失敗させる試験は、修正前には `promise resolved "'old main.ts'" instead of rejecting` で失敗した。記録は `logs/dev-sw-cache/before-fix.txt`。この絞り込み実行で製品試験が skipped と表示されるのは対象名を指定したためであり、修正後の全件検証では skipped はない。

実ブラウザでも、起点コミットの Worker を Vite 上で配信してから新しい Worker に切り替えた。Chromium の独立した保存領域と検証専用の 5190 を使用し、2 タブを開いたまま試験した。旧 Worker が 48 件の開発用資源を保存している状態で `/src/main.ts` を `old main.ts` に差し替え、サーバー側でその要求の接続を切ると、古い本文が返った。ブラウザの HTTP キャッシュを使わない要求で確認している。

再現したのは「開発中の通信失敗を古い本文で隠す」欠陥である。**ユーザーの 5173 が壊れた瞬間のキャッシュや CSS/JS の組み合わせは観測しておらず、帯や操作が壊れた過去の直接原因までは断定しない。** ユーザーのブラウザ保存領域には触れていない。

## 採用した方式と自己修復

登録経路を維持し、開発時は通信結果に COOP/COEP ヘッダーを付けて返す方式を採用した。製品と同じ登録経路を検証でき、古い登録から自動的に移行できるためである。

- fetch の開発分岐は `caches.open` より前で戻る。キャッシュの参照・作成・保存をせず、通信失敗をそのまま伝える。404 も古い HTML に置き換えない。
- install は開発時だけ `skipWaiting()` を待つ。
- activate は開発時だけ `clients.claim()` の後に `prefix + 'development'` を削除する。他スコープ・他アプリ・製品版・メタ情報を削除しない。

試作では削除を claim より先に行ったところ、タブ読み込み中の切り替え直後に 48 件の保存が残る観測があった。先に旧 Worker への新しい取得を止めてから削除する順序へ修正した。最終実装では読み込み完了待ちを追加せずに移行試験を 3 回実施し、いずれも成功した。さらに帯の文字の opacity が 1 になるのを待つ画像確認を追加して 1 回成功した。推測される競合の内部順序まではブラウザ内を計測していない。

最終実装のブラウザ試験では、登録解除・Clear site data・タブの閉鎖は行わず、登録の `update()` で実際の新規インストールと有効化を起動した。

| 観測 | 結果 |
|---|---|
| 旧 Worker の開発キャッシュ | 48 件 |
| 開いたままの 2 タブ | 両方で controllerchange が 1 回 |
| 移行後の開発キャッシュ | キャッシュ名自体が消失 |
| 他アプリ・他スコープ | 各 1 件を維持 |
| 新しい main.ts | 新しい本文、COOP same-origin / COEP require-corp |
| 移行後の対局 | 「対局開始」が表示、▲７六歩 → △８四歩、2 手 |
| 対局後の開発キャッシュ | 再作成なし |
| 古い main.ts を人工的に再投入し通信失敗 | TypeError。古い本文は返さない |
| サーバー停止後の再読み込み | net::ERR_FAILED。古い画面で起動しない |

旧 Worker の `ojiji:/:meta` 1 件は残る。これは旧 Worker が記録した動作版の名前であり、ソース本文の保存ではない。移行後に全アプリ合計の `caches.keys()` が空になったとは報告しない。新しい保存領域では install・activate・fetch・message を通してキャッシュが一つも作られないことを単体試験で確認した。

ブラウザの証拠: `logs/dev-sw-cache/browser-migration.mjs`、`browser-migration-1.json`〜`browser-migration-3.json`、追加の画像確認を含む `browser-migration.json` と `browser-migration-visual.txt`、`dev-banner.png`、`dev-after-move.png`。

## 製品版の維持と検証結果

製品の install・activate・保存検証・更新整理・Range 応答は変更していない。fetch にある開発条件を早期分岐へ移しただけで、製品の完全保存・ナビゲーション代替取得の条件は同じ。既存の製品単体試験 13 件と PWA 24 件の本体・条件は変更せず、新たに製品の初回・更新で skipWaiting が呼ばれない試験も足した。

| 検証 | 結果 | 証拠（logs/dev-sw-cache/ 内） |
|---|---|---|
| 型検査 | 成功 | typecheck.txt |
| 単体 | 19 ファイル、349 件成功（うち SW 18 件） | unit.txt |
| 操作 | Chromium 28 + WebKit 28 = 56 件成功 | e2e.txt / e2e-results.json |
| 製品 PWA | 既存 24 件成功、44.9 秒 | pwa.txt / pwa-results.json |
| 製品通し | 1 件成功、73 手・詰み・プレイヤー勝利 | fullgame.txt / fullgame-results.json / product-game/ |
| ビルド・オフライン目録 | 成功、30 資源、版 53f79fad3f1f1162e2b3 | build.txt / prepare-offline.txt |

Playwright の 3 レポートを解析し、全テストの status が expected、結果配列が各 1 件、結果が passed であることを照合した。skipped・flaky・unexpected はすべて 0。結果の再試行は一度もない。集計スクリプトと結果は `collect.mjs` と `verified-summary.json`。

### 実行環境による起動方法の違い

このタスクの制限環境では通常の `npm test` と `npm run build` が、設定を束ねる esbuild の親ディレクトリ読み込みで `Cannot read directory "../../../..": Access is denied.` となった。どちらも試験・ビルドの本体に入る前で、記録は `npm-test.txt` と `npm-build.txt`。これらの通常コマンド自体が成功したとは報告しない。ACL やセキュリティ設定は変更していない。

同じ設定ファイルを runner 方式で読み、次を実行した。

```text
npm run typecheck
node node_modules/vitest/vitest.mjs run --configLoader runner
node node_modules/vite/bin/vite.js build --configLoader runner
node scripts/prepare-offline.mjs
node node_modules/vite/bin/vite.js --configLoader runner --port 5179 --strictPort
node node_modules/@playwright/test/cli.js test --retries=0
node logs/dev-sw-cache/run-pwa.mjs
npm run e2e:fullgame
```

操作試験は同じ構成で再試行を 0 にして実行した。PWA は既存の `createStaticServer` を検証ラッパーで 5180 / 5181 に起動し、同じ `playwright.pwa.config.ts` と全 24 件を実行した。障害注入は両サーバーとも有効。既存サーバーを再利用させ、終了時にはラッパー自身が閉じることで、以前遭遇した Windows の子プロセス停止待ちを避けた。試験の条件・件数・タイムアウトは緩めていない。検証用サーバーは終了した。

## 開発ポート

`vite.config.ts` に `server.port: 5173` と `strictPort: true` を設定した。`.claude/launch.json` はポート引数の重複をやめて `npm run dev` を呼び、表示上の port も 5173 に合わせた。README に既定 URL と使用中の場合の停止を記載した。明示的なテスト用ポート指定は従来どおり有効で、5179 / 5180 / 5181 / 5182 は変更していない。

実際に設定を読み出して 5173 と strictPort を確認し、5173 を使用中にした状態で既定設定の Vite が `Port 5173 is already in use` で停止することも確認した。証拠は `port-check.mjs`、`port-check.json`。

## 残る最終確認

ユーザー本人がいつものリポジトリで `npm run dev` を起動し、**いつもの http://localhost:5173 を Clear site data なしで再読み込みして、対局開始の帯、駒の移動、オジジの応手を確認すること**。検証用 5190 の自動試験で、この条件を代替したことにはしない。

依頼時から存在した `docs/claude-playtest-review.md` と `docs/codex-dev-sw-cache-instructions.md`、既存の査読文書には編集していない。固定素材・台詞・音量・ゲーム実装・公開先の空欄も変更していない。

変更は作業ツリーに保存済みだが、コミットと push は未実行。リポジトリと `.git` の書き込み許可を追加した後も、`git add` が `.git/index.lock: Permission denied` で停止した。権限設定を削除・変更する回避策は実施していない。起点 `57745d5` からの差分と、この報告書・検証記録を提出する。
