# リリース手順書

Web → Android → iOS の順。各節は「コマンド」と「確かめること」で書く。掲載文は [docs/store/listing.md](store/listing.md)。

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
- [ ] 素材（エンジン・画像・音）を差し替えたなら `public/coi-serviceworker.js` のキャッシュ名 `ojiji-vN` を上げた
- [ ] タイトル画面のクレジット欄に、プライバシーポリシー（`privacy.html`）とソース公開先のリンクがある
- [ ] `public/privacy.html` と `docs/store/listing.md` の「（公開先 URL）」を実際の URL に置き換えた
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

鍵はリポジトリの外に置く（例: `~/keys/`）。`android/.gitignore` は `*.jks` を除外していないので、`android/` の中に置かない。

```bash
keytool -genkeypair -v -keystore ~/keys/ojiji-upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

`android/keystore.properties`（git 管理外。`android/.gitignore` に `keystore.properties` を足す）:

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
- [ ] 「アプリのコンテンツ」: プライバシーポリシー URL（`https://<配信先>/privacy.html`）、広告なし、データセーフティ（収集・共有なし）、コンテンツ レーティングの質問票（全項目なし → 全年齢）、対象ユーザー（13 歳以上）、政府アプリでない、ニュースアプリでない
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

GPL と App Store の相性問題（Apple の利用規約が GPL の再配布条件と衝突するとされる）があるため、Web と Android を先に出す。iOS は以下を確かめてから判断する。

### 3-1. 用意するもの

- macOS と Xcode（`xcode-select --install` で Command Line Tools も）、CocoaPods（`sudo gem install cocoapods` または `brew install cocoapods`）
- Apple Developer Program（TestFlight・App Store 配信に必要）

### 3-2. プロジェクトを作る

```bash
npm i -D @capacitor/ios                   # まだ入れていない（package.json は android だけ）
npx cap add ios                           # ios/ を生成。capacitor.config.ts の iosScheme は https
npm run cap:ios                           # build → sync ios → Xcode を開く
```

- [ ] Xcode で Signing & Capabilities の Team を選び、Bundle Identifier が `jp.sonot.shogiojiji`
- [ ] `ios/App/App/Assets.xcassets/AppIcon.appiconset` に 1024×1024 のアイコンを入れる（`public/icons/icon-512-square.png` と同じ描き方で 1024 を作る。`scripts/build-icons.mjs` の `listOutputs` に 1 行足せばよい）
- [ ] `Info.plist` の表示名（`CFBundleDisplayName`）が「将棋オジジの定石指南」

### 3-3. WKWebView で crossOriginIsolated が取れるか（エンジンが動くか）

iOS の WKWebView は、Capacitor が自前のスキームハンドラで `https://localhost` から配信する。この経路では Service Worker が登録できないことが多く、
`public/coi-serviceworker.js` による COOP/COEP の付与が効かない可能性が高い。次の手順で確かめる。

1. シミュレータか実機でアプリを起動する（Xcode の Run）。
2. Mac の Safari → 「開発」メニュー → シミュレータ／実機名 → 「将棋オジジの定石指南」の WebView を選ぶ（Safari の「開発」メニューは Safari の設定 > 詳細 で表示する）。
3. Web インスペクタのコンソールで次を打つ。

   ```js
   crossOriginIsolated                 // true ならエンジンが動く
   typeof SharedArrayBuffer            // 'function' なら使える
   navigator.serviceWorker?.controller // null なら Service Worker が効いていない
   ```

4. アプリの画面右上を見る。「判定: 簡易」が出ていれば取れていない。

- [ ] `crossOriginIsolated === true` で、「判定: 簡易」が出ない → Android と同じ判定で出せる
- [ ] 取れない場合 → 簡易判定（駒損と一手詰めだけ）で動く。この状態で出すなら、ストアの説明文に「iOS 版は判定が簡易版」と書き、対局中の案内文（`src/main.ts` の簡易判定の知らせ）が iOS でも出ることを確認する。
      本格対応するなら、iOS 側のスキームハンドラ（Capacitor の `WebViewAssetHandler`）で応答に COOP/COEP ヘッダーを足す改造が要る（Capacitor 本体の変更になるので、別途検討）

### 3-4. 確かめること（Android と同じ項目）

- [ ] 「判定: 簡易」の有無を 3-3 の結果どおりに把握している
- [ ] 駒音と雷の効果音が、最初のタップの後に鳴る（iOS は自動再生が制限される。`src/ui/audio.ts` の解錠が効いていること）
- [ ] 縦画面固定、セーフエリア（ノッチ・ホームバー）の中に盤とボタンが収まる
- [ ] 機内モードで起動できる

### 3-5. 配信

```bash
npm run build && npx cap sync ios
# Xcode: Product > Archive → Distribute App → App Store Connect（TestFlight）
```

- [ ] App Store Connect でプライバシーの回答（データ収集なし）、年齢（4+）、カテゴリ（ゲーム > ボード）、スクリーンショット（6.7 インチと 6.1 インチ）
- [ ] GPL のソース公開（2-5 と同じ）。App Store に出す前に、GPL とストア規約の扱いを確認し、必要なら iOS 版は配信しない判断をする
