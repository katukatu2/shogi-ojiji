import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

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
  // Playwright の E2E（tests/e2e/*.spec.ts）は vitest で走らせない
  test: { environment: 'node', testTimeout: 20000, exclude: [...configDefaults.exclude, 'tests/e2e/**', '**/.claude/**'] },
});
