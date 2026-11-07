import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env.PAGES_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    watch: {
      ignored: ['**/docs/**', '**/artifacts/**', '**/examples/**', '**/.git/**'],
    },
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
