# Claude 限定査読の記録

日付: 2026-09-10 / 査読者: Claude（実装ファイルは編集していない）
対象: `a9bf6fd`（引き継ぎ時点）から `e0b2b69` までの差分と、関連する既存コード。
方法: 依頼の 5 観点を並列に査読し、**各指摘を別の査読者が反証してから確定**した。反証で落ちた指摘（3 件）と、既知事項に該当した指摘は下の一覧に含めていない。

## 結論

**リリースを止める新規の問題が 1 件ある。** iOS の AppIcon に α チャネルが残っており、App Store Connect のアップロード検証（ITMS-90717）で弾かれる。Web と Android は止まらない。

このほか、新規の欠陥が **18 件**（重大 3・中 9・軽 6）確定した。以下に上位 5 件を詳述し、残る 13 件を一覧にする。

---

## 新規指摘（詳細・重要度順）

### 1. iOS の AppIcon に α チャネルが残り、App Store の検証で弾かれる（blocker）

- **場所**: `scripts/build-icons.mjs:49`（生成物 `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`）
- **再現**:
  ```bash
  node -e "const b=require('fs').readFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');console.log('colorType',b[25])"
  # → 6（RGBA）
  mkdir -p /tmp/tpl && tar -xzf node_modules/@capacitor/cli/assets/ios-spm-template.tar.gz -C /tmp/tpl
  node -e "const b=require('fs').readFileSync('/tmp/tpl/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');console.log('colorType',b[25])"
  # → 2（RGB。Capacitor の雛形は α なし）
  ```
- **期待**: 1024px の AppIcon は α チャネルを持たない PNG（IHDR colorType=2）。Apple はアプリアイコンの α チャネル・透過を認めない。
- **実際**: `@resvg/resvg-js` の `asPng()` をそのまま書き出すため colorType=6。全画素が α=255 でも α チャネル自体が残るので検証で弾かれる。`src/icons.test.ts:86-91` は「透明な画素が無い」ことしか見ておらず検出できない。`check-release.mjs` にも検査が無い。
- **修正案**: iOS の `AppIcon-512@2x.png` だけを RGB に詰め直して colorType=2 で書き出す（全画素 α=255 なので合成は不要）。`public/icons/*` と Splash は対象外なので触らない。検査は「レンダラの出力」ではなく **git に入っている実ファイル**に対して掛ける（`src/icons.test.ts` の実ファイルを読む項に IHDR バイト 25 が 2 であることを 1 行足す）。`scripts/check-release.mjs` にも同じ検査を入れれば macOS 無しで防げる。`docs/release-checklist.md` の 3-2 に確認項目を追記。

### 2. オフライン保存が 1 件でも失敗すると Service Worker ごと消え、エンジンが無言で簡易 AI に落ちる（high・後退）

- **場所**: `public/coi-serviceworker.js:39-47`（41・43・46 の 3 か所が throw しうる）
- **再現**:
  ```bash
  npm run build
  # dist/icons/icon-512-square.png を 1 つ削除（配信漏れ・転送失敗を模す）
  # あるいは dist/offline-assets.json の version を 1 文字書き換え（CDN に旧 manifest が残る配信を模す）
  node scripts/serve-static.mjs 5180
  ```
  まっさらなプロファイルの Chrome で `http://localhost:5180/` を開き 10 秒待つ。DevTools で `await navigator.serviceWorker.getRegistration()` → `null`、`crossOriginIsolated` → `false`。対局を始めると上部が「判定: エンジン」ではなく「判定: 簡易」。**console にエラーも警告も 1 件も出ない。**
