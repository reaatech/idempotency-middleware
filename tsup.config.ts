import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'frameworks/express': 'src/frameworks/express.ts',
    'frameworks/koa': 'src/frameworks/koa.ts',
    'adapters/redis': 'src/redis.ts',
    'adapters/dynamodb': 'src/dynamodb.ts',
    'adapters/firestore': 'src/firestore.ts',
  },
  format: ['cjs', 'esm'],
  dts: {
    entry: {
      index: 'src/index.ts',
      'frameworks/express': 'src/frameworks/express.ts',
      'frameworks/koa': 'src/frameworks/koa.ts',
      'adapters/redis': 'src/redis.ts',
      'adapters/dynamodb': 'src/dynamodb.ts',
      'adapters/firestore': 'src/firestore.ts',
    },
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  target: 'node18',
  external: [
    'express',
    'koa',
    'ioredis',
    '@google-cloud/firestore',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/util-dynamodb',
  ],
  outDir: 'dist',
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.js' : '.cjs',
    };
  },
});
