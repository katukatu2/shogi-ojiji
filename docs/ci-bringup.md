# GitHub Actions 立ち上げ記録

更新: 2026-09-12。作業指示: [codex-ci-bringup-instructions.md](codex-ci-bringup-instructions.md)。

**GitHub Actions は同じ main のコミットで連続 3 回成功した。3 回分の成果物も取得して確認済み。独立査読による評価は未実施であり、品質保証を自己評価で 8 に変更しない。**

## 作業 0: Git の保存とリモート

### 書き込み拒否の調査と解消

- 作業場所は `C:\Users\sonot\Documents\Codex\2026-09-04\shogi-ojiji`、開始時の HEAD は `b0b3925`。リモートは未登録だった。
- このタスクの初期権限は Git メタデータへの書き込みを含まない。`.git` の ACL には、2 個の SID に対する明示的な書き込み等の拒否エントリも存在した。実行アカウントは `Katu\CodexSandboxOffline`。通常の `whoami /groups` の表示だけでは拒否 SID と制限トークンの関係までは断定できない。
- `.git/index.lock` は存在せず、`.git` は通常のディレクトリだった（リンク・再解析ポイントではない）。ウイルス対策や同期ソフトによる拒否を示す証拠は得られていない。今回、ウイルス対策設定・ACL を直接編集していない。
- 標準の権限申請でこの `.git` だけの書き込みを許可された後、専用の一時ファイルを排他的に新規作成し、閉じて削除する確認に成功した。`git add` と `git commit` も成功した。許可後も既存の拒否 ACL は残っていた。したがって、今回必要だった対処は作業セッションの書き込み許可であり、拒否 ACL の削除ではない。前タスクで失敗した正確な制限トークンまでは今回の結果から特定しない。
- 許可はこのターンの範囲。後続タスクで同じ制約が出たら、ACL の削除ではなく、必要な `.git` パスへの許可を確認する。

既存の変更を次の日本語コミットに保存した。既存の査読文書の内容は編集していない。

| コミット | 内容 |
|---|---|
| `036ce64` | 自動対局の不明・重複フラグと数値引数を検証する |
| `6676b11` | 製品通し試験の接続先と CI 終了処理の猶予を整える |
| `0062b12` | 独立査読の記録と CI 立ち上げ指示を保存する |

### ユーザーが選択した保存先

ユーザーは **案 A: 非公開リポジトリ**、アカウント **katukatu2**、名前 **shogi-ojiji** を選択した。公開先 URL と連絡先は未決定のまま維持する。

ネットワーク許可後も `gh auth status` は既存の認証情報を invalid と報告した。`gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key` で再認証を開始した。最初のコードは期限切れ。再発行したコードではユーザーの操作により GitHub 側の認証に成功したが、CLI が `C:\Users\sonot\AppData\Roaming\GitHub CLI\hosts.yml` に認証情報を保存する段階で Access denied となり終了コード 1。認証情報は利用可能な状態で保存されず、その後の `gh auth status` も invalid のままだった。

GitHub CLI 設定フォルダーへの追加書き込み許可を申請したが、返された許可にはネットワークと対象 `.git` だけが含まれ、設定フォルダーは含まれなかった。理由の詳細は返されていない。設定フォルダーの ACL を変更せず、ユーザー自身の通常の PowerShell で上記ログインを完了してもらうよう依頼した。この時点ではリポジトリ作成・push は未実施だった。

その後、ユーザーの PowerShell で `Authentication complete`、`Logged in as katukatu2` が表示され、ログインは完了した。しかし Codex の実行アカウントは `Katu\CodexSandboxOnline` で、ネットワーク許可後も `gh api user` は HTTP 401 だった。認証を上書きする `GH_TOKEN` / `GITHUB_TOKEN` 等の環境変数は存在しない。GitHub CLI の `hosts.yml` は更新済みで対象アカウントを含むが、インラインの `oauth_token` は含まない（値は表示していない）。CLI のヘルプにある既定の Windows 資格情報ストアへの保存と整合し、ユーザー側の認証を別アカウントの実行環境から利用できない状態と判断した。

