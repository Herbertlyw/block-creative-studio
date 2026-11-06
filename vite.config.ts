import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@bb/calibrated': resolve(process.cwd(), 'src/games/block-placement/calibrated/extension.ts'),
      '@bb/observed-layers': resolve(
        process.cwd(),
        'src/games/block-placement/calibrated/observedLayers.ts',
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
