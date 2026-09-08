import type { CapacitorConfig } from '@capacitor/cli';

// スマホアプリ化の設定。`npm i -D @capacitor/cli @capacitor/core` のあと
// `npx cap add android` / `npx cap add ios`（iOS は macOS + Xcode が必要）。
// エンジンは SharedArrayBuffer を使うため、WebView が COOP/COEP を受け付ける必要がある。
// Android WebView は https://localhost 配信＋Service Worker で動く想定。iOS は実機検証が未了。
const config: CapacitorConfig = {
  appId: 'jp.sonot.shogiojiji',
  appName: '将棋オジジの定石指南',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
