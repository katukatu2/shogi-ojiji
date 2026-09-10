# リリース手順書

Web → Android → iOS の順に検証する。今回の対象は iPhone App Store を含む。進捗は [査読記録](release-audit.md) を参照。各節は「コマンド」と「確かめること」で書く。掲載文は [docs/store/listing.md](store/listing.md)。

## 0. 共通（どの配信先でも最初にやる）

```bash
npm ci
npm run typecheck
npm test
npm run build            # dist/ に静的ファイル
npm run icons            # public/icon.svg を変えたときだけ。生成物は git に入れる
git status               # 生成物の差分が残っていないこと
```

- [ ] `package.json` の `version` と、Android の `android/app/build.gradle` の `versionCode`（毎回 +1）・`versionName` を上げた
- [ ] build が `dist/offline-assets.json` と同じ識別子の Service Worker、`dist/LICENSE.txt` を生成した
- [ ] タイトル画面のクレジット欄に、プライバシーポリシー（`privacy.html`）とソース公開先のリンクがある
- [ ] ソース公開先・連絡先・配信先のログ方針を確定し、`npm run release:check` が通った
- [ ] リリースするコミットにタグを打つ: `git tag v<versionName> && git push origin v<versionName>`

## 1. Web（静的配信）

### 1-1. ビルドと配信

```bash
npm run build
npx vite preview         # http://localhost:4173 で dist/ を確認（COOP/COEP 付き）
```

`dist/` をそのまま静的ホスティングに置く。エンジン（やねうら王 WASM）は SharedArrayBuffer を使うので、次のどちらかを選ぶ。

**A. 配信側で COOP/COEP ヘッダーを付ける（推奨。初回の再読み込みが要らない）**

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

| ホスティング | 設定の置き場 |
|---|---|
| Netlify / Cloudflare Pages | `dist/_headers` に `/*` の下へ上の 2 行（`public/_headers` に置けば build で `dist/` へ入る） |
| Vercel | `vercel.json` の `headers` |
| nginx | `add_header Cross-Origin-Opener-Policy same-origin always;` と `add_header Cross-Origin-Embedder-Policy require-corp always;` |
| Firebase Hosting | `firebase.json` の `hosting.headers` |

**B. ヘッダーを付けられない（GitHub Pages など）→ Service Worker に任せる**

`public/coi-serviceworker.js` が Service Worker 経由でヘッダーを付ける。設定は不要だが、初回だけ自動で再読み込みが一度入る。
サブディレクトリ配信（`https://example.com/ojiji/`）でも `base: './'` なので動く。

### 1-2. 確かめること

- [ ] 配信先を開き、DevTools のコンソールで `crossOriginIsolated` が `true`（A なら初回から、B なら再読み込み後）
- [ ] 画面右上に「判定: 簡易」が出ていない（出ていればエンジンが動いていない。ヘッダーか Service Worker を疑う）
- [ ] 一局指して、頷き・吹き出し・カットインが出る。駒音と雷の効果音が鳴る
- [ ] 2 回目の読み込みをオフライン（DevTools の Network を Offline）で開いてもタイトルが出る
- [ ] `https://<配信先>/privacy.html` が開ける。`manifest.webmanifest` と `icons/` が 200 で返る
- [ ] Chrome の Lighthouse（PWA / Installability）で、インストール可能と出る。Android Chrome で「ホーム画面に追加」した時のアイコンの角が欠けていない（maskable）
- [ ] iOS Safari で「ホーム画面に追加」した時のアイコンが黒い角無しで出る（`icons/apple-touch-icon-180.png`）

## 2. Android（Google Play）

### 2-1. 用意するもの

- JDK 21（Capacitor 8 は `sourceCompatibility JavaVersion.VERSION_21`。17 では `invalid source release: 21` で止まる）
- Android SDK（Android Studio か `sdkmanager`）。`platforms;android-36`、`build-tools;36.0.0`、`platform-tools`
- 手元に無ければ、GitHub Actions の `Android` ワークフロー（`.github/workflows/android.yml`。main への push と手動実行）で debug APK を作り、Artifacts から落とせる

### 2-2. debug APK（動作確認用）

```bash
npm run build
npx cap sync android                      # dist/ を android/app/src/main/assets/public へ
cd android
chmod +x gradlew                          # git 上では実行ビットが無い
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- [ ] 実機で起動し、「判定: 簡易」が出ていない（Android WebView は Service Worker 経由の COOP/COEP で動く想定）
- [ ] 戻るキー: 設定→タイトル、対局中→確認してからタイトル、結果→タイトル
- [ ] ホーム画面のアイコン（adaptive icon）で、顔が切れず、丸・角丸どちらの形でも角が欠けない
- [ ] 機内モードでも起動して対局できる
- [ ] 縦画面固定（`manifest` の `orientation` と `AndroidManifest.xml`）で、小さい端末（360×640）でも持ち駒とボタンが画面内にある

### 2-3. 署名（アップロード鍵）

鍵はリポジトリの外に安全に保管する。`android/.gitignore` は `*.jks`・`*.keystore`・`keystore.properties` を除外済み。

```bash
keytool -genkeypair -v -keystore ~/keys/ojiji-upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

`android/keystore.properties`（git 管理外）:

```properties
storeFile=/Users/<you>/keys/ojiji-upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

`android/app/build.gradle` に署名設定を足す（`android {}` の中）:

```groovy
def keystoreProps = new Properties()
def keystoreFile = rootProject.file('keystore.properties')
if (keystoreFile.exists()) keystoreProps.load(new FileInputStream(keystoreFile))

