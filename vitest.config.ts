import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The contract snapshot is an incomplete upstream reference, not this project's test suite.
export default defineConfig({
  resolve: {
    alias: {
      '@bb/calibrated': resolve(process.cwd(), 'src/games/block-placement/calibrated/extension.ts'),
      '@bb/observed-layers': resolve(
        process.cwd(),
        'src/games/block-placement/calibrated/observedLayers.ts',
      ),
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
