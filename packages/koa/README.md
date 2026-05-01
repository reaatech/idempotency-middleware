# @reaatech/idempotency-middleware-koa

[![npm version](https://img.shields.io/npm/v/@reaatech/idempotency-middleware-koa.svg)](https://www.npmjs.com/package/@reaatech/idempotency-middleware-koa)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/idempotency-middleware/ci.yml?branch=main&label=CI)](https://github.com/reaatech/idempotency-middleware/actions/workflows/ci.yml)

Koa middleware for [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware). Adds idempotency to Koa route handlers by caching responses keyed by the `Idempotency-Key` header. Supports Koa 2 and 3.

## Installation

```bash
npm install @reaatech/idempotency-middleware-koa
# or
pnpm add @reaatech/idempotency-middleware-koa
```

`koa` and a body parser middleware (`koa-bodyparser` or equivalent) must already be installed in your project.

## Feature Overview

- **Route-level idempotency** — add `app.use(idempotentKoa(adapter))` before your routes
- **Body-aware** — reads `ctx.request.body` (requires body parser middleware) for body hashing
- **Automatic capture** — reads `ctx.body` and `ctx.status` after `await next()` for caching
- **Error caching** — caught errors are cached so retries receive the same error
- **Custom error handler** — pluggable `errorHandler` callback for idempotency errors
- **Custom key extraction** — `getKey` option for extracting the idempotency key from any part of the context

## Quick Start

```typescript
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { MemoryAdapter } from '@reaatech/idempotency-middleware';
import { idempotentKoa } from '@reaatech/idempotency-middleware-koa';

const adapter = new MemoryAdapter();
await adapter.connect();

const app = new Koa();
app.use(bodyParser());
app.use(idempotentKoa(adapter));

app.use((ctx) => {
  if (ctx.method === 'POST' && ctx.path === '/charges') {
    ctx.status = 201;
    ctx.body = { id: 1, amount: ctx.request.body?.amount };
  }
});

app.listen(3000);
```

```bash
curl -XPOST http://localhost:3000/charges \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: abc-123" \
  -d '{"amount": 100}'
# → 201 { "id": 1, "amount": 100 }

# Same key, same response — handler not re-executed
curl -XPOST http://localhost:3000/charges \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: abc-123" \
  -d '{"amount": 200}'
# → 201 { "id": 1, "amount": 100 }
```

## API Reference

### `idempotentKoa(storage, config?)`

```typescript
import { idempotentKoa } from '@reaatech/idempotency-middleware-koa';

app.use(idempotentKoa(adapter, {
  ttl: 60_000,
  methods: ['POST'],
}));
```

#### Parameters

| Param | Type | Description |
|---|---|---|
| `storage` | `StorageAdapter` | The storage adapter to use (from `@reaatech/idempotency-middleware` or any adapter package) |
| `config` | `KoaIdempotencyConfig` | Configuration options (see below) |

#### `KoaIdempotencyConfig`

Extends `IdempotencyConfig` with one additional option:

| Property | Type | Description |
|---|---|---|
| `errorHandler` | `(ctx: Context, err: IdempotencyError) => void` | Custom handler for idempotency errors |

All options from [`IdempotencyConfig`](https://www.npmjs.com/package/@reaatech/idempotency-middleware#idempotencyconfig) are also supported: `headerName`, `ttl`, `methods`, `getKey`, `shouldCache`, `varyHeaders`, `includeBodyInKey`, `maxKeyLength`, `lockTimeout`, `lockTtl`, `lockPollInterval`.

### Request Flow

For each matching HTTP method request:

1. **Key extraction** — uses `getKey` if provided, otherwise reads `config.headerName` via `ctx.get()`
2. **No key → pass through** — requests without an idempotency key call `await next()` normally
3. **Cache check** — generates a cache key and checks storage for an existing response
4. **Cache hit** — replays the cached status code, headers, and body directly (skips downstream middleware)
5. **Cache miss** — acquires a distributed lock and calls `await next()`
6. **Response capture** — reads `ctx.body`, `ctx.status`, and `ctx.response.headers` after the downstream middleware completes
7. **Error capture** — if the downstream middleware throws, the error is cached (unless `shouldCache` returns `false`)

### Response Capture

Unlike the Express adapter, the Koa adapter captures responses by reading `ctx.body` and `ctx.status` after `await next()` returns. All response headers are captured from `ctx.response.headers`. On the next request with the same idempotency key, the exact status code, headers, and body are replayed:

```typescript
// Original request: ctx.status = 201; ctx.body = { id: 1 }
// Cached: { statusCode: 201, headers: { ... }, response: { id: 1 } }
// Reply: ctx.status = 201; ctx.set(headers); ctx.body = { id: 1 }
```

Headers `content-length` and `transfer-encoding` are skipped during replay since Koa/Node.js sets them based on the body content.

## Usage Patterns

### Custom Error Handling

```typescript
app.use(idempotentKoa(adapter, {
  ttl: 60_000,
  errorHandler: (ctx, err) => {
    ctx.status = err.getStatusCode();
    ctx.body = {
      error: err.message,
      code: err.code,
      recoverable: err.isRecoverable(),
    };
  },
}));
```

### Custom Key Extraction

```typescript
app.use(idempotentKoa(adapter, {
  getKey: (ctx) => ctx.get('X-Custom-Key') || undefined,
}));
```

### Selective Caching

```typescript
app.use(idempotentKoa(adapter, {
  shouldCache: (body) => {
    if (body && typeof body === 'object' && 'skipCache' in body) return false;
    return true;
  },
}));
```

### Excluding Body from Cache Key

```typescript
app.use(idempotentKoa(adapter, {
  includeBodyInKey: false,
}));
// Same idempotency key, different request bodies → same cache key → same cached response
```

### Distributed Redis Backend

```typescript
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { Redis } from 'ioredis';
import { RedisAdapter } from '@reaatech/idempotency-middleware-adapter-redis';
import { idempotentKoa } from '@reaatech/idempotency-middleware-koa';

const redis = new Redis('redis://localhost:6379');
const storage = new RedisAdapter(redis);
await storage.connect();

const app = new Koa();
app.use(bodyParser());
app.use(idempotentKoa(storage, { ttl: 3_600_000 }));
```

## Error Propagation

The Koa adapter distinguishes between two error types:

- **`IdempotencyError`** — caught by the middleware. If `errorHandler` is provided, it's invoked; otherwise, the error's status code and message are set on `ctx.status` and `ctx.body`.
- **Other errors** — re-thrown. These propagate to Koa's error handling (or crash the request if no error handler is registered). If `shouldCache` returns `true` for the error, it is cached before re-throwing.

## Related Packages

- [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware) — Core middleware, `StorageAdapter` interface
- [`@reaatech/idempotency-middleware-express`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-express) — Express middleware
- [`@reaatech/idempotency-middleware-adapter-redis`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-redis) — Redis adapter
- [`@reaatech/idempotency-middleware-adapter-dynamodb`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-dynamodb) — DynamoDB adapter
- [`@reaatech/idempotency-middleware-adapter-firestore`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-firestore) — Firestore adapter

## License

[MIT](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
