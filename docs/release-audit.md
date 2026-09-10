# Codex 引き継ぎ後の査読・修正記録

更新: 2026-09-10。起点は main の `a9bf6fd`（Claude の引き継ぎ）。
**公開準備は未完了。4領域すべて8点という完成条件を達成したとは判定していない。**

## ユーザーが確定した方針

- iPhone の App Store 版、Android、Web を今回の対象とする。
- アプリ名は「将棋オジジの定石指南」。表記の「（仮）」を外す。
- ストア画像の原案は Codex が作る。
- ソース公開先と連絡先は未定。仮のURL・メールアドレスを実在するものとして埋めない。
- 既定の5段階の台詞、一手一台詞、声なし、駒音と雷だけ、雷10%、タイトルは全身・対局は顔のみを維持する。固定素材・エンジンの差し替えはしない。

## 今回修正した点

| 対象 | 問題と対応 |
|---|---|
| エンジン試験 | 時間制限で正解を断定していた試験を固定深さ・1スレッドに変更。飛車で角を取り返せる誤ったSFENを修正。一手詰めを実際の詰み局面で検証する |
| 画面の「戻る」 | history.go(-2)のpopstateを2回と数え、後の戻る操作を取りこぼす問題を修正。履歴移動中の再操作も調整する |
| 画面の分割 | タイトル・設定・結果・振り返り・履歴とGame型を別ファイルへ。main.tsを1,419行から1,049行へ整理。対局制御は引き続きmainにある |
| 簡易AI | 主な探索を専用Workerへ移し、使えない場合だけ短時間の同期探索へ戻る。待ち中に対局が変わった場合の応手を捨てる |
| 効果音 | ミュート・画面切り替え時に駒音も停止。素材と雷の音量は変更しない |
| 結果の教訓 | 実際には銀が出ていない対局に「銀が前に出た」と無作為に表示する問題を修正 |
| オフライン | ビルド時に必要な全資源と識別子を生成し、初回保存後はHTML・JS・素材を同じ版で返す。更新は既存タブを閉じてから有効化。他アプリのキャッシュを消さない |
| オフライン音声 | 音声URLのバージョン文字列と保存先の不一致を修正。キャッシュからのRange部分読み込みに対応 |
| 公開案内 | 公開済みという誤った表示を「公開準備中」へ。壊れたソースリンクを除去。GPL本文をdist/LICENSE.txtへ同梱 |
| iOS | Capacitor 8.5.1のSwiftPMプロジェクト、iPhone・縦画面、正式名、アイコン・起動画面を用意。予約済みhttpsスキームをcapacitorへ修正 |
| Android | OSバックアップの除外ルールと秘密鍵のgit除外を追加。公開時の保存説明を実態に合わせた |
| CI・資料 | Chromium/WebKit/PWAの試験、署名なしiOSシミュレータビルド用CI、公開情報チェック、ストア画像生成手順を追加。掲載文の強さ選択・対応環境・年齢の未確認事項を修正 |

`public/raizo`、`public/sfx`、`public/engine`、`assets-src` に起点からの変更はない。やねうら王の配布物とnpmパッケージの照合は `engine-provenance.json` に記録する。

## 検証結果

- Node 22.15.0。型チェック成功。
- Vitest: 12ファイル・273件成功。通常のファイル並列を無効にせず通過。
- 操作E2E: Chromium 17件 + WebKit 17件 = 34件成功。最終実行では再試行なしで全件通過。
- PWA: Chromiumで配信ヘッダーあり／なし × ルート／サブフォルダの4件成功。初回保存後のオフライン再起動、初対局のエンジン応手、音声の部分読み込み、製品ビルドに開発APIがないことを確認。
- Vite製品ビルドとAndroid/iOSへのCapacitor sync成功。ビルド時の4つのclassic-script警告は既存の外部配布JSの形式によるもの。
- ストア原案: 実際のWeb画面5枚（1080×1920）と横長画像1枚（1024×500）を作成し、目視確認。
- `npm run release:check` は公開情報未確定のため意図どおり失敗する。成功するようダミー情報を入れていない。

途中の一括E2EではWindows版WebKitが予期せず閉じる事象があった。投了・再戦の個別3回は成功し、その後の最終34件も成功したが、原因を解消したとは断定しない。CIと実機での継続確認が必要。
WebKitはWindows上のPlaywrightブラウザであり、iPhone SafariやネイティブWKWebViewの実機試験ではない。

