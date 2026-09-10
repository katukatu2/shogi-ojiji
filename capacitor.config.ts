import type { CapacitorConfig } from '@capacitor/cli';

// Android / iOS のプロジェクトは生成済み。更新は npm run cap:sync。
// iOS のネイティブビルドには macOS + Xcode が必要。
// エンジンは SharedArrayBuffer を使うため、WebView が COOP/COEP を受け付ける必要がある。
// Android WebView は https://localhost 配信＋Service Worker で動く想定。iOS は実機検証が未了。
const config: CapacitorConfig = {
  appId: 'jp.sonot.shogiojiji',
  appName: '将棋オジジの定石指南',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // WKWebView の予約スキーム https はローカル素材の配信に使えない。
    iosScheme: 'capacitor',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
