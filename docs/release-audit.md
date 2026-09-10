# Codex 引き継ぎ後の査読・修正記録

更新: 2026-09-10。起点は main の `a9bf6fd`（Claude の引き継ぎ）。
**公開準備は未完了。4領域すべて8点という完成条件を達成したとは判定していない。**

Claudeの `e0b2b69` に対する18指摘を受領し、[指摘ごとの回答](codex-review-response.md)に修正と検証を記録した。以下はその対応後の状態。査読原文は [claude-review.md](claude-review.md) に保存している。

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
| 結果の教訓 | 前回一律文にしたため戦法別助言を消していた。助言を復元し、盤面を述べる文には条件を付けた |
| オフライン | ビルド時に必要な全資源と識別子を生成し、初回保存後はHTML・JS・素材を同じ版で返す。更新は既存タブを閉じてから有効化。他アプリのキャッシュを消さない |
| オフライン音声 | 音声URLのバージョン文字列と保存先の不一致を修正。キャッシュからのRange部分読み込みに対応 |
| 公開案内 | 公開済みという誤った表示を「公開準備中」へ。壊れたソースリンクを除去。GPL本文をdist/LICENSE.txtへ同梱 |
| iOS | Capacitor 8.5.1のSwiftPMプロジェクト、iPhone・縦画面、正式名、アイコン・起動画面を用意。予約済みhttpsスキームをcapacitorへ修正 |
| Android | OSバックアップの除外ルールと秘密鍵のgit除外を追加。公開時の保存説明を実態に合わせた |
| CI・資料 | Chromium/WebKit/PWAの試験、署名なしiOSシミュレータビルド用CI、公開情報チェック、ストア画像生成手順を追加。掲載文の強さ選択・対応環境・年齢の未確認事項を修正 |

`public/raizo`、`public/sfx`、`public/engine`、`assets-src` に起点からの変更はない。やねうら王の配布物とnpmパッケージの照合は `engine-provenance.json` に記録する。

## 検証結果

- Node 22.15.0。型チェック成功。
- Vitest: 15ファイル・304件成功。通常のファイル並列を無効にせず通過。本体条件の2スレッド・400ms・MultiPV 2も追加。ある実行の到達深さは初期16・10手目13で、端末・負荷に依存する。
- 操作E2E: Chromium 20件 + WebKit 20件 = 40件成功。再試行なしで全件通過。リロード後の履歴、拡大振り返りの戻る、旧台詞タイマーも検証。
- PWA: 14件、再試行なしで一括成功。配信ヘッダーあり／なし、ルート／サブフォルダのオフライン再起動に加え、初回保存失敗3種からの復旧、実対局・投了・振り返り、更新失敗・連続更新を検証。製品に開発APIがないこと、エンジン応手、音声Rangeも確認。
- Vite製品ビルドとAndroid/iOSへのCapacitor sync成功。ビルド時の4つのclassic-script警告は既存の外部配布JSの形式によるもの。
- ストア原案: 実際のWeb画面5枚（1080×1920）と横長画像1枚（1024×500）を再生成。変更した指導・結果画面を目視確認。
- `npm run release:check` は公開情報未確定のため意図どおり失敗する。成功するようダミー情報を入れていない。
- `npm run release:artifacts` は成功。iOSの実PNG形式、3プラットフォームの版番号、全配信資源の存在・SHA-256一致を確認する。CIにも追加したがリモート未設定のためCI自体は未実行。

前回の途中の一括E2EではWindows版WebKitが予期せず閉じる事象があった。今回の40件では再現しなかったが、原因を解消したとは断定しない。CIと実機での継続確認が必要。
WebKitはWindows上のPlaywrightブラウザであり、iPhone SafariやネイティブWKWebViewの実機試験ではない。

## 4領域の再評価

| 領域 | Claudeの直前の評価 | 今回の根拠 | 8点判定まで残るもの |
|---|---|---|---|
| 指導の信頼性 | 6/10 | 取り返しの説明、戦法助言、応手表記を修正。査読の実棋譜で回帰試験 | 今回差分の独立した再査読、実局面の説明確認、深さ表示の判断 |
| ゲーム完成度 | 6/10 | 履歴・結果の戻る・台詞競合を修正。実プレイから投了・振り返りも確認 | 人による遊びの検証、長い対局・中断復帰・小さい実機での確認 |
| リリース準備 | 4/10 | 実AppIconのRGB化、版番号統一、生成物検査、オフライン復旧 | 公開先・連絡先、対応ソース、配布条件、署名、ネイティブビルド・実機確認 |
| 品質保証 | 5/10 | 製品SW分岐・複数版の実更新、本体条件の実エンジン、実対局の結果画面を検証 | 実機とCIでの再現確認、WebKit終了の切り分け、OS中断復帰 |

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
- 次にClaudeへ渡す依頼文は [claude-rereview-request.md](claude-rereview-request.md)。返答をCodexへ渡せば、再現・修正・再検証を継続できる。
- このセッションにはClaudeを呼ぶ接続ツールがなく、claude CLIも見つからなかった。今回の査読はユーザーから受領した。再査読依頼の自動送信はしていない。

## 再現用コマンド

通常環境:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run release:artifacts
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
node scripts/serve-static.mjs 5180 --faults
node scripts/serve-static.mjs 5181 --isolated --faults
# サーバー起動後、別ターミナルで
npm run e2e -- --workers=1
npm run e2e:pwa -- --retries=0 --workers=1
```

Capacitor CLIのos.userInfoがこの環境で失敗したため、作業用のラッパーでシェル名だけを補ってsyncした。アプリ本体やnode_modulesはそのために書き換えていない。通常環境では `npx cap sync` を使う。
