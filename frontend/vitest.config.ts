import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Deviation from brief: without inlining vuetify, Vitest externalizes it and Node's
    // native ESM loader chokes on vuetify's per-component CSS side-effect imports
    // (e.g. "Unknown file extension .css" for VApp.css). See task-7-report.md.
    server: { deps: { inline: ['vuetify'] } },
    setupFiles: ['./tests/setup.ts'],
  },
});
