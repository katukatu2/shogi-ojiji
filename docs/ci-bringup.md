# GitHub Actions 立ち上げ記録

更新: 2026-09-12。作業指示: [codex-ci-bringup-instructions.md](codex-ci-bringup-instructions.md)。

**未完了。GitHub Actions の実行はまだ 0 回、連続成功は 0/3。品質保証の自己評価は上げない。**

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

GitHub CLI 設定フォルダーへの追加書き込み許可を申請したが、返された許可にはネットワークと対象 `.git` だけが含まれ、設定フォルダーは含まれなかった。理由の詳細は返されていない。設定フォルダーの ACL を変更せず、ユーザー自身の通常の PowerShell で上記ログインを完了してもらう段階。リポジトリ作成・push はまだ行っていない。

その後、ユーザーの PowerShell で `Authentication complete`、`Logged in as katukatu2` が表示され、ログインは完了した。しかし Codex の実行アカウントは `Katu\CodexSandboxOnline` で、ネットワーク許可後も `gh api user` は HTTP 401 だった。認証を上書きする `GH_TOKEN` / `GITHUB_TOKEN` 等の環境変数は存在しない。GitHub CLI の `hosts.yml` は更新済みで対象アカウントを含むが、インラインの `oauth_token` は含まない（値は表示していない）。CLI のヘルプにある既定の Windows 資格情報ストアへの保存と整合し、ユーザー側の認証を別アカウントの実行環境から利用できない状態と判断した。

[OpenAI の Windows sandbox の説明](https://learn.chatgpt.com/docs/windows/windows-sandbox)にも、専用の権限を制限した Windows ユーザーで実行する仕組みが記載されている。サンドボックスの弱体化、資格情報の平文への書き出し、トークンのチャットへの貼り付けは行わない。認証済みのユーザー側 PowerShell で実行する `Start-ShogiCI.ps1` をタスクの outputs に用意した。アカウント、非公開設定、origin、main とコミットを検査したうえで push し、同一コミットの CI を順に 3 回実行し、run 情報・ステップ時間・ログ・artifact を `logs/ci-bringup/<日時>/<run ID>/` に取得する。失敗時は証拠を保存して止まり、次の回を成功扱いで進めない。まだこのスクリプトの GitHub 操作は実行していない。

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

作業開始時の既存差分には、fullgame のステップ上限を 20 分から 25 分へ変更する修正が含まれていた。`6676b11` で保存した。理由は Playwright の全体上限 20 分後のレポートと終了処理の猶予であり、対局を長く許容する変更ではない。GitHub での所要時間に基づく確認は未実施である。

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

通常の設定読み込みのエラーを避けるため、Windows の確認コマンドだけで `--configLoader runner` を使用した。CI の `npm test` / `npm run build` は変更せず、Linux での結果を待つ。PowerShell の `npm` 経由ではオプションが正しく渡らなかった試行も失敗として扱い、直接 CLI を起動した上記の成功と区別した。

製品通し試験は `node node_modules/@playwright/test/cli.js test --config playwright.fullgame.config.ts` で実行した。新しい `logs/fullgame/results.json` を読み、`expected: 1`、`skipped: 0`、`unexpected: 0`、`flaky: 0` を確認。実際の対局の `result.json` で `endedByMate: true` と 39 手を確認し、同じ出力フォルダーに `mate.png` / `result.png` があることも確認した。GitHub の artifact にアップロードされた証拠ではない。

## GitHub Actions の実行記録

| 回 | run URL | main のコミット | 結果 | 所要時間・各ステップ時間 | artifact |
|---|---|---|---|---|---|
| — | 未実行 | — | 認証済みユーザー側 PowerShell での起動待ち | 未計測 | 未生成 |

GitHub で実行後、失敗した run も省略せず記録する。成功 run では、製品通しの `result.json` の `endedByMate: true`・手数・棋譜と `mate.png` / `result.png`、自動対局の全 5 戦法各 2 局・error 行 0、操作 44 件と PWA 24 件の実行結果を artifact から確認する。自動対局は現在の `--all-styles --games 2 --plies 60` で所要時間を計測する。

## WebKit の切り分け

**Linux で未実行のため未判定。** Windows 固有とは現時点では結論づけない。Linux で 3 回再現しない場合も、観測結果を「当該 Linux 環境の 3 回では再現なし」と記録したうえで Windows 側の環境差を評価する。Windows の日常確認から外すかどうかは実行結果を得てから提案する。

## 未完了

- 認証済みのユーザー側 PowerShell からの非公開リポジトリ作成、main の push。ユーザー側の再認証自体は完了。
- GitHub Actions の実行、失敗原因の修正、同じ最終コードで連続 3 回成功。
- 各 run の URL、ジョブと各ステップの所要時間、artifact の一覧と中身の取得・確認。
- 毎回の製品通し試験が詰みまで完走することの GitHub 上の証拠。
- Linux WebKit の再現性の判断と Windows での日常確認の提案。
- 独立査読による判定。自己評価で品質保証を 8 に変更しない。
