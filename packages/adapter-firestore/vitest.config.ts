import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['*.config.*', 'dist/**'],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 75,
        statements: 85,
      },
    },
  },
});
