# @reaatech/idempotency-middleware-adapter-redis

[![npm version](https://img.shields.io/npm/v/@reaatech/idempotency-middleware-adapter-redis.svg)](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-redis)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/idempotency-middleware/ci.yml?branch=main&label=CI)](https://github.com/reaatech/idempotency-middleware/actions/workflows/ci.yml)

Redis storage adapter for [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware). Provides distributed idempotency caching and token-guarded locking backed by Redis via [ioredis](https://github.com/redis/ioredis).

## Installation

```bash
npm install @reaatech/idempotency-middleware-adapter-redis ioredis
# or
pnpm add @reaatech/idempotency-middleware-adapter-redis ioredis
```

## Feature Overview

- **Token-guarded locking** — lock acquisition via `SET NX` with unique tokens, release via Lua script to prevent accidental unlock by other processes
- **Automatic TTL** — cache entries use Redis `EX` for server-side expiry enforcement
- **Corrupted data recovery** — automatically deletes unparseable entries and returns `null` on `get`
- **Connection lifecycle** — dedicated `connect()` (ping) and `disconnect()` (quit) methods
- **Implements `StorageAdapter`** — drop-in replacement for `MemoryAdapter` in any idempotency setup

## Quick Start

```typescript
import { Redis } from 'ioredis';
import { RedisAdapter } from '@reaatech/idempotency-middleware-adapter-redis';
import { IdempotencyMiddleware } from '@reaatech/idempotency-middleware';

const redis = new Redis('redis://localhost:6379');
const storage = new RedisAdapter(redis);
await storage.connect();

const middleware = new IdempotencyMiddleware(storage, { ttl: 3_600_000 });

const result = await middleware.execute(
  'payment-123',
  { method: 'POST', path: '/charge', body: { amount: 100 } },
  async () => ({ id: 1, status: 'charged' }),
);
```

## API Reference

### `RedisAdapter`

```typescript
import { RedisAdapter } from '@reaatech/idempotency-middleware-adapter-redis';

const adapter = new RedisAdapter(redisClient);
```

#### Constructor

| Param | Type | Description |
|---|---|---|
| `client` | `Redis` | A pre-configured [ioredis](https://github.com/redis/ioredis) client instance |

#### Methods

Implements the full `StorageAdapter` interface:

| Method | Description |
|---|---|
| `connect()` | Pings Redis and marks the adapter as connected |
| `disconnect()` | Calls `redis.quit()` and marks as disconnected |
| `get(key)` | `GET key` → JSON parse → `IdempotencyRecord \| null` |
| `set(key, record)` | `SET key data EX ttlSeconds` |
| `delete(key)` | `DEL key` |
| `acquireLock(key, ttl)` | `SET lock:key token EX ttl NX` — returns `true` on success |
| `releaseLock(key)` | Lua `eval` — deletes lock only if the token matches |
| `waitForLock(key, timeout, pollInterval)` | Polls `EXISTS lock:key` until released or timeout |

### Locking Design

The Redis adapter uses token-guarded locks to prevent the ABA problem:

1. **Acquire:** `SET lock:<key> <randomUUID> EX <ttlSeconds> NX` — atomically sets the lock key only if it doesn't exist
2. **Release:** Lua `eval` script that checks `GET lock:key == token` before `DEL` — prevents a process from releasing another process's lock after TTL expiry + re-acquisition
3. **Wait:** polls `EXISTS lock:key` at `pollInterval` until the key disappears or `timeout` is reached

The lock key is stored at `lock:<cacheKey>` separate from the data key (`<cacheKey>`), so lock state never interferes with cached responses.

## Usage Patterns

### Connection Management

```typescript
import { Redis } from 'ioredis';
import { RedisAdapter } from '@reaatech/idempotency-middleware-adapter-redis';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
});

const adapter = new RedisAdapter(redis);
await adapter.connect();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await adapter.disconnect();
  process.exit(0);
});
```

### Distributed Workers

The Redis adapter is designed for multi-process deployments. Multiple Node.js instances sharing the same Redis instance coordinate via the token-guarded locks:

```typescript
// Worker A and Worker B both execute:
const result = await middleware.execute('same-key', ctx, handler);
// Only one handler executes. Both get the same cached result.
```

### TTL and Lock Configuration

```typescript
const middleware = new IdempotencyMiddleware(storage, {
  ttl: 86_400_000,        // Cache responses for 24 hours
  lockTimeout: 30_000,    // Wait up to 30 seconds for a lock
  lockTtl: 60_000,        // Lock auto-expires after 60 seconds
  lockPollInterval: 200,  // Check every 200ms
});
```

## Related Packages

- [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware) — Core middleware, `StorageAdapter` interface
- [`@reaatech/idempotency-middleware-express`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-express) — Express middleware
- [`@reaatech/idempotency-middleware-koa`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-koa) — Koa middleware

## License

[MIT](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
