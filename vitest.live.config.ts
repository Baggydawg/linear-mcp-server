import { defineConfig } from 'vitest/config';
import { MarkdownReporter } from './tests/live/helpers/markdown-reporter.js';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],

    // No setupFiles here — the default tests/setup.ts mocks the Linear client
    // via tests/mocks/linear-client.js. Live tests must hit the real API.

    // Disable parallel test files to avoid hitting Linear API rate limits.
    fileParallelism: false,

    // Pin forks pool explicitly (already the default in vitest 3.x) for documentation
    // and future-proofing. Each test file runs in its own child process — memory is
    // fully reclaimed by the OS when the process exits.
    pool: 'forks',
    poolOptions: {
      forks: {
        // Safety valve: cap worker heap at 4GB (8x observed ~500MB peak).
        // Prevents runaway memory from consuming all system RAM.
        execArgv: ['--max-old-space-size=4096'],
      },
    },

    testTimeout: 60000,
    hookTimeout: 60000,

    reporters: ['default', new MarkdownReporter()],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
