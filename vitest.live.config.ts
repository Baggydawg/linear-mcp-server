import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],

    // No setupFiles here — the default tests/setup.ts mocks the Linear client
    // via tests/mocks/linear-client.js. Live tests must hit the real API.

    // Disable parallel test files to avoid hitting Linear API rate limits.
    fileParallelism: false,

    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
