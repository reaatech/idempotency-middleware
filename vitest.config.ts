import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/core/types.ts',
        'src/adapters/StorageAdapter.ts',
        'src/index.ts',
        'src/redis.ts',
        'src/dynamodb.ts',
        'src/firestore.ts',
        '*.config.*',
        '*.cjs',
        'dist/**',
        'examples/**',
        'tests/**',
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});
