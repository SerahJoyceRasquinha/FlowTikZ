import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { base64Fixtures } from './scripts/vite-base64-fixtures.mjs';
import { ocrAssets } from './scripts/vite-ocr-assets.mjs';

export default defineConfig(({ mode }) => ({
  // base64Fixtures only answers `?b64` imports, which only the tests make.
  // ocrAssets serves the offline text reader (Tesseract) from this app.
  plugins: [react(), ocrAssets(), ...(mode === 'test' ? [base64Fixtures()] : [])],
  server: { port: 5173, open: false },
  build: { outDir: 'dist', sourcemap: true, target: 'es2020' },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts', 'src/tests/**/*.test.tsx'],
    // The interaction suite drives hundreds of real pointer gestures; on a
    // slow or shared CI machine a single sweep can exceed Vitest's 5 s default.
    testTimeout: 30_000,
  },
}));
