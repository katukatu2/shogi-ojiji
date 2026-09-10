# 引き継ぎ（実装主担当 → Codex / Astra）

作成日: 2026-09-10

**Claude査読対応後の更新:** 原査読は [claude-review.md](claude-review.md)、18項目への回答は [codex-review-response.md](codex-review-response.md)、次にClaudeへ渡す文は [claude-rereview-request.md](claude-rereview-request.md)。以下の初期引き継ぎの件数・未実装一覧は履歴資料であり、現状は [release-audit.md](release-audit.md) を優先する。

**Codex更新（2026-09-10）:** 以下は元の引き継ぎ時点の記録。現在の変更・検証・残作業は [release-audit.md](release-audit.md)、Claudeへの次の依頼は [claude-review-request.md](claude-review-request.md) を参照。今回からiPhone App Store版も対象、名称の「（仮）」は外し、ストア原案はCodexが作成済み。公開先・連絡先は引き続き未定。

## 1. 最新コードと保存先

- 保存先: `C:\Users\sonot\Documents\Codex\2026-09-04\shogi-ojiji`
- ブランチ: `main`。最新コミット `db6f85b`。作業ツリーはクリーン、未マージのブランチなし。
- リモート未設定（`git remote` が空）。公開先が決まるまでローカルのみ。
- ドキュメント: `README.md`（仕様の主資料）、`docs/plan.md`、`docs/release-checklist.md`、`docs/store/listing.md`。

## 2. 起動・ビルド

Node 22 系（開発機は v22.15.0）。Windows。

```bash
npm ci
npm run dev        # 開発サーバー
npm run build      # 型チェック + 本番ビルド（dist/）
npm test           # 単体テスト（vitest）273 件
npm run e2e        # Playwright 7 本。vite dev を 5179 番で自動起動
npm run selfplay -- --style yagura --games 3 --plies 80 --out logs/x.jsonl
```

補助（素材を差し替えたときだけ）: `npm run icons`、`npm run assets:faces`、`npm run assets:body`、`npm run assets:sfx`、`npm run engine:copy`。
`assets:faces` と `assets:body` は Python と Pillow が要る。

Android: `npm run cap:android`。この開発機に JDK と Android SDK は無く、**一度もビルド・実機確認をしていない**。
CI（`.github/workflows/android.yml`）で APK を作る手順は書いてあるが**未実行・未検証**。

## 3. 実装済み機能

- 将棋のルール一式（合法手、二歩・打ち歩詰め・行き所のない駒、詰み、千日手、連続王手の千日手、持将棋、400 手打ち切り、SFEN、棋譜表記の「打」「成」「不成」）。
- オジジが 5 戦法（矢倉・四間飛車・角換わり・棒銀・中飛車）で駒組みし、変化と反応手を持つ。難易度 3 段階で読みの深さと手の選び方が変わる。
- 悪手判定 5 段階。やねうら王 WebAssembly 版（水匠 Petite）で評価し、段階 4・5 でカットイン。勝っているとき、負けが決まっているとき、最善手・ヒントの手のときは叱らない。
- 説明文の生成（見逃した手、相手の狙い、取られる駒、交換、受けと攻めの別、読みの深さの目安）。
- ヒント、待った、指し直し。
- 学習ループ: 今日の課題、昇級、称号と免状、結果画面の「今日の 3 手」（勝率の差で選び、拡大表示できる）。
- 画面: タイトル、対局設定、対局、カットイン、結果。オジジは顔のパーツアニメーション（タイトルのみ全身）。
- 音: 駒音と「ばかもーん！」の雷のみ。
- PWA（マニフェスト、アイコン、Service Worker で COOP/COEP 付与とキャッシュ）、Capacitor で Android プロジェクト生成済み。
- テスト: 単体 273 件、Playwright 7 本、CI（`.github/workflows/ci.yml`）。

## 4. 残作業と既知の不具合

残作業（優先順）:

1. **リリース準備の査読と修正**。着手直後に中断しており成果ゼロ。Web の静的配信、Android の WebView で Service Worker と SharedArrayBuffer が使えるかの検証、ストア提出物（スクリーンショット未作成）、GPL のソース公開先の記載。
2. **実機確認**。Android・iOS とも未実施。iOS はプロジェクト未生成（`npx cap add ios` に macOS が要る）。WKWebView で SharedArrayBuffer が使えるかは**未検証**。使えなければ判定が簡易版に落ちる。
3. **`src/main.ts` の分割**（1,419 行）。`src/style.css` も 1,610 行の 1 枚。分割は二度着手して二度とも中断、成果は残っていない。
4. **E2E の拡充**。結果画面の主要経路、引き分け、昇級、免状、成る手・打つ手、ブラウザの戻る操作が未カバー。