- **期待**: 保存の失敗は保存機能だけの失敗に留まり、SW のもう一つの役目である COOP/COEP 付与は生き残る。オンラインならやねうら王が動く。
- **実際**: `install` の `waitUntil` が throw するため登録ごと破棄され、SW が 1 つも残らない。`SharedArrayBuffer` が使えず、オンラインでも無言で簡易 AI に落ちる。再読み込みしても同じ失敗を繰り返すので自己回復しない。`a9bf6fd` の install は `skipWaiting()` だけでこの失敗経路が存在せず、**今回の差分で入った後退**。影響は既存の active worker が無い初回訪問（新規ユーザー全員）に限られるが、そこでは恒久的に簡易 AI のままになる。
- **修正案**:
  1. install の保存処理を try/catch で包み、失敗しても install は成功させる。`cache.addAll` は 1 件でも失敗すると全体が reject するので `Promise.allSettled` で 1 件ずつ `cache.add` し、失敗したパスを `console.warn` に出す。
  2. 「全部揃った版だけ採用する」という元の意図は install の成否ではなく別の印で表す。全件成功したときだけ完了マーカーを `cache.put` し、オフライン時のナビゲーション代替はマーカーがある版でだけ使う（部分キャッシュを完全な旧版と誤認させない）。
  3. 未完了ならページ側から `postMessage` で再挑戦し、オンラインに戻ったときに揃える。
  4. `scripts/check-release.mjs` に「`dist/offline-assets.json` の全 assets が dist に実在する」「SW の VERSION が manifest の version と一致する」の検査を足す（ローカルの取りこぼしは防げるが CDN 起因は防げないので 1・2 が本体）。
  5. `src/sw.test.ts` に「manifest 取得失敗・版不一致・addAll 失敗のいずれでも install が reject しない」を追加する。

### 3. 守られた駒の取りを一方的な「駒を取られる」と説明し、無関係な正解手に「タダでは取られん」を帰属する（high）

- **場所**: `src/style/judge.ts:509`（hangs の判定）、`:517`（consequence の文）、`:540`・`:653`（rescueText）
- **再現**:
  ```bash
  npm run selfplay -- --style yagura --games 8 --plies 100 --seed 7 --out logs/rev2.jsonl
  ```
  `logs/rev2.jsonl` の game 6 / ply 11。復元した局面は `lnsgkgsnl/1r5b1/2pppp1pp/p5p2/7P1/1pP6/PP1PPPPSP/1B5R1/LNSGKG1NL b - 11`（8八の角は 7九銀と 2八飛の二枚で守られている）。seed 1 の game 1 / ply 35 でも同種が出る。
- **期待**: 守られた地点への取りは駒損ではなく交換。`judge.ts:517` には既に `tradeName` による「交換になる」の分岐があり、`style.test.ts:973-989` が「角銀交換であって銀を取られるではない」を守っている。
- **実際**: 「その手は△８八角成と角を取られる。形勢がはっきり悪くなる。▲８六歩なら角はタダでは取られん。」と出る。seed 1 の例では「△２八馬と銀を取られる」と言うが、実際は馬で銀を取らせて同玉と取り返す先手有利の交換で、しかも 2八銀の守りは ▲８六歩 と無関係。**評価値の下落自体は正しく、下落の理由だけが嘘になる。** 自動対局 30 verdict 中 2 件が明確な誤り、1 件が同種の疑い。
- **修正案**:
  - `judge.ts:509` の hangs に 1 手 SEE を入れる。threat を適用した盤で `pos.isAttacked(threat.to.x, threat.to.y, 0)` を見て `see = PIECE_VALUE[victim] − PIECE_VALUE[threat.piece]` を出す。ただし hangs を単に null に落とすと consequence が空になり台詞が薄くなるので、`see <= 0` かつ同種なら `tradeName` で「角の交換になる」、`see < 0` なら駒損の話をやめて「踏み込まれて攻めが続く」型にし、`see > 0` のときだけ従来どおり「○○を取られる」と言う。
  - `rescueText`（`judge.ts:650-655`）は `savesFromCapture`（正解後に何も宙に浮いていない）しか見ていないため、もともと浮いていない場合に真になって空振りする。呼び出し側（`:540`）で、指す前の `bestCaptureGain(pos, 1).gain >= HANG_THRESHOLD` のときだけ呼ぶようガードする。

### 4. 対局後の教訓が固定文になり、戦法別の助言 25 行が到達不能になった（medium・申告と実物の食い違い）

- **場所**: `src/ui/results.ts:93-94`（closingWord の末尾）、`src/style/{yagura,bougin,nakabisha,shikenbisha,kakugawari}.ts` の `lessons`、`src/style/style.test.ts:730`
- **再現**:
  ```bash
  git show a9bf6fd:src/main.ts | sed -n '1401,1412p'
  sed -n '84,95p' src/ui/results.ts
  grep -rn "lessons" src/ --include=*.ts
  ```
  読み出す側が 1 つも無く、定義（5 戦法）・`types.ts:37`・`style.test.ts:730` だけが残る。
