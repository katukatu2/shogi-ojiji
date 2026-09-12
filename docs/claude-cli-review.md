# Claude 限定確認の記録（フラグ検査）

日付: 2026-09-11 / 査読者: Claude（実装ファイルは編集していない。追加したのはこのファイルだけ）
対象: `b0b3925` からの**未コミットの作業差分**と、未追跡で追加された文書。
関連: [codex-ci-gate-response.md](codex-ci-gate-response.md)、前回の指摘 [claude-ci-gate-review.md](claude-ci-gate-review.md)（未変更）。
依頼どおり、指導内容全体と通し処理の切り出しは再査読していない。

対象とした作業差分（`git status` で確認）:

```
M .github/workflows/ci.yml  M README.md  M docs/handoff.md  M docs/release-audit.md
M playwright.fullgame.config.ts  M scripts/selfplay.test.ts  M scripts/selfplay.ts
?? docs/claude-ci-gate-review.md  ?? docs/claude-cli-review-request.md  ?? docs/codex-ci-gate-response.md
```

## 結論

**前回の指摘 1 件は解消した。** 不明なフラグは終了コード 1 で拒否され、エンジンは起動せず、既存ログも残る。既知フラグ・区切り `--`・全戦法処理・例外後の継続はいずれも壊れていない。重複と併用の診断も期待どおり。

**新規欠陥が 1 件ある（低）。** フラグ *名* は検査するようになったが、回数を表す *値* は検査しない。`--games abc` を渡すと**何も実行せずに終了コード 1 を返さず、空のログを残して成功する**。今回塞いだ穴の最後の一つが、値の側に残っている。

## 確認できたこと

### 不明なフラグ・重複・併用の拒否

実プロセスで 5 通りを実行した。いずれも**終了コード 1**、**既存ログは保持**、診断も正確。

| 指定 | 終了コード | 既存ログ | 標準エラーの 1 行目 |
|---|---|---|---|
| `--all-style` | 1 | 保持 | `Unknown option: --all-style.` |
| `--styel yagura` | 1 | 保持 | `Unknown option: --styel.` |
| `--all-styles=false` | 1 | 保持 | `Unknown option: --all-styles=false.` |
| `--style yagura --style bogus` | 1 | 保持 | `Option specified more than once: --style.` |
| `--all-styles --style yagura` | 1 | 保持 | `Cannot combine --all-styles and --style.` |

併用の文言が直り、有効な `yagura` を「Invalid」と呼ばなくなった。2 行目に使用できるフラグ 8 つと戦法 5 つを列挙する。

### エンジン未起動とログ非破壊の順序

`--out` に**存在しないパス**を指定して `--all-style` で拒否させたところ、**ファイルは作られなかった**。判定が `mkdirSync` / `writeFileSync` より前にあり、エンジン生成はさらに後なので、拒否時にエンジンは起動しない。単体試験も `expect(lifecycle.init).not.toHaveBeenCalled()` で同じことを見ている。

### 既知フラグ・区切り `--`・全戦法処理

使用できる 8 つのフラグをすべて同時に渡した実行が通り、全戦法を処理した。

```
--all-styles --games 2 --plies 2 --judgeMs 80 --seed 5 --start 0 --out …
exit=0 / result 行: yagura 2, shikenbisha 2, kakugawari 2, bougin 2, nakabisha 2 / error 0 / style 欄なし 0
```

CI と同じ `npm run selfplay -- …` の形でも確認した。全戦法 5 局で終了コード 0、`--all-style` の打ち間違いでは終了コード 1。npm と vite-node が残す区切りの `--` はフラグ名として扱われず、正常系を妨げていない（`value !== '--'` の除外が効いている）。

### 例外後の継続

`scripts/selfplay.test.ts` の CLI 試験 **11 件すべて成功**。`--all-styles` の例外注入あり・なしの 2 件が、記録の順序、error 行数、result 行数、`init` 1 回、`terminate` 1 回を検査しており、途中の例外があっても後続の局と戦法に進むことと終了処理が保たれることを守っている。全体の単体試験は **19 ファイル 335 件成功**、型チェックも通った。

### 回帰 4 ケースが修正前に失敗するか

**失敗する。** 4 ケースはいずれも `exit(1)` に加えて「エンジンが起動していないこと」と「既存ログが `keep existing evidence` のまま残ること」を検査している。修正前は、

- `--all-style` / `--styel` / `--all-styles=false` → どれも `--style` 未指定として既定の矢倉に落ち、
- `--style yagura --style bogus` → `indexOf` が最初の `yagura` を拾い、

いずれも実行に進むので、モジュール読み込み時点の `writeFileSync(OUT, '')` で**既存ログが消え**、`engine.init()` も**呼ばれ**、終了コードは 0 になる。3 つの検査すべてが落ちるので、判定の位置が後ろへずれた場合も検出できる。