## 4領域の再評価

| 領域 | 引き継ぎ時 | 今回の根拠 | 8点判定まで残るもの |
|---|---|---|---|
| 指導の信頼性 | 5/10、修正後の再評価待ち | 判定・振り返り・将棋ルールの既存試験が成功。誤った試験局面と対局後の不適切な教訓を修正 | Claudeによる既存修正と今回差分の独立した再査読、実局面の説明確認 |
| ゲーム完成度 | 6/10、修正後の再評価待ち | 戻る、投了、再戦、成り、不成、持ち駒、ヒント、待った、昇級、免状、振り返りを自動確認 | 人による遊びの検証、長い対局・中断復帰・小さい実機での確認 |
| リリース準備 | 未評価 | iOS雛形、オフライン対局、ライセンス同梱、掲載原案、ビルド手順を整備 | 公開先・連絡先、対応ソース、配布条件、署名、ネイティブビルド・実機確認 |
| 品質保証 | 6/10 | main分割、273単体・34操作・4PWA、CI拡充 | 実機とCIでの再現確認、WebKit終了の切り分け、複数版間のPWA更新・OS中断復帰 |

未検証を成功と数えて点数を上げない。

## リリースを止めているもの

1. **公開先・連絡先・ホスティング未定**。Git remoteも未設定。URL確定後に公開案内・プライバシーポリシー・ストア欄を揃える。
2. **ネイティブ成果物が未検証**。このWindows環境ではJDK/Android SDK/Xcodeによるビルドを実施していない。cap sync成功はAPK・IPAビルド成功ではない。追加したCIも未実行。
3. **iOSの本格判定**。capacitorスキームのWKWebViewでSharedArrayBuffer／やねうら王が動くか未検証。Webで動いたことや簡易AIが動いたことを、同等機能の証拠にしない。
4. **GPLに沿うソース提供とストア条件**。プロジェクトはGPLv3で提供する方針。npmのバイナリ参照だけで対応ソース一式を確認したことにはならない。エンジン・評価関数を含む対応ソース、ビルド手順、配布条件を整え、App Storeでの提供条件との整合を確認する。根拠: [GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.ja.html)、リポジトリのLICENSE。
5. **実機検証・署名・掲載情報の仕上げ**。端末、開発者アカウント、年齢質問票、Privacy Report、実機スクリーンショットが残る。ストア原案を実機画像として提出しない。[Appleの画像要件](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)。

具体的な手順は [release-checklist.md](release-checklist.md)。

## CodexとClaudeの分担

- Codex: 実装、不具合の再現、テスト実行、ビルド、スクリーンショット、査読指摘の修正と記録を担当する。
- Claude: 節目で限定した差分を査読し、重大な見落とし・説明の不整合と4領域の再評価を返す。同じ実装を両者に同時編集させない。
- ユーザー: 実機の用意、遊びの評価、公開先と連絡先、開発者アカウントでの署名・提出を担当する。
- 次にClaudeへ渡す依頼文は [claude-review-request.md](claude-review-request.md)。返答をCodexへ渡せば、再現・修正・再検証を継続できる。
- このセッションにはClaudeを呼ぶ接続ツールがなく、claude CLIも見つからなかった。Claudeへの送信や査読の実施はまだ行っていない。

## 再現用コマンド

通常環境:

```bash
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium webkit
npm run e2e
npm run e2e:pwa
npx cap sync
npm run release:check
```

このCodexのWindowsサンドボックスではViteの設定バンドルが親ディレクトリでAccess deniedとなったため、以下を使用した。製品設定の制限を回避するための変更はしていない。

```bash
npm test -- --configLoader runner
npm run typecheck
node node_modules/vite/bin/vite.js build --configLoader runner
node scripts/prepare-offline.mjs
npm run dev -- --configLoader runner --port 5179 --strictPort
node scripts/serve-static.mjs 5180
node scripts/serve-static.mjs 5181 --isolated
# サーバー起動後、別ターミナルで
npm run e2e -- --workers=1
npm run e2e:pwa -- --retries=0 --workers=1
```

Capacitor CLIのos.userInfoがこの環境で失敗したため、作業用のラッパーでシェル名だけを補ってsyncした。アプリ本体やnode_modulesはそのために書き換えていない。通常環境では `npx cap sync` を使う。
