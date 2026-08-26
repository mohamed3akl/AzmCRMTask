import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Test files share one real Postgres database (see tests/setup.ts), so
    // running them in parallel workers causes cross-file races (one file's
    // beforeEach truncation/insert interleaving with another's). Force
    // sequential execution to keep the shared DB state deterministic.
    fileParallelism: false,
  },
});