- **期待**: `docs/release-audit.md` は「実際には銀が出ていない対局に『銀が前に出た』と無作為に表示する問題を修正」と書いている。実際に対局と食い違うのは `bougin.ts:109` のような条件付きの 1 行だけで、残り（例 `bougin.ts:107`「棒銀は銀を追い返せば攻めが切れる。歩で銀の頭を叩け。」）は選んだ戦法に対して常に成り立つ助言。
- **実際**: 25 行がまるごと呼ばれなくなり、負け・投了で悪手が 1 つ以上あり `scolded < 3` の対局は、戦法にも内容にも関係なく必ず「次の一局は、指す前に相手の狙いと玉の安全を確かめるのじゃ。」の 1 文になる。エンジンが無い環境では keyMoments も空を返すので、結果画面の指導がこの 1 文だけになる。`style.test.ts:730` が `lessons.length > 2` を検証し続けているため、画面から消えたことをテストが検知できない。
- **修正案**: 最小の修正は全削除ではなく**条件付き 1 行の分離**。`bougin.ts:109` のような対局内容に依存する行だけを別フィールドに切り出し、残る 22 行は戦法別の締めの言葉として使う。使わないと決めるなら中途半端に残さず `types.ts:37` と 5 戦法の定義から削除し、`style.test.ts:730` の検証も外す（画面に出ないデータをテストで固定しない）。あわせて `docs/release-audit.md:23` の記述を実際の変更に合わせて訂正すること。**申告と実物の食い違いは次の査読で同じ検証コストを再発生させる。**

### 5. リロード後、タイトル画面で「戻る」の 1 回目が握りつぶされる（medium）

- **場所**: `src/ui/navigation.ts:32-33`（onPop が古い読み込みの ojiji 値を自分のものとして受け取る）、`src/main.ts:171`（`if (screen === 'title') goToScreen('title')` で押し戻す）
- **再現**: `http://localhost:5179/` を開き「前回の設定で始める」で対局画面へ（`history.state.ojiji = 2`）。そのままページをリロード。アプリはタイトルで再開し現在のエントリは `ojiji = 0` になるが、手前に残った `ojiji:0` / `ojiji:1` はそのまま。ブラウザまたは Android の「戻る」を 1 回押す。Chromium 実測で、url・画面・ojiji のすべてが変化しない。2 回目で初めてアプリを離れる。
- **期待**: タイトルで「戻る」を 1 回押したら、その 1 回でアプリを離れる（Android なら終了）。
- **実際**: 1 回目は popstate で古いエントリを拾い、`onBack('title')` → `goToScreen('title')` → `history.go(-1)` で押し戻すため、見た目上まったく動かない。ユーザーには「戻るが効かない」と見える。設定画面でリロードした場合も同様。
- **修正案**: 古い履歴段を読み込み時に畳む。`sid` で無視するだけでは症状は変わらない（同一 URL のエントリへ戻っただけで離脱しないため）。`navigation.ts` の constructor を、`replaceState` より**前**に古い値を読む順序にする。
  ```ts
  constructor(private onBack: (screen: ScreenName) => void) {
    const stale = history.state?.ojiji;
    history.replaceState({ ...history.state, ojiji: 0 }, '');
    window.addEventListener('popstate', this.onPop);
    if (Number.isInteger(stale) && stale > 0 && stale <= 2) {
      this.moving = true;   // 畳んだときに届く popstate は onBack を呼ばずに捨てる
      history.go(-stale);
    }
  }
  ```
  `moving` を立てるのが要点で、これがないと畳んだ直後の popstate が `onBack('title')` を呼んで余計な整合処理が走る。

---

## その他の確認済み新規指摘（13 件）

いずれも反証を通過している。上位 5 件を直した後に着手する想定。

