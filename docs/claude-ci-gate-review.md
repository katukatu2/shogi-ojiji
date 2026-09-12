# Claude 限定確認の記録（戦法指定と試験実行）

日付: 2026-09-11 / 査読者: Claude（実装ファイルは編集していない。追加したのはこのファイルだけ）
対象: `edd8c6e..b0b3925`。関連文書: [codex-coverage-response.md](codex-coverage-response.md)、前回の査読 [claude-coverage-review.md](claude-coverage-review.md)（未変更）。
依頼どおり、指導内容全体の再査読は行っていない。

## 結論

**2 点とも確認できた。**どちらも自分で実行して確かめた。

**新規欠陥が 1 件ある（低）。** 不明な *値* は拒否するようになったが、不明な *フラグ* は今も黙って無視される。CI は `--all-styles` という 1 つのフラグに全戦法の網羅を託しているため、そこを打ち間違えると矢倉 1 戦法だけを試して緑になる。前回指摘した穴が、`--style` から `--all-styles` へ移っただけの状態が残っている。

## 1. 戦法指定 — 確認できた

### 終了コードと副作用の順序

実 CLI で 3 通りを実行した。いずれも**終了コード 1** で、**既存の出力ファイルは書き換わらなかった**。

| 指定 | 終了コード | 既存ログ | 標準エラー |
|---|---|---|---|
| `--style does-not-exist` | 1 | 保持 | 使用できる 5 つの id を列挙 |
| `--style`（末尾で値なし） | 1 | 保持 | `(missing)` と列挙 |
| `--all-styles --style yagura` | 1 | 保持 | 列挙と「use --all-styles alone」 |

コード上も、判定は `mkdirSync` / `writeFileSync(OUT, '')` とエンジン生成より**前**に置かれている（`scripts/selfplay.ts:167-176`）。値が次の引数（`--style --seed 1`）の場合も `findStyle` が未定義を返して弾く。**エンジン起動や既存ログの破壊より先に終了する。**

### `--all-styles` の網羅と例外後の継続

`--all-styles --games 2` を実行し、記録を独立に集計した。

```
logs/check/all.jsonl  result: {yagura:2, shikenbisha:2, kakugawari:2, bougin:2, nakabisha:2} / error 0 / style欄なし 0
```

`STYLES`（アプリ本体の一覧）を直接回しているので、CI 側に別の id 一覧を持たない。Codex の実ログも独立に検証した。

```
logs/ci-all-styles.jsonl  90 行 / 5 戦法 × 2 局 / error 0 / style 欄なし 0
手数: 52, 52, 60×8 （合計 584 手。棒銀 2 局が終局、他 8 局は採取上限）
```

例外後の継続は、局ごとの `try/catch` が内側にあるため後続の局にも後続の戦法にも進み、`finally` の `engine?.terminate()` と `process.exit(failures > 0 ? 1 : 0)` は保たれている。`scripts/selfplay.test.ts` の `--all-styles` 試験（例外注入あり・なし）が、記録の順序、error 行数、result 行数、`init` 1 回、`terminate` 1 回を検査しており、実行して 7 件すべて通過した。

### 回帰試験が修正前の 0 終了を検出するか

**検出する。** 無効指定の 4 例はいずれも `expect(lifecycle.init).not.toHaveBeenCalled()` と `expect(readFileSync(out)).toBe('keep existing evidence\n')` を持つ。修正前は `findStyle(id) ?? STYLES[0]` で矢倉に読み替えたうえ、モジュール読み込み時点で `writeFileSync(OUT, '')` が走っていたので、**この 2 つはどちらも修正前に失敗する**。`exit(1)` の検査だけに頼っていないので、判定の位置が後ろへずれた場合も落ちる。

## 2. `npm run e2e:fullgame` — 確認できた

### 実行（成功）

`npm run build` の後、自分で実行した。

```
Product game: 10 plies … 70 plies
{"plies":73,"winner":"player","decisive":0,"endedByMate":true}
1 passed (58.9s) / real 1m1s / EXIT=0
```

