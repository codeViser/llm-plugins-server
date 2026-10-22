import path from 'path';

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['./src/index.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['better-sqlite3'],
  esbuildOptions(options) {
    options.alias = {
      '@': path.resolve(__dirname, 'src'),
    };
  },
});
