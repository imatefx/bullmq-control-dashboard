import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    unstubEnvs: true,
    // Every test file gets its own throwaway config file (CONFIG_PATH is read at import).
    setupFiles: ['test/support/isolated-config.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          // Starts a real Redis (Docker via Testcontainers) once for the whole run.
          globalSetup: ['test/support/redis-container.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          // Files share one Redis; run them one at a time so FLUSHALL in one can't hit another.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Dev-only seeding scripts and the process entrypoint (covered by e2e instead).
      exclude: ['src/seed.ts', 'src/seed-demo.ts', 'src/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
