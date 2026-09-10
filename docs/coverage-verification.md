# 追加査読後に広げた検証

2026-09-10。起点は `baebaeb`。Claudeの [追加査読](claude-followup-review.md) は原文のまま保存した。同コミットまでの独立評価は指導7・ゲーム7・リリース7・品質保証7。以下はその後にCodexが実施した確認であり、新しい独立評価ではない。

## 4戦法の実局面

| 戦法 | 局数 | 手数 | 台詞 | 候補手を合法手と照合 |
|---|---:|---:|---:|---:|
| 四間飛車 | 1 | 88 | 15 | 3 |
| 角換わり | 2 | 154 | 23 | 2 |
| 棒銀 | 2 | 174 | 25 | 7 |
| 中飛車 | 2 | 174 | 31 | 3 |
| 合計 | 7 | 590 | 94 | 15 |

`scripts/selfplay.ts` で初期局面から採取。判定400ms、Nodeのエンジン1スレッド、先手探索深さ5・乱数による候補選択、後手探索深さ6。製品と共通のJudge・駒組み・説明を使用するが、製品の2スレッド設定や実機の速度を再現したものではない。

全94件の局面を棋譜から復元し、手順・指した手・表示した候補手の合法性と「王手じゃ」の盤面を再検査した。文章の意味全体を自動保証する検査ではない。棒銀と中飛車の各1局は100手の採取上限。元ログの `result=draw` はこの上限を意味し、ルール上の引き分けを確認したものではない。

採取コマンド（出力は `logs/four-styles/`）:

```bash
npm run selfplay -- --style shikenbisha --games 1 --plies 100 --judgeMs 400 --seed 101 --out logs/four-styles/shikenbisha.jsonl
npm run selfplay -- --style kakugawari --games 2 --plies 100 --judgeMs 400 --seed 202 --out logs/four-styles/kakugawari.jsonl
npm run selfplay -- --style bougin --games 2 --plies 100 --judgeMs 400 --seed 303 --out logs/four-styles/bougin.jsonl
npm run selfplay -- --style nakabisha --games 2 --plies 100 --judgeMs 400 --seed 404 --out logs/four-styles/nakabisha.jsonl
```

このサンドボックスではVite設定のバンドルが親フォルダで拒否されるため、作業用のViteNodeRunnerから設定ファイルなしで同じスクリプトを実行した。通常環境のコマンドは上記。時間制限の探索なので、同じseedでも端末・負荷により棋譜は変わり得る。

## 見つかった問題と修正

### 1. 駒組みの一手だけで囲いの完成を断定する

四間飛車の12手目 `△７二銀` で、玉がまだ６二なのに「美濃囲い、完成じゃ」と言った。中飛車の32手目と14手目にも同じ誤りがあった。合法で損の少ない手を選ぶ駒組みは、台詞が想定する順番どおりに進むとは限らない。

`planComment` に指した後の局面を渡し、基本形の玉・金・銀が揃っていて王手中でない場合だけ完成を伝えるよう修正。矢倉の完成と金銀三枚の断定にも盤面条件を付けた。四間飛車の銀を「飛車の横」と呼ぶ文と、穴熊で「王手はかからん」と断定する文も、指した駒とこれからの狙いを述べる文に改めた。

実棋譜の回帰試験は修正前に失敗した。修正後は、完成した基本形では完成を伝えること、金が欠ける・相手の銀である・王手中などの形では断定しないことも確認。確定している5段階の台詞・一手一台詞・固定素材・効果音・評価閾値は変更していない。

### 2. 桂で角を取るだけで「角交換」の課題を達成する

製品UIの45手で勝った対局で発見。21手目 `▲４四桂` で相手の角を取ったが、自分の角は８八に残ったままだった。それでも角交換の課題IDが記録されていた。`bishopExchange` が取られた駒だけを見ており、取る側の駒や交換の成立を見ていなかった。

自分の角で取り、相手が合法に取り返せる場合か、自分の角を失った後に相手の角を取り返す場合に限定。桂による単なる角取りは課題IDを付けない。先手からの角交換と、後手から交換されて銀で取り返す場合を維持した。誤ったIDが立つことを先に回帰試験で確認して修正した。

