# @reaatech/idempotency-middleware-express

[![npm version](https://img.shields.io/npm/v/@reaatech/idempotency-middleware-express.svg)](https://www.npmjs.com/package/@reaatech/idempotency-middleware-express)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/idempotency-middleware/ci.yml?branch=main&label=CI)](https://github.com/reaatech/idempotency-middleware/actions/workflows/ci.yml)

Express middleware for [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware). Adds idempotency to Express route handlers by caching responses keyed by the `Idempotency-Key` header. Supports Express 4 and 5.

## Installation

```bash
npm install @reaatech/idempotency-middleware-express
# or
pnpm add @reaatech/idempotency-middleware-express
```

`express` must already be installed in your project.

## Feature Overview

- **Route-level idempotency** — add `app.use(idempotentExpress(adapter))` before your routes
- **Automatic body capture** — monkey-patches `res.json()` and `res.send()` to capture response bodies for caching
- **`res.end()` support** — handles `204 No Content` and other body-less responses gracefully
- **Client disconnect handling** — `close` event releases the lock without persisting incomplete responses
- **Custom error handler** — pluggable `errorHandler` callback for idempotency errors
- **Custom key extraction** — `getKey` option for extracting the idempotency key from any part of the request

## Quick Start

```typescript
import express from 'express';
import { MemoryAdapter } from '@reaatech/idempotency-middleware';
import { idempotentExpress } from '@reaatech/idempotency-middleware-express';

const adapter = new MemoryAdapter();
await adapter.connect();

const app = express();
app.use(express.json());
app.use(idempotentExpress(adapter));

app.post('/charges', (req, res) => {
  // If retried with the same Idempotency-Key header,
  // this handler is not called again — the cached 201 is returned.
  res.status(201).json({ id: 1, amount: req.body.amount });
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

### `idempotentExpress(storage, config?)`

```typescript
import { idempotentExpress } from '@reaatech/idempotency-middleware-express';

app.use(idempotentExpress(adapter, {
  ttl: 60_000,
  methods: ['POST', 'PUT'],
}));
```

#### Parameters

| Param | Type | Description |
|---|---|---|
| `storage` | `StorageAdapter` | The storage adapter to use (from `@reaatech/idempotency-middleware` or any adapter package) |
| `config` | `ExpressIdempotencyConfig` | Configuration options (see below) |

#### `ExpressIdempotencyConfig`

Extends `IdempotencyConfig` with one additional option:

| Property | Type | Description |
|---|---|---|
| `errorHandler` | `(err: IdempotencyError, req: Request, res: Response, next: NextFunction) => void` | Custom handler for idempotency errors |

All options from [`IdempotencyConfig`](https://www.npmjs.com/package/@reaatech/idempotency-middleware#idempotencyconfig) are also supported: `headerName`, `ttl`, `methods`, `getKey`, `shouldCache`, `varyHeaders`, `includeBodyInKey`, `maxKeyLength`, `lockTimeout`, `lockTtl`, `lockPollInterval`.

### Request Flow

For each matching HTTP method request:

1. **Key extraction** — uses `getKey` if provided, otherwise reads `config.headerName` (default `"Idempotency-Key"`) from request headers
2. **No key → pass through** — requests without an idempotency key bypass the middleware entirely
3. **Cache check** — generates a cache key and checks storage for an existing response
4. **Cache hit** — replays the cached status code, headers, and body directly
5. **Cache miss** — acquires a distributed lock, patches `res.json()` / `res.send()`, passes control to `next()`
6. **Response capture** — on `finish` event, caches the captured body + status code + headers
7. **Client abort** — on `close` event (before `finish`), releases the lock without persisting

### Response Capture

The middleware patches `res.json()` and `res.send()` to intercept the response body. All response headers are captured via `res.getHeaders()`. On the next request with the same idempotency key, the exact status code, headers, and body are replayed:

```typescript
// Original request: res.status(201).json({ id: 1 })
// Cached: { statusCode: 201, headers: { 'content-type': 'application/json' }, response: { id: 1 } }
// Reply: res.status(201).set(headers).send(body)
```

Body-less responses (`res.status(204).end()`) are handled correctly — no body is captured and the cached response replays `204` without a body.

## Usage Patterns

### Custom Error Handling

```typescript
app.use(idempotentExpress(adapter, {
  ttl: 60_000,
  errorHandler: (err, req, res, next) => {
    if (err.code === 'KEY_REQUIRED') {
      res.status(400).json({ error: 'Missing idempotency key' });
    } else if (err.isRecoverable()) {
      res.status(503).json({ error: 'Temporarily unavailable, please retry' });
    } else {
      res.status(err.getStatusCode()).json({ error: err.message });
    }
  },
}));
```

### Custom Key Extraction

```typescript
app.use(idempotentExpress(adapter, {
  getKey: (req) => req.headers['x-custom-idempotency-key'] as string,
}));
```

### Selective Caching

```typescript
app.use(idempotentExpress(adapter, {
  shouldCache: (body) => {
    // Don't cache responses with transient data
    if (body && typeof body === 'object' && 'transient' in body) return false;
    return true;
  },
}));
```

### Vary Headers (Content Negotiation)

```typescript
app.use(idempotentExpress(adapter, {
  varyHeaders: ['Accept-Language', 'Accept-Encoding'],
}));
// Same idempotency key, different Accept-Language → different cache keys
```

### Distributed Redis Backend

```typescript
import { Redis } from 'ioredis';
import { RedisAdapter } from '@reaatech/idempotency-middleware-adapter-redis';
import { idempotentExpress } from '@reaatech/idempotency-middleware-express';

const redis = new Redis('redis://localhost:6379');
const storage = new RedisAdapter(redis);
await storage.connect();

const app = express();
app.use(express.json());
app.use(idempotentExpress(storage, { ttl: 3_600_000 }));
```

## Related Packages

- [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware) — Core middleware, `StorageAdapter` interface
- [`@reaatech/idempotency-middleware-koa`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-koa) — Koa middleware
- [`@reaatech/idempotency-middleware-adapter-redis`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-redis) — Redis adapter
- [`@reaatech/idempotency-middleware-adapter-dynamodb`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-dynamodb) — DynamoDB adapter
- [`@reaatech/idempotency-middleware-adapter-firestore`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-firestore) — Firestore adapter

## License

[MIT](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
