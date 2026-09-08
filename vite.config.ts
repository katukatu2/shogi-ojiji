import { defineConfig } from 'vite';

// やねうら王 WASM は SharedArrayBuffer を使うため、COOP/COEP ヘッダーが必要
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  test: { environment: 'node', testTimeout: 20000 },
});