### CI の終了猶予と通し試験の接続先

`ci.yml` は `timeout-minutes: 25`、Playwright の `globalTimeout` は 20 分。Playwright が先に切れてレポートと後始末を終えられる。`playwright.fullgame.config.ts` の `baseURL` は `http://127.0.0.1:5182` になり、`tests/fullgame/setup.mjs` の待ち受け（`127.0.0.1`）と一致した。

接続先を変えた後の `npm run e2e:fullgame` を自分で実行した。

```
{"plies":43,"winner":"player","decisive":0,"endedByMate":true}
1 passed (38.2s) / real 39s / EXIT=0
```

43 手で詰み、先手勝利、1 局 1 勝の保存まで通った（Codex の 79 手とは手数が違う。読みの時間で棋譜が変わるため）。

## 新規指摘（欠陥）

### 回数の値が数字でないと、何も実行せずに成功する（low）

- **場所**: `scripts/selfplay.ts:50-59`（`arg()` と `GAMES` / `MAX_PLIES` / `SEED` / `JUDGE_MS`）、`:196`（`for (let i = start; i < start + GAMES; i++)`）
- **再現**:
  ```bash
  npx vite-node scripts/selfplay.ts -- --all-styles --plies 2 --games abc --out logs/x.jsonl
  echo $?        # → 0
  wc -l logs/x.jsonl   # → 0（空）
  ```
  標準エラーには何も出ない。`--games 0` も同じく終了コード 0 で空のログになる。
- **期待**: 回数の値が数字でない、または 1 未満なら、フラグ名のときと同じ位置で終了コード 1 を返す。自動対局ステップが「少なくとも 1 局は走った」ことを保証する。
- **実際**: `Number('abc')` が NaN になり、`0 < NaN` が偽なのでループが 1 度も回らず、成功として終わる。CI はこの行を空のログのまま緑で通す。今回フラグ名について塞いだ「緑のまま網羅がゼロになる」形が、値の側に残っている。
- **反証の試み**: (a)「CI の値は固定のリテラルだから届かない」——前回直した `--all-styles` の綴りも同じ条件で、それでも欠陥として扱った。手で編集する一行に依存している点が同じ。(b)「`arg()` は値が無ければ既定値に落ちるので安全」——`--games`（値なし）は既定の 10 に落ちて動くので確かに無害。危ないのは**値があって数字でない**場合で、そこだけ既定値に落ちずに NaN が通る。(c)「空のログが artifact に残るので気づける」——気づけるのは後からで、ステップは失敗しない。
- **修正案**: フラグ名の判定と同じ場所で、`GAMES` / `MAX_PLIES` / `JUDGE_MS` / `SEED` / `start` が有限数であること、`GAMES >= 1` と `MAX_PLIES >= 1` を確かめ、満たさなければ値を添えて `process.exit(1)`。`scripts/selfplay.test.ts` の無効指定の表に `['回数が数字でない', ['--games', 'abc']]` を 1 行足せば回帰も止まる（既存の 3 つの検査がそのまま使える）。

## 所見（欠陥ではない）

- **`--out` の値が無いと既定のパスに書く**。`arg('out', 'logs/selfplay.jsonl')` が既定へ落ちるため、CI で `--out` の値を落とすと `logs/ci-*.jsonl` の glob から外れ、artifact に残らないまま成功する。上の修正案に `--out` の値の有無を加えておくと一緒に塞げる。
- **通し試験の手数が実行ごとに大きく振れる**。今回 43 手、前回私の実行 73 手、Codex 79 手。詰みまで到達することは確認できるが、どの局面を通ったかは毎回違う。回帰としての価値は「詰みまで完走する」ことに限られる。
- **PWA 側の接続先は `localhost` のまま**（5180 / 5181）。今回の依頼の対象外で、現に動いている。名前解決の差を無くす方針を揃えるなら、将来まとめて `127.0.0.1` にしてもよい。
- **`--all-styles` が内部で `findStyle('yagura')` に依存している**。`styleId` の既定が `'yagura'` なので、万一 `yagura` の id を変えると `--all-styles` 単体が「Invalid --style: yagura」で止まる。今は起きないが、id を変えるときに気づきにくい。

## 未確認（合格に数えていない）

- **GitHub 上の CI は今回も一度も実行されていない。** `timeout-minutes: 25` も `--all-styles` の行も、実際のワークフロー実行では確認していない。
- APK・IPA の生成、実機、OS 中断復帰、人が遊んだ評価、昇級までの連勝。
- 公開先 URL・連絡先、対応ソースの提供、配布条件、署名、ストア提出物。
- 「決め手」は今回の通し（43 手）でも 0 件。
- 今回の確認で走らせた自動対局は引数の受理と対象の確認が目的で、手数は 2 手など短い。台詞の網羅の証拠には数えていない。
- 変更が未コミットであること自体は確認した（HEAD は `b0b3925`）。Windows の書き込み拒否の原因は調べていない。