Codex の 63 手とは異なる 73 手になった（読みの時間で棋譜が変わる）。**手動停止なしで終了**し、実行後に `http://localhost:5182` へ接続できないことを確認した（サーバーは停止している）。

保存された記録:

```
logs/fullgame/test-results/product-…/game/result.json  （plies 73, endedByMate true, winner player, games 1）
logs/fullgame/test-results/product-…/game/mate.png
logs/fullgame/test-results/product-…/game/result.png
```

### 実行（失敗）

`--timeout 8000` を渡して意図的に失敗させた。

```
1 failed / real 10.1s / EXIT=1
logs/fullgame/test-results/product-…/game/failure.json
logs/fullgame/test-results/product-…/game/failure.png
logs/fullgame/test-results/product-…/trace.zip
```

**失敗でも終了コード 1 で速やかに終わり、失敗時の棋譜・画像・トレースが残り、サーバーも停止した**（ポート解放を確認）。`globalSetup` が返す後始末関数で `server.close()` と `closeAllConnections()` を呼ぶ形なので、成功・失敗のどちらでも同じ経路を通る。Playwright と同じプロセスでサーバーを持つため、Windows の子プロセス停止に依存しない。

### 開発 API と注入がないこと

`runProductGame` は `page.goto(url)` の直後に `expect(await page.evaluate(() => '__ojiji' in window)).toBe(false)` を確かめてから、盤のマス・持ち駒・成り選択・カットインのボタンだけを操作する。相手の応手は画面の盤を読んで合法手と突き合わせ、`toHaveLength(1)` で一意に復元できることを検査している。**局面・棋譜・進捗の注入は無い。** `localStorage` は読み取りのみ。配信は `dist` を返す `createStaticServer` なので製品ビルドが対象で、`crossOriginIsolated` と「判定: エンジン」も確認している。

### 共有処理への移動で検査を弱めていないか

**弱めていない。** 旧 `scripts/product-playthrough.ts`（`edd8c6e` 時点）と新 `scripts/product-game.ts` の `expect(...)` を機械的に抽出して集合比較したところ、**削除も追加もゼロ**だった。差分は引数の受け取り方と関数化によるインデントだけで、純粋な切り出しになっている。旧 CLI は薄い呼び出しとして残っている。

### CI への登録と記録保存

`.github/workflows/ci.yml` で `npm run build`（20 行目）より後の 29〜31 行目に必須ステップとして入り、`timeout-minutes: 20`。直後の `upload-artifact` が `if: always() && steps.fullgame.outcome != 'skipped'` で `logs/fullgame` を保存するので、成功時も失敗時も記録が残る。自動対局の行も `--all-styles` 1 行になり、CI 側の戦法一覧は消えた。保存先の `logs/ci-*.jsonl` は `ci-all-styles.jsonl` に一致する。

## 新規指摘（欠陥）

### 不明なフラグを黙って無視するため、`--all-styles` の打ち間違いで CI が矢倉 1 戦法だけになる（low）

- **場所**: `scripts/selfplay.ts:167`（`process.argv.includes('--all-styles')`）、`.github/workflows/ci.yml:52`
- **再現**:
  ```bash
  npx vite-node scripts/selfplay.ts -- --all-style --games 1 --plies 0 --out logs/typo.jsonl
  echo $?   # → 0
  ```
  実行結果: **終了コード 0**、記録された戦法は `['yagura']` のみ、1 局だけ。`--all-styles` の末尾 `s` が欠けただけで、何も警告が出ない。