signingConfigs {
    release {
        if (keystoreFile.exists()) {
            storeFile file(keystoreProps['storeFile'])
            storePassword keystoreProps['storePassword']
            keyAlias keystoreProps['keyAlias']
            keyPassword keystoreProps['keyPassword']
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

```bash
cd android
./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

- [ ] `versionCode` を前回より大きくした（Play は同じ値を受け付けない）
- [ ] 鍵とパスワードをバックアップした（失うと同じアプリを更新できない。Play アプリ署名を使えばアップロード鍵は再発行できる）

### 2-4. Play Console

- [ ] アプリを作成（アプリ名・デフォルトの言語 日本語・「ゲーム」・無料）
- [ ] 「アプリのコンテンツ」: 公開済みプライバシーポリシー URL、広告、データセーフティ、年齢質問票、対象ユーザーを実際のアプリ・配信先に沿って申告した。年齢・対象ユーザーを未確認のまま固定しない
- [ ] 「ストアの掲載情報」: [listing.md](store/listing.md) のアプリ名・短い説明・詳しい説明、アイコン `public/icons/icon-512-square.png`、フィーチャーグラフィック 1024×500、スクリーンショット 5 枚
- [ ] 「Play アプリ署名」を有効にし、`app-release.aab` を内部テストにアップロード
- [ ] 内部テストの端末で 2-2 の項目をもう一度確認してから、製品版へ昇格

### 2-5. GPL のソース公開

やねうら王（GPLv3）を組み込んでいるため、配布するビルドと同じソースを公開する義務がある。

- [ ] ソース公開先（`docs/store/listing.md` の「GPL に基づくソース公開先」）が公開状態で、`LICENSE`（GPLv3 全文）を含む
- [ ] 配布した `versionName` と同じタグがあり、そのコミットから `npm run build` で同じ `dist/` が作れる
- [ ] ストアの説明文とアプリのタイトル画面から公開先へリンクしている
- [ ] やねうら王・水匠 Petite・駒音のクレジットが説明文とタイトル画面にある

## 3. iOS（App Store）

今回から iPhone App Store 版も対象。プロジェクトの追加は済んでいるが、Mac ビルド・実機検証・配布条件の確認は未完了。

### 3-1. 用意するもの

- macOS と Xcode 26 以降。Capacitor v8 の [公式要件](https://capacitorjs.com/docs/ios)を参照する。
- Apple Developer Program と対象の iPhone。署名用 Team はユーザーのアカウントで設定する。
- このプロジェクトは Swift Package Manager を使用する。CocoaPods はこの構成では不要。

### 3-2. 生成済みのプロジェクトを開く

```bash
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

`npx cap add ios` は実行済みで、繰り返さない。`ios/App/App.xcodeproj` を開く。
`.github/workflows/ios.yml` は署名なしシミュレータビルドを用意しているが、リモート未設定のためまだ実行していない。

- [ ] Xcode で Team を設定し、Bundle Identifier が `jp.sonot.shogiojiji` と一致する
- [ ] 生成済みの 1024px AppIcon と起動画面が実際に表示され、Capacitor の既定ロゴが残っていない
- [ ] 表示名が「将棋オジジの定石指南」、対象が iPhone、縦画面である
- [ ] アーカイブした SDK の Privacy Report と必要な Privacy Manifest・利用理由を確認した

### 3-3. エンジンを実機で確認する

iOS は `capacitor://localhost` からローカル素材を読む。`https` は WKWebView の予約スキームなので、Capacitor のローカル配信に指定しない。
Web の Service Worker で成功した結果を、そのままネイティブアプリの成功とは見なさない。

1. Xcode でシミュレータと iPhone 実機を起動する。
2. Safari の Web インスペクタで以下の値と、エンジンの起動エラーを記録する。

   ```js
   crossOriginIsolated
   typeof SharedArrayBuffer
   navigator.serviceWorker?.controller
   ```

3. 画面に「判定: エンジン」と出ること、実際にヒント・悪手判定・応手が動くことを確認する。

- [ ] エンジンが起動する。単に crossOriginIsolated が true であるだけでは合格にしない
- [ ] 起動できない場合、簡易判定の制限を確認して対応方針を決める。ヘッダーを追加するだけで解決するとは断定しない
- [ ] 同じエンジンのネイティブ連携や単一スレッド化を検討する場合、固定エンジン・評価関数の条件とライセンスを守る
- [ ] 本格判定が使えない端末に、ストア説明で同等の指導機能を保証しない

### 3-4. 操作と保存

- [ ] 駒音と雷が初回のタップ後に鳴る。声は出ず、雷の設定音量は 10%
- [ ] ノッチ・ホームバー・文字拡大の状態でも盤と操作ボタンが使える
- [ ] アプリ切り替え、バックグラウンド復帰、再起動後の成績保存を確認した
- [ ] 機内モードで起動して対局できる
- [ ] 投了・再戦・指し直し・成り・持ち駒・ヒント・待ったが使える

### 3-5. 配信

```bash
npm run build
npx cap sync ios
# Xcode: Product > Archive → Distribute App → App Store Connect
```

- [ ] TestFlight で署名済みビルドを検証した
- [ ] App Store Connect のプライバシーと年齢質問票を実態に合わせて回答した
- [ ] 対象 iPhone で撮り直した画像を、[Apple の寸法要件](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)に合わせて用意した。Web の 1080×1920 原案は提出用の iPhone 実機画像ではない
- [ ] GPL に沿う対応ソース一式の提供方法と、App Store の配布条件との整合を確認した。プロジェクトを生成しただけではこの確認は完了しない
- [ ] 公開先・連絡先・サポート URL を確定し、リリースする版の案内と一致している