## 評価

**指導 8・ゲーム 7・リリース 7・品質保証 7 のまま据え置く。** 依頼のとおり、設定変更だけで引き上げていない。

今回の差分は、前回の指摘に対して過不足のない直し方になっている。フラグ名を列挙して未知のものを拒否し、判定の位置を既存の戦法検査と同じ場所に置き、回帰 4 ケースを先に失敗させてから直した手順も、これまでと一貫している。併用の文言・CI の猶予・接続先の 3 つの所見もそのまま反映されている。

据え置きの理由は 2 つ。品質保証の最大の残条件である「CI が GitHub 上で一度も走っていない」が動いていないこと、そして上の新規指摘のとおり、同じ family の穴が値の側に 1 つ残っていることである。

---

## 追記: 数値引数検証の確認（2026-09-12）

上の新規指摘（回数の値が数字でないと何も実行せずに成功する）について、`scripts/selfplay.ts` と `scripts/selfplay.test.ts` の修正を確認した。**指摘は解消した。**

### 実プロセスでの確認

`--out` に既存ログを持つファイルを指定して 7 通りを実行した。いずれも**終了コード 1**、**既存ログは保持**。

| 指定 | 終了コード | 診断 |
|---|---|---|
| `--games abc` | 1 | Invalid value for --games: abc. Must be an integer >= 1. |
| `--plies abc` | 1 | Invalid value for --plies: abc. Must be an integer >= 0. |
| `--judgeMs NaN` | 1 | Invalid value for --judgeMs: NaN. Must be an integer >= 1. |
| `--games 0` | 1 | Invalid value for --games: 0. Must be at least 1. |
| `--seed -1` | 1 | Invalid value for --seed: -1. Must be at least 0. |
| `--games 1.5` | 1 | Invalid value for --games: 1.5. Must be an integer >= 1. |
| `--start -2` | 1 | Invalid value for --start: -2. Must be at least 0. |

依頼された 3 件に加えて、範囲（0 と負値）と小数も拒否されることを確かめた。`--out` に**存在しないパス**を指定して `--games abc` で拒否させたところ**ファイルは作られず**、判定がファイル生成とエンジン起動より前にあることを実物で確認した。

### 既存の検査を壊していないこと

| 指定 | 終了コード | 診断 |
|---|---|---|
| `--all-style` | 1 | Unknown option: --all-style. |
| `--style yagura --style bogus` | 1 | Option specified more than once: --style. |
| `--all-styles --style yagura` | 1 | Cannot combine --all-styles and --style. |
| `--style bogus` | 1 | Invalid --style: bogus. |

正常系も確認した。既知 8 フラグを同時に渡した `--all-styles --games 2 --plies 2 --judgeMs 80 --seed 5 --start 0` が終了コード 0 で全 5 戦法 × 2 局を処理し、error 0 件。CI と同じ `npm run selfplay -- …` の形でも 5 戦法が走った。`--plies 0` は下限 0 なので今までどおり通る。

### 試験

単体 **19 ファイル 338 件成功**（前回 335 件から +3）、型チェック成功。追加された 3 件は `exit(1)`・`engine.init()` 未呼び出し・既存ログ保持を検査しており、修正前は `Number('abc')` が NaN になって 0 局のまま終了コード 0 になるため、**3 つの検査すべてが落ちる**。判定の位置が後ろへずれた場合も検出できる。

### 実装上の所見

- `numberProblems` はモジュール読み込み時に組み立てられ、判定は IIFE 内でフラグ名・重複・併用の後に置かれている。`vi.resetModules()` で毎回作り直されるため、試験間で状態が漏れない。
- 診断の優先順は「不明なフラグ → 重複 → 併用 → 数値 → 戦法 id」。`--style bogus --games abc` では数値側が先に出る。どちらも誤りなので実害はない。
- 値を省いた `--games`（末尾）は既定値 10 に落ちる挙動のままで、これは前回の所見どおり無害。`--out` の値を省くと既定パスに書く点も変わっていない。今回の指摘の対象外。

### 評価

**指導 8・ゲーム 7・リリース 7・品質保証 7 のまま据え置く。** CLI の検査は前回挙げた穴が塞がり、この範囲での残件は無い。据え置きの理由は、品質保証の最大の残条件である「CI が GitHub 上で一度も走っていない」が動いていないこと。APK・IPA、実機、OS 中断復帰、人の評価、昇級までの連勝、公開情報・対応ソース・署名も未確認のままで、合格には数えていない。