| # | 重要度 | 指摘 | 場所 |
|---|---|---|---|
| 6 | medium | `src/sw.test.ts` は開発時分岐しか通らず、出荷する分岐（install・HTML/JS のキャッシュ優先・206）を 1 つも検証していない | `src/sw.test.ts:9`, `:61-68` |
| 7 | medium | `navigation.spec.ts` の「設定から戻った直後に開き直しても…」が実際には何も操作しておらず空振りで通っている | `tests/e2e/navigation.spec.ts:34-38`（実ラベルは `src/ui/settings.ts:31`） |
| 8 | medium | 「今日の 3 手」の拡大表示を開いたまま戻ると確認なくタイトルへ飛び、その対局の振り返り・免状・昇級の告知が二度と見られない | `src/main.ts:163-169`, `src/ui/review.ts:60-61` |
| 9 | medium | `SHALLOW_DEPTH`(14) が既定の探索時間 400ms に届かず、中盤の判定にほぼ毎回「（読み N 手・目安）」が付く | `src/style/judge.ts:77`, `:101`, `:146` |
| 10 | medium | iOS の版番号が公開手順にも自動検査にも無く、package.json・Android・iOS の 3 者が食い違っている | `docs/release-checklist.md:16`, `ios/App/App.xcodeproj/project.pbxproj:303,310,325,332` |
| 11 | medium | 「しかもその手は△○○と…」の文が読めない（指示語が直前の正解手を指す／駒名の「と」と助詞の「と」が続いて壊れる） | `src/style/judge.ts:517`, `:537` |
| 12 | medium | 相手の応手の打ち駒だけ常に「打」が付き、`734ff55` の棋譜表記合わせが漏れている | `src/style/judge.ts:483`, `:590`, `:606-607` |
| 13 | low | 更新のたびに全資源を再取得し、タブを開いたままだと旧版キャッシュが版ごとに積み上がる（1 版あたり約 2MB） | `public/coi-serviceworker.js:46`, `:50-57` |
| 14 | low | 旧名 `ojiji-v4` のキャッシュが新しい activate で消えず、約 2MB が残り続ける | `public/coi-serviceworker.js:54` |
| 15 | low | 前の対局の吹き出しタイマーが画面をまたいで生き残り、次の対局の台詞を 1 つ握りつぶす | `src/main.ts:932-937`, `:179-189`, `:196-208` |
| 16 | low | 実エンジンの試験が本体の探索条件（`go movetime`・Threads=2）に一つも当たらなくなり、初期局面の depth の assert も自明化している | `src/ai/engine.test.ts:13`, `:20-23` |
| 17 | low | 改名時に直すファイルの一覧に iOS の `Info.plist` が無く、iPhone だけ旧名が残る恐れ | `docs/store/listing.md:10`, `ios/App/App/Info.plist:9-10` |
| 18 | low | E2E の結果画面 3 件が DEV 専用フックと手書きの記録に依存し、実際に終局まで指して結果・振り返りに至る経路を一つも通していない | `tests/e2e/results.spec.ts:5-10`, `:15-16`, `:49-53` |

### 反証で落ちた指摘（記録のみ・対応不要）

- やねうら王のバージョンが package.json で固定されていない、という指摘 → `engine-provenance.json` の記録と実ファイルは整合していた。
- SW の VERSION 埋め込みが未検証の文字列置換、という指摘 → 失敗すれば後段で検出される作りになっていた。
- iOS の AppIcon 以外の α チャネル（Splash など）→ ストア検証の対象外。

---

## 依頼された 5 観点への回答

**1. オフライン保存**: 初回保存に穴がある（指摘 2）。音声の Range は 206 と Content-Range を正しく作れており、`bytes=N-` / `bytes=N-M` / `bytes=-N` の 3 書式と 416 を確認して問題なし。他アプリの保存を壊す経路は無い（キャッシュ名に接頭辞があり、サブフォルダ配信のスコープも正しい）。ただし旧名 `ojiji-v4` だけが消え残る（指摘 14）。更新時の版の混在は、`skipWaiting` をやめた設計により**混ざらない**。代わりに旧版が版ごとに積み上がる（指摘 13）。

**2. 画面遷移と非同期**: 戻る操作にリロード後の取りこぼしがある（指摘 5）。再戦・昇級で状態が壊れる経路は見つからなかった。非同期の応手は、対局が変わった場合に捨てる処理が実際に入っており申告どおり。二重着手も再現しなかった。拡大表示を開いたままの戻る（指摘 8）と吹き出しタイマーの持ち越し（指摘 15）が残る。

**3. エンジン試験が不具合を隠していないか**: **隠していない。** 修正した SFEN は盤を復元して正しいことを確認した（修正前は飛車で角を取り返せない誤った配置）。一手詰めの検証も実際の詰み局面で mate 値の符号と手数を見ており妥当。固定深さへの変更は、不安定さの原因（時間で揺れる読み）を排する正しい方向。assert を弱めた箇所も無い。ただし副作用が 2 つある。本体が使う条件（`go movetime` 400ms・2 スレッド）に当たる試験が 1 つも無くなったこと（指摘 16）と、その結果 `SHALLOW_DEPTH` と実際の到達深さの食い違いを誰も検出できなくなったこと（指摘 9）。