修正後の57手の製品対局では、角交換をしていないことを実際の捕獲から確認し、結果の「課題は次回」と保存データの未達成を検査した。

### 3. 自動対局の例外をCIが成功と扱う

`scripts/selfplay.ts` は各対局の例外をログに残した後、常に `process.exit(0)` していた。例外を2局に注入する試験で、失敗を期待しているのに0を返すことを再現した。

後続の対局とエンジンの終了処理は行い、1件でも失敗したら終了コード1を返す。CIには自動対局ログの保存と手動実行を追加した。AndroidのCIにはAGP 8.13が実際に要求したBuild-Tools 35も明示した。

## 製品の初期局面から詰みまで

`scripts/product-playthrough.ts` を追加した。製品に開発APIがないことを確認し、盤・持ち駒・成り選択・カットインを操作する。先手の候補は別のエンジンで選び、後手の手は画面に出た盤を合法手と照合して復元する。局面や棋譜・進捗をアプリに注入しない。

修正後の最終実行は57手で先手勝利。盤の合法手と王手で詰みを確認し、「オジジの一言を聞く」から結果を開き、初勝利・叱られず勝利の免状と1局・1勝の保存を確認した。成り・駒打ちも実対局中に操作した。「決め手」は0件で、この条件の確認は未完了。昇級までの連勝・OS中断復帰・人が遊ぶ評価も未確認。

最初の確認スクリプトは詰み後に結果画面が自動で開くと誤って仮定し、67手で詰んだ後に失敗した。盤上の詰みを確認してボタンから結果へ進む製品の動線に合わせてスクリプトを修正した。これは製品の不具合として数えない。

```bash
node scripts/serve-static.mjs 5181 --isolated --faults
# 別のターミナル
npx vite-node scripts/product-playthrough.ts -- --url http://127.0.0.1:5181 --out logs/product-playthrough-verified
```

## 最終検証

- 型チェック、Vitest 19ファイル325件成功。
- Chromium・WebKitの操作44件、製品PWA24件を再試行なしで一括確認。
- 製品ビルド、資源ハッシュ・アイコン・版番号の検査、Android/iOSへのCapacitor sync成功。
- 公開情報チェックは公開先・連絡先未定のため未完了。実機、CI、APK・IPAの成功を上記へ含めない。

## AndroidビルドとCIの状態

JDK 21.0.12.1、Android SDK Platform 36、Build-Tools 35/36、Platform-ToolsをCodexフォルダ内へ準備した。JDKとコマンドラインツールは公式配布のSHA-256と照合。[Adoptiumの取得・検証手順](https://adoptium.net/installation/ci-scripts/)、[Android公式ツール](https://developer.android.com/studio)、[SDK Manager](https://developer.android.com/tools/sdkmanager)。

Gradle 8.14.3 / AGP 8.13の実ビルドは `:capacitor-android:compileDebugJavaWithJavac` で失敗。SDK・依存JARの `Path.toRealPath()` がAccessDeniedとなる現象を、Javaの単独プログラムでも再現した。ファイルの存在と読み取りは可能。読み取り権限の追加と短い保存先でも解消しなかった。JDK自体やアプリを改変して回避していない。**APKは生成できていない。** Gradleのhelpタスクだけの成功はAPK成功として扱わない。

ツールの保存先は `C:\Users\sonot\Documents\Codex\.tools\shogi-android`。CIは接続先未設定で未実行。GitHub CLIは既存アカウント `katukatu2` の認証確認に失敗し、ネットワーク許可後の再確認でも同じ結果だった。非公開リポジトリへの保存方針をユーザーに確認中。公開先URLや連絡先として仮の値を埋めていない。

今回の局面ログと最終製品対局の画面は、このCodexタスクの `outputs/four-styles/` と `outputs/product-playthrough/` に置く。独立した確認依頼は [claude-coverage-review-request.md](claude-coverage-review-request.md)。