[OpenAI の Windows sandbox の説明](https://learn.chatgpt.com/docs/windows/windows-sandbox)にも、専用の権限を制限した Windows ユーザーで実行する仕組みが記載されている。サンドボックスの弱体化、資格情報の平文への書き出し、トークンのチャットへの貼り付けは行わない。認証済みのユーザー側 PowerShell で実行する `Start-ShogiCI.ps1` をタスクの outputs に用意した。アカウント、非公開設定、origin、main とコミットを検査したうえで push し、同一コミットの CI を順に 3 回実行し、run 情報・ステップ時間・ログ・artifact を `logs/ci-bringup/<日時>/<run ID>/` に取得する。失敗時は証拠を保存して止まり、次の回を成功扱いで進めない。実行結果は後段に記録する。

### ユーザー側スクリプトの初回実行と修正

その後の初回実行で、非公開リポジトリ `katukatu2/shogi-ojiji` の作成とローカル `origin` の登録まで完了した。続く push 前の CI 履歴取得で、`workflowName` プロパティがないというエラーで停止した。GitHub Actions 内の失敗ではなく、こちらが用意した起動スクリプトの不具合である。この実行では push・CI 起動に到達していない。

原因は Windows PowerShell 5.1 の `ConvertFrom-Json` とパイプラインの配列の扱い。新規リポジトリの履歴 `[]` を直接 `Where-Object` へ流すと、配列自体に `workflowName` を求め、StrictMode により失敗する。JSON を変数へ受け、明示的な `foreach` で各 run を列挙するよう修正した。空の履歴は 0 件として扱い、StrictMode や失敗検出は維持した。

Windows PowerShell 5.1 で修正前の処理を戻した模擬実行は、初回の空履歴で同じ `workflowName` エラーになった。修正後は PowerShell 5.1 と 7 の両方で、(1) 新規・空履歴から 3 回成功、(2) 作成済み・空履歴のリポジトリを再作成せず再開、(3) CI 失敗時にログ・artifact を保存して次の run を起動せず停止、(4) 公開リポジトリを push 前に拒否、の 4 ケースすべてを確認した。GitHub/Git の操作は模擬応答であり、これらは実際の CI 成功回数に数えない。

修正版を同じ `outputs/Start-ShogiCI.ps1` に保存した。作成済みの非公開リポジトリと origin をそのまま検査して再利用できる。修正版の再実行で main の push と下記 3 回の実際の GitHub Actions 実行まで完了した。

### act の実施可否

`act` と `docker` は PATH に存在せず、標準インストール先に Docker Desktop もなかった。`wsl --list --quiet` は WSL が未インストールと報告した。現在の環境では `act` を実行できない。Docker/WSL の導入は Windows の環境変更が必要になり得るため、無断導入していない。

**act は未実行。仮に今後成功しても GitHub Actions の成功回数には加算しない。**

## CI の事前点検と変更

1. Playwright の Chromium と WebKit の導入は、操作・PWA・製品通しの全試験より前に `--with-deps` 付きで登録済み。
2. 成功時にも操作と PWA のレポートを保存するよう artifact 条件を変更した。保存対象を HTML だけから `logs/e2e` / `logs/pwa` 全体へ広げ、失敗時の生データも含める。
3. 3 種類の Playwright 設定に JSON レポートを追加した。件数、再試行、失敗や skipped を artifact から確認できるようにする。
4. 操作試験の trace を `retain-on-failure` にし、動画も `retain-on-failure` にした。最初の失敗を含む WebKit 異常終了の操作を調べられるようにする。
5. 各 artifact に `if-no-files-found: error` を設定した。生成されていない証拠を警告だけで通さない。artifact の中身が十分かどうかは、実際に取得して別途確認する。
6. ワークフローの GitHub トークン権限を `contents: read` に限定した。

この作業では試験件数、再試行回数、対局手数、判定時間、各タイムアウトを変更していない。`continue-on-error` や `--pass-with-no-tests` を追加していない。

作業開始時の既存差分には、fullgame のステップ上限を 20 分から 25 分へ変更する修正が含まれていた。`6676b11` で保存した。理由は Playwright の全体上限 20 分後のレポートと終了処理の猶予であり、対局を長く許容する変更ではない。今回の GitHub 上の製品通しステップは 55秒・59秒・1分11秒で成功し、既存の上限内に収まった。追加の上限延長は不要だった。

## 今回のローカル確認（CI 成功には数えない）

| 確認 | 結果 |
|---|---|
| `npm run typecheck` | 成功 |
| 通常の `npm test` | 設定読み込み時に esbuild が親ディレクトリへの Access denied で停止。試験実行前の環境エラー |
| `node node_modules/vitest/vitest.mjs run --configLoader runner` | 19 ファイル・338 件成功、2.98 秒。既存の Vite 設定を別の読み込み方式で使用 |
| Vite build（`--configLoader runner`）と `prepare-offline.mjs` | 成功、30 資源。通常の `npm run build` 全体の成功としては扱わない |
| `npm run release:artifacts` | 成功 |
| Playwright `--list` | 操作 44 件、PWA 24 件、製品通し 1 件を検出。これは実行結果ではない |
| 製品通し試験（Windows、変更後の設定） | 1 件成功、32.5 秒、39 手で詰み・先手勝利。再試行・skipped・flaky はすべて 0 |
| `git diff --check` | 成功 |

通常の設定読み込みのエラーを避けるため、Windows の確認コマンドだけで `--configLoader runner` を使用した。CI の `npm test` / `npm run build` は変更せず、後段の Linux 実行では 3 回とも通常のコマンドで成功した。PowerShell の `npm` 経由ではオプションが正しく渡らなかった試行も失敗として扱い、直接 CLI を起動した上記の成功と区別した。

製品通し試験は `node node_modules/@playwright/test/cli.js test --config playwright.fullgame.config.ts` で実行した。新しい `logs/fullgame/results.json` を読み、`expected: 1`、`skipped: 0`、`unexpected: 0`、`flaky: 0` を確認。実際の対局の `result.json` で `endedByMate: true` と 39 手を確認し、同じ出力フォルダーに `mate.png` / `result.png` があることも確認した。GitHub の artifact にアップロードされた証拠ではない。

## GitHub Actions の実行記録

非公開リポジトリ: [katukatu2/shogi-ojiji](https://github.com/katukatu2/shogi-ojiji)。対象は 3 回とも main の [`0171242aad4aafe05a62ffba796ad62b6c0336f5`](https://github.com/katukatu2/shogi-ojiji/commit/0171242aad4aafe05a62ffba796ad62b6c0336f5)。1 回目が push、2・3 回目が workflow_dispatch。すべて attempt 1 で連続して実行した。実行途中のコード・ワークフロー変更はない。

| 回 | run | 開始～完了（日本時間） | 全体 | check ジョブ | 結果 |
|---|---|---|---|---|---|
| 1 | [34667760376](https://github.com/katukatu2/shogi-ojiji/actions/runs/34667760376) | 11:28:31～11:36:42 | 8分11秒 | 8分5秒 | success |
| 2 | [34668160775](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668160775) | 11:37:12～11:45:00 | 7分48秒 | 7分43秒 | success |
| 3 | [34668521771](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668521771) | 11:45:13～11:53:54 | 8分41秒 | 8分36秒 | success |

全体は API の createdAt～updatedAt、ジョブとステップは startedAt～completedAt。ブラウザーの GitHub 実行画面でも対象コミット、成功状態、成果物 5 個を照合した。Ubuntu 24.04.5、runner image 20260907.300.1。操作試験は workers 1。ローカル結果や act は上表に含めていない。

### 各ステップの時間

| ステップ | 1 回目 | 2 回目 | 3 回目 |
|---|---|---|---|
| Set up job | 1秒 | 1秒 | 0秒 |
| actions/checkout@v4 | 1秒 | 2秒 | 1秒 |
| actions/setup-node@v4 | 1秒 | 2秒 | 3秒 |
| npm ci | 6秒 | 4秒 | 3秒 |
| npm run typecheck | 5秒 | 5秒 | 4秒 |
| npm run build | 5秒 | 6秒 | 7秒 |
| npm run release:artifacts | 1秒 | 0秒 | 0秒 |
| npm test | 14秒 | 13秒 | 15秒 |
| npx playwright install --with-deps chromium webkit | 56秒 | 46秒 | 1分13秒 |
| npm run e2e | 2分33秒 | 2分27秒 | 2分31秒 |
| npm run e2e:pwa | 1分27秒 | 1分27秒 | 1分28秒 |
| npm run e2e:fullgame | 55秒 | 59秒 | 1分11秒 |
| 成果物: product-fullgame | 2秒 | 2秒 | 2秒 |
| 成果物: playwright-report | 1秒 | 1秒 | 1秒 |
| 成果物: pwa-report | 2秒 | 1秒 | 2秒 |
| npm run selfplay -- --all-styles --games 2 --plies 60 --out logs/ci-all-styles.jsonl | 1分28秒 | 1分21秒 | 1分27秒 |
| 成果物: selfplay-logs | 1秒 | 1秒 | 2秒 |
| 成果物: dist | 2秒 | 2秒 | 1秒 |
| Post Run actions/setup-node@v4 | 1秒 | 0秒 | 0秒 |
| Post Run actions/checkout@v4 | 0秒 | 0秒 | 1秒 |
| Complete job | 0秒 | 0秒 | 0秒 |

全ステップの status は completed、conclusion は success。skipped や continue-on-error による通過はない。5179 / 5180 / 5181 / 5182 を使う試験は同一ジョブ内で順に完走し、ポート競合は再現しなかった。

### 試験と棋譜の確認

| 回 | 単体 | 操作（Chromium / WebKit） | PWA | 製品通し | 自動対局 |
|---|---|---|---|---|---|
| 1 | 338 件 | 22 / 22 件 | 24 件 | 59 手、詰み、先手勝利 | 5 戦法×2 局、error 0 |
| 2 | 338 件 | 22 / 22 件 | 24 件 | 65 手、詰み、先手勝利 | 5 戦法×2 局、error 0 |
| 3 | 338 件 | 22 / 22 件 | 24 件 | 71 手、詰み、先手勝利 | 5 戦法×2 局、error 0 |

各 Playwright JSON レポートの全テストを列挙し、expectedStatus=passed、status=expected、結果が 1 個、retry=0 を確認した。3 回とも skipped / unexpected / flaky はすべて 0。単体 338 件の成功は GitHub のジョブログでも確認した。

製品通しの `result.json` は 3 回とも `endedByMate: true`、棋譜配列の長さと手数が一致し、進捗の games=1 / wins=1 を確認した。`mate.png` と `result.png` が各回の成果物にあり、結果画面も目視確認した。棋譜は回ごとに異なる。`decisive` は 3 回とも 0 であり、「決め手」の表示を網羅した証拠には数えない。

自動対局の JSONL では yagura / shikenbisha / kakugawari / bougin / nakabisha のそれぞれに game 0 と 1 の result があり、合計 10 局、error 行は 0。指定は `--all-styles --games 2 --plies 60` のまま。上限 60 手で draw となる局を含み、この自動対局 10 局に詰み完走を要求する検査ではない。詰みの検査は上記の製品通し試験で行っている。

### 成果物の一覧

各回 5 個、合計 15 個を API の一覧と取得済みファイルで照合した。すべて対象の run ID / commit を指し、サイズは 0 より大きい。

| 名前 | 1 回目（ID・容量） | 2 回目（ID・容量） | 3 回目（ID・容量） |
|---|---|---|---|
| product-fullgame | [10289264953](https://github.com/katukatu2/shogi-ojiji/actions/runs/34667760376/artifacts/10289264953)・351.2 KiB | [10288949543](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668160775/artifacts/10288949543)・349.4 KiB | [10290830090](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668521771/artifacts/10290830090)・352.2 KiB |
| playwright-report | [10289748988](https://github.com/katukatu2/shogi-ojiji/actions/runs/34667760376/artifacts/10289748988)・260.6 KiB | [10289980297](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668160775/artifacts/10289980297)・260.7 KiB | [10290710134](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668521771/artifacts/10290710134)・260.6 KiB |
| pwa-report | [10290055080](https://github.com/katukatu2/shogi-ojiji/actions/runs/34667760376/artifacts/10290055080)・256.2 KiB | [10289915315](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668160775/artifacts/10289915315)・255.9 KiB | [10290825064](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668521771/artifacts/10290825064)・256.6 KiB |
| selfplay-logs | [10289669613](https://github.com/katukatu2/shogi-ojiji/actions/runs/34667760376/artifacts/10289669613)・5.7 KiB | [10290540285](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668160775/artifacts/10290540285)・5.9 KiB | [10290236202](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668521771/artifacts/10290236202)・6.1 KiB |
| dist | [10289769033](https://github.com/katukatu2/shogi-ojiji/actions/runs/34667760376/artifacts/10289769033)・953.0 KiB | [10289965913](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668160775/artifacts/10289965913)・953.0 KiB | [10290136319](https://github.com/katukatu2/shogi-ojiji/actions/runs/34668521771/artifacts/10290136319)・953.0 KiB |

- product-fullgame: HTML / JSON レポート、対局の result.json、mate.png、result.png。
- playwright-report: 操作 44 件の HTML / JSON レポート。今回は全件成功なので失敗時だけ残す動画・トレースは不要だった。
- pwa-report: PWA 24 件の HTML / JSON レポート。
- selfplay-logs: ci-all-styles.jsonl。
- dist: ビルド済み配布資源、エンジン、アイコン、GPL 本文。

試験成果物の GitHub 保存期限は 2026-09-19、dist は 2026-12-11。取得済みのコピーは `logs/ci-bringup/20260912-112820/<run ID>/` に保存した。元の run.json、artifacts.json、run.log と成果物を残している。Windows PowerShell 5.1 経由の run.log は日本語の一部に文字化けがあるため、文言の確認は GitHub の元ログと直接ダウンロードした成果物を使用する。

## 失敗・警告と検査の変更

実際の GitHub Actions は 3 回とも初回成功で、実行中に修正した CI の失敗は 0 件。前段の認証・保存権限、Windows のローカル設定読み込み、起動スクリプトの空配列処理の失敗は、それぞれ上記の経過に記録した。

GitHub は Actions v4 の Node.js 20 ランタイムが非推奨となり、Node.js 24 で実行される警告を表示した。今回のステップはすべて成功しており、警告を削除・非表示にはしていない。今後の保守で Actions 自体のバージョン更新を検討する。アプリのテスト用 Node は setup-node で指定した 22。

時間上限の追加延長、手数・判定時間の削減、試験の省略、失敗の握りつぶしは行っていない。公開先 URL に仮の値を入れていない。非公開リポジトリの URL を配布用の公開先 URL として埋めていない。

## WebKit の切り分け

Linux（Ubuntu 24.04）の操作試験 44 件を 3 回実行し、うち WebKit は各 22 件、合計 66 件が再試行なしで成功した。Windows で報告された予期せぬブラウザー終了は、この Linux の 3 回では再現していない。今回の切り分けでは Windows 側の環境に依存する事象として扱う。ただし、3 回の非再現だけで他のすべての Linux 環境で発生しないことまでは断定しない。

日常の Windows 確認は Chromium を中心にし、WebKit の必須検査は Linux CI に残すことを提案する。Windows WebKit はブラウザー・依存関係の更新時と再現調査時に別途実行する。この提案によるローカル設定の除外変更はまだ行っていない。

## 残る作業と評価

CI の連続 3 回成功、各ステップ時間、成果物の内容、詰み完走、Linux WebKit の観測結果は確認済み。本報告は検証済みコミットの後に文書だけを更新したもので、アプリ・試験・ワークフローのコードは変えていない。報告書の最終追記をリモートに反映し、独立査読へ提出する。

品質保証の独立評価は従来の 7 のままで、Codex の自己評価で 8 には上げない。実機、APK/IPA、ストア提出、公開先 URL・連絡先、人の遊びの評価は今回の範囲外であり、今回の CI 成功で完了扱いにしない。