**4. iOS と公開資料**: 簡易判定を本格判定と同等に扱う記載は**見つからなかった**。`docs/release-audit.md` は「Web で動いたことや簡易 AI が動いたことを同等機能の証拠にしない」と明記しており、記述の姿勢は適切。未検証を完了として書いた箇所も無い。仮の URL やメールアドレスの混入も無い。名称は統一されている。新規の問題はアイコンの α チャネル（指摘 1）と版番号の不整合（指摘 10）、改名手順の漏れ（指摘 17）。

**5. 指導とゲーム完成度**: 引き継ぎ前に入れた修正は Codex の差分で壊れていない。ただし説明文の欠陥が残っており（指摘 3・11・12）、Codex が直したという教訓の修正は機能を殺す形になっている（指摘 4）。詳細は次節。

---

## 4 領域の再評価

未検証を合格として数えていない。

| 領域 | 点 | 根拠 | 未検証の範囲 |
|---|---|---|---|
| 指導の信頼性 | 6 | 5 段階の判定・決め手の条件・最善手の除外は試験で守られている。一方、自動対局 30 verdict のうち 2 件が盤面と食い違う説明で 1 件が同種の疑い（指摘 3）。読めない文（指摘 11）、打の表記漏れ（指摘 12）、教訓の固定文化（指摘 4）が残る | 矢倉以外の 4 戦法の台詞は今回採取していない。「決め手」が実対局で出るところを見ていない（自動対局はプレイヤー全敗）。簡易判定での結果画面を開いていない |
| ゲーム完成度 | 6 | 戻る・投了・再戦・成り・不成・持ち駒・ヒント・待った・昇級・免状・振り返りが自動確認されている。一方、戻るの取りこぼし（指摘 5）、拡大表示からの離脱で告知が消える（指摘 8）、台詞の握りつぶし（指摘 15） | Android・iPhone の実機と WebView での戻る操作。人が実際に遊んだときの結果画面 |
| リリース準備 | 4 | iOS 雛形・オフライン対局・ライセンス同梱・掲載原案・ビルド手順が揃った。一方、App Store の検証で確実に弾かれるアイコン（指摘 1）、初回保存の後退（指摘 2）、版番号の不整合（指摘 10）が公開前に必ず要る修正 | ネイティブビルド、実機、署名、CI の実行。これらは既知事項 |
| 品質保証 | 5 | 単体 273 件・操作 34 件・PWA 4 件・CI 拡充は数として揃っている。一方、**試験が守っているつもりの範囲と実際に守っている範囲がずれている**。出荷する SW の分岐は無試験（指摘 6）、空振りで通る操作試験（指摘 7）、DEV フックと手書き記録に依存する結果画面試験（指摘 18）、本体条件に当たらないエンジン試験（指摘 16） | CI の実行結果。WebKit の異常終了の切り分け。複数版間の PWA 更新 |

いずれも 8 点に届かない。**品質保証が最も低い**のは、件数が揃っている一方で、今回見つかった 18 件のうち 5 件が「試験があるのに検出できていない」類だったため。試験の網を直さないと、同じ種類の後退が次も素通りする。

---

## 既知事項（新発見と混ぜていない）

以下は Codex が `docs/release-audit.md` に記載済みで、今回の指摘には含めていない。

- 公開先 URL・連絡先・ホスティングが未定。Git remote も未設定。
- ネイティブ成果物（APK・IPA）が未検証。JDK・Android SDK・Xcode がこの環境に無い。CI も未実行。
- iOS の本格判定（capacitor スキームの WKWebView で SharedArrayBuffer とやねうら王が動くか）が未検証。
- GPL に沿う対応ソースの提供と App Store の配布条件の整合が確認待ち。
- 実機検証・署名・年齢質問票・Privacy Report・実機スクリーンショットが未了。
- Windows 版 Playwright の WebKit は iPhone Safari やネイティブ WKWebView の実機試験ではない。
- 一括 E2E で WebKit が予期せず閉じる事象の原因が未解明。

## 査読の範囲と限界

- Chromium（Windows）でのみ実測した。WebKit と実機は見ていない。
- 自動対局は矢倉のみ 11 局、精読した verdict は 30 件。
- テストの再実行は疑いのある対象に限定した（`src/ai/engine.test.ts`、`src/sw.test.ts`、`src/release.test.ts`、`tests/e2e/navigation.spec.ts`）。全体の 273 件は再実行していない。
- 実装ファイルは 1 つも編集していない。このファイルだけを追加した。
