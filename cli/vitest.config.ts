import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
    ],
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    pool: 'forks',
    alias: {
      '@/': new URL('./src/', import.meta.url).pathname,
    },
  },
});