- **期待**: 知らないフラグを渡したら失敗する。CI の自動対局ステップが「5 戦法を試した」ことを、コマンド行の綴りに依存せずに保証する。
- **実際**: 未知のフラグは無視され、`--style` 未指定として既定の矢倉 1 戦法を回して成功する。CI はこのステップが全戦法を回した証拠を持たないまま緑になる。前回の指摘（不明な戦法 id が矢倉へ読み替わる）は値について直ったが、同じ失敗の形がフラグ名に残っている。
- **反証の試み**: (a)「未知のフラグを無視するのは CLI の慣例」——ここでは通らない。このステップの目的が網羅の保証であり、前回その保証が無いことを欠陥として直したばかりで、保証の根拠が単一のフラグ綴りに移っただけになっている。(b)「試験が守っているのでは」——`grep -rn "all-styles" src/ scripts/ .github/` の結果、フラグ名を検査する試験は無い。`scripts/selfplay.test.ts` は正しい綴りの `--all-styles` しか渡していない。(c)「CI 行は人が見る」——前回の `--style` 一覧も同じ条件で、それでも直した。
- **修正案**: 既知のフラグ一覧（`style`, `all-styles`, `games`, `plies`, `judgeMs`, `seed`, `start`, `out`）を持ち、`--` で始まる引数がそこに無ければ列挙して `process.exit(1)`。判定は今の戦法検査と同じ位置（ファイル作成とエンジン生成の前）に置く。`scripts/selfplay.test.ts` の無効指定の表に `['不明なフラグ', ['--all-style']]` を 1 行足せば回帰も止まる。

## 所見（欠陥ではない）

- **エラー文言**: `--all-styles --style yagura` に対して `Invalid --style: yagura` と出る。yagura は有効な id なので、指定そのものが無効に読める。末尾の「use --all-styles alone」で意図は伝わるが、併用のときは「`--all-styles` と `--style` は併用できない」と分けたほうが正確。
- **CI の時間設定**: `timeout-minutes: 20` と Playwright の `globalTimeout: 20 * 60_000` が同値。Playwright 側が先に切れないと、レポートとサーバー後始末の前に GitHub がステップを落とし、保存される記録が欠ける可能性がある。CI 側を 25 分にすれば確実に Playwright が先に切れる。
- **`--style` の重複指定**: `indexOf` が最初の 1 つしか見ないため、`--style yagura --style bogus` は yagura として通る。実害は小さい。
- **接続先の表記**: `globalSetup` は `127.0.0.1` で待ち受け、`baseURL` は `http://localhost:5182`。この環境と PWA 試験では問題なく動いており、Chromium は localhost を特別扱いするので実害は確認できていない。IPv6 を優先する環境で確かめる機会があれば見ておくとよい。
- **`決め手` は今回も 0 件**。私の実行（73 手）でも出ていない。

## 未確認（合格に数えていない）

- **CI は GitHub 上で一度も走っていない。** 今回追加したステップ、artifact の保存、`--all-styles` 行のいずれも、実際のワークフロー実行では確認されていない。
- APK・IPA の生成、実機、OS 中断復帰、人が遊んだ評価、昇級までの連勝。
- 公開先 URL・連絡先、対応ソースの提供、配布条件、署名、ストア提出物。
- `--all-styles` の実対局（60 手採取）は判定 80ms・Node 1 スレッドで、製品の 2 スレッドや実機の速度ではない。ログの `draw` は採取上限であってルール上の引き分けではない。
- 製品通し試験は 1 局のみ。角交換をしていない対局の否定分岐は、私の 73 手・Codex の 63 手いずれでも通っていない（前回 57 手の証跡と単体の回帰試験は残っている）。

## 今回の差分の評価

方向も作りも妥当。とくに次の 2 点は、前回までの積み上げと一貫している。

- **CI が別の戦法一覧を持たなくなった。** 一覧の二重管理はいずれずれるので、`STYLES` を直接回すのは正しい設計。
- **製品通し試験が純粋な切り出しで、検査を 1 つも失っていない。** 機械的に突き合わせて確認した。CI の必須ステップになり、成功・失敗どちらでも記録が残る。

残った穴は、網羅の保証が「コマンド行の綴り」という検査されない一点に集まっていることで、上の新規指摘がそれにあたる。これは前回の修正の延長で塞げる。

4 領域の評価は前回のまま、**指導 8・ゲーム 7・リリース 7・品質保証 7** とする。今回の差分は品質保証の作りを良くしたが、その領域の最大の残条件である「CI が一度も実行されていない」が動いていないため、点数は上げない。未確認を合格には数えていない。