既知の不具合:

- `src/ai/engine.test.ts` の「SFEN で局面を渡せる」が**並列実行時にだけ落ちる**。単独では通る。やねうら王の読みの深さが負荷で揺れるため。時間依存の assert を直すか、読み時間を延ばすのが筋。
- 判定の説明は型文の組み合わせで、盤面と食い違う言い方が残っている可能性がある。`npm run selfplay` の出力を読んで点検する運用。
- エンジン無し（簡易判定）のとき、AI の探索が最大 300ms メインスレッドを止める。

## 5. 直前に進めていた作業

査読で 4 領域（指導の信頼性・ゲーム完成度・リリース準備・品質保証）の欠陥を洗い出し、裏取りした 16 件を修正していた。**判定・振り返り・ルール・画面側の修正はすべて `main` に入っている**。

止めた時点で走っていたのは 2 つ。

- リリース準備の査読と修正。**成果なし**、やり直しが必要。
- 画面側の修正。**ほぼ完了してコミット済み**（`27eaa35`、`db6f85b`）。ただし詰みの演出（オジジの顔と詰みの帯）の実機確認だけ途中で終わっている。

## 6. 変更してはいけない仕様・確定素材

仕様（ユーザーが明示的に決めたもの）:

- オジジの 5 段階の台詞。段階 2「良い手じゃな。だがワシならこう打つな。」、段階 3「むう…」、段階 4「それは悪手じゃろう」、段階 5「ばかもーん！」。
- 「ばかもーん！」は本当に悪い手だけ。勝っているとき、負けが決まっているとき（−1000 以下）、ヒントの手を指したときは叱らない。詰みの見逃しは 3 手以内だけ。
- **一手につきオジジの台詞は一つ**。連続で出さない。吹き出しが出ている間は新しい台詞を出さない。
- オジジに音声は付けない。音は駒音と雷のみ。**雷の音量は 10%**。
- 対局開始時に「今日の課題」をオジジの台詞として言わせない。
- 結果画面は簡潔に、対局中の会話は豊かに。
- タイトル画面のオジジは全身。顔以外は動かない。対局画面は顔のみ。

確定素材（差し替え禁止。元データは `assets-src/`）:

- `public/raizo/`: 顔 8 点（`faces/`）、体 1 点（`body.webp`）、`raizo-rig.js`（制作元納品）。
- `public/sfx/koma.mp3`: 駒音。「無料効果音で遊ぼう！（小森平）https://taira-komori.net/」。**クレジット表記必須**。
- `public/sfx/bakamon_thunder.mp3`: 雷。
- `public/engine/`: やねうら王 WebAssembly 版（GPLv3）と水匠 Petite。**クレジット表記必須**。

ライセンス: やねうら王が GPLv3 のため**プロジェクト全体が GPLv3**。ソース公開が必須。
`（公開先 URL）` が 6 か所（`src/main.ts`、`src/release.test.ts`、`docs/release-checklist.md`、`docs/store/listing.md`、`public/privacy.html`、`README.md`）にあり、URL が決まったら**同時に差し替える**。

## 7. 今回の完成条件

ユーザーが出した目標は「4 領域それぞれを 10 点満点中 8 点にする」。査読での現状評価は次のとおり。

| 領域 | 直近の評価 | 状態 |
|---|---|---|
| 指導の信頼性 | 5 | 指摘 8 件を修正済み。再評価が必要 |
| ゲーム完成度 | 6 | 指摘 8 件を修正済み。再評価が必要 |
| リリース準備 | 未評価 | 査読が中断したまま |
| 品質保証 | 6 | E2E の拡充と main.ts の分割が未着手 |

最終ゴールは iPhone・Android・Web アプリとしてリリースできる状態。
遊びの検証は人間（ユーザー）が担当する。

**未確定・要確認**（推測せずユーザーに聞くこと）:

- ソースコードの公開先 URL と連絡先。
- iOS を今回の対象に含めるか。App Store は GPL と相性の問題が指摘されている。
- ストアのスクリーンショットを誰がいつ用意するか。
- アプリ名の「（仮）」を外すかどうか。
