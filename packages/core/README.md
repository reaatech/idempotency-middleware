# @reaatech/idempotency-middleware

[![npm version](https://img.shields.io/npm/v/@reaatech/idempotency-middleware.svg)](https://www.npmjs.com/package/@reaatech/idempotency-middleware)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/idempotency-middleware/ci.yml?branch=main&label=CI)](https://github.com/reaatech/idempotency-middleware/actions/workflows/ci.yml)

Framework-agnostic idempotency middleware for TypeScript. Make `POST`, `PUT`, and `PATCH` requests safe to retry — duplicate requests with the same `Idempotency-Key` header return the cached original response without re-executing side effects. This package is the foundation of the `@reaatech/idempotency-middleware-*` ecosystem.

## Installation

```bash
npm install @reaatech/idempotency-middleware
# or
pnpm add @reaatech/idempotency-middleware
```

## Feature Overview

- **Pluggable storage** — `StorageAdapter` interface with in-memory default; Redis, DynamoDB, and Firestore adapters available as separate packages
- **Distributed locking** — bundled lock primitives (acquire, release, wait) prevent concurrent handler execution for the same key
- **True idempotency** — both successes and errors are cached; a failed mutation returns the original error on retry
- **Request body hashing** — SHA-256 body hashes included in cache keys by default, so different payloads produce different keys
- **Vary header support** — include select request headers in the cache key for content negotiation
- **Zero-config default** — `MemoryAdapter` requires no external dependencies and works immediately after `connect()`
- **Raw handler wrapper** — `idempotentHandler` wraps any async function for Lambda, queue consumers, gRPC, and other non-HTTP runtimes
- **Dual ESM/CJS output** — works with `import` and `require`

## Quick Start

```typescript
import { MemoryAdapter, IdempotencyMiddleware } from '@reaatech/idempotency-middleware';

const storage = new MemoryAdapter();
await storage.connect();

const middleware = new IdempotencyMiddleware(storage, { ttl: 86_400_000 });

// First call executes the handler
const result1 = await middleware.execute(
  'unique-key',
  { method: 'POST', path: '/charges', body: { amount: 100 } },
  async () => ({ id: 1, amount: 100 }),
);

// Duplicate call with same key returns the cached response
const result2 = await middleware.execute(
  'unique-key',
  { method: 'POST', path: '/charges', body: { amount: 100 } },
  async () => ({ id: 2, amount: 100 }), // Never called
);

console.log(result1 === result2); // true
```

## API Reference

### `IdempotencyMiddleware`

The core orchestrator. Accepts a `StorageAdapter` and optional `IdempotencyConfig`.

```typescript
import { IdempotencyMiddleware } from '@reaatech/idempotency-middleware';

const middleware = new IdempotencyMiddleware(storage, {
  ttl: 3_600_000,
  lockTimeout: 30_000,
});
```

#### `execute<T, R>(key, context, handler): Promise<R>`

| Param | Type | Description |
|---|---|---|
| `key` | `string` | The idempotency key from the client |
| `context` | `T` | Request context for cache key generation (method, path, body, headers) |
| `handler` | `() => Promise<R>` | The function to execute on cache miss |

**Execution flow:**

1. Validates `key` (non-empty, within `maxKeyLength`)
2. Generates a SHA-256 cache key from `method:path:key:bodyHash:varyHeaders`
3. Checks storage for an existing cached response — returns it on hit (including serialized errors)
4. Acquires a distributed lock for the cache key
5. Double-checks the cache (another request may have completed while waiting for the lock)
6. Executes the handler and caches the result (success or error) on the leader path
7. Follower requests wait for the lock, then return the cached response or throw `CONFLICT`

### `IdempotencyConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `headerName` | `string` | `"Idempotency-Key"` | Header to extract the idempotency key from |
| `ttl` | `number` | `86400000` (24h) | Cache TTL in milliseconds |
| `methods` | `string[]` | `["POST", "PUT", "PATCH"]` | HTTP methods to apply idempotency to |
| `getKey` | `(req) => string \| undefined` | — | Custom key extraction function |
| `shouldCache` | `(response) => boolean` | `() => true` | Filter which responses to cache |
| `varyHeaders` | `string[]` | `[]` | Headers to include in the cache key |
| `includeBodyInKey` | `boolean` | `true` | Include request body hash in cache key |
| `maxKeyLength` | `number` | `256` | Maximum idempotency key length |
| `lockTimeout` | `number` | `30000` (30s) | Max time to wait for a lock |
| `lockTtl` | `number` | `lockTimeout` | Lifetime of an acquired lock |
| `lockPollInterval` | `number` | `100` | Interval between lock checks in ms |

### `IdempotencyError`

Typed error class with structured error codes.

```typescript
import { IdempotencyError, IdempotencyErrorCode } from '@reaatech/idempotency-middleware';

throw new IdempotencyError(
  IdempotencyErrorCode.LOCK_TIMEOUT,
  'Could not acquire lock within the timeout period',
  { cause: originalError, context: { key: 'abc123' } },
);
```

#### `IdempotencyErrorCode`

| Code | Status | Recoverable | Description |
|---|---|---|---|
| `KEY_REQUIRED` | 400 | No | Missing or empty idempotency key |
| `LOCK_TIMEOUT` | 409 | Yes | Lock acquisition or wait exceeded timeout |
| `STORAGE_ERROR` | 503 | Yes | Storage operation failed (network, permissions) |
| `SERIALIZATION_ERROR` | 500 | No | Response serialization failed |
| `CONFLICT` | 409 | No | Lock holder crashed without storing a response |
| `INVALID_CONFIG` | 500 | No | Misconfigured middleware |
| `NOT_CONNECTED` | 500 | No | Adapter used before `connect()` was called |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `isRecoverable()` | `boolean` | `true` for `LOCK_TIMEOUT` and `STORAGE_ERROR` |
| `getStatusCode()` | `number` | HTTP status code for the error |

### `StorageAdapter`

The interface all storage backends implement. Create your own adapter for any database.

```typescript
import type { StorageAdapter, IdempotencyRecord } from '@reaatech/idempotency-middleware';

class MyAdapter implements StorageAdapter {
  async get(key: string): Promise<IdempotencyRecord | null> { /* ... */ }
  async set(key: string, record: IdempotencyRecord): Promise<void> { /* ... */ }
  async delete(key: string): Promise<void> { /* ... */ }
  async connect(): Promise<void> { /* ... */ }
  async disconnect(): Promise<void> { /* ... */ }
  async acquireLock(key: string, ttl: number): Promise<boolean> { /* ... */ }
  async releaseLock(key: string): Promise<void> { /* ... */ }
  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> { /* ... */ }
}
```

### `MemoryAdapter`

In-memory `Map`-backed storage with `setTimeout`-based TTL expiry and in-process locking. Zero dependencies. The default adapter.

```typescript
import { MemoryAdapter } from '@reaatech/idempotency-middleware';

const adapter = new MemoryAdapter();
await adapter.connect();
// ... use the adapter ...
await adapter.disconnect(); // Clears all cache entries and lock timers
```

### `idempotentHandler`

Wraps any async function with idempotency — no HTTP framework required.

```typescript
import { idempotentHandler } from '@reaatech/idempotency-middleware';

const handler = async (input: { amount: number }) => {
  return { id: 1, amount: input.amount };
};

const wrapped = idempotentHandler(storage, handler, { ttl: 3600000 });

// Call with input, idempotency key, and optional context
const result = await wrapped({ amount: 100 }, 'key-abc', { method: 'POST', path: '/charge' });
```

#### `RawHandlerContext`

| Property | Type | Description |
|---|---|---|
| `method` | `string` | HTTP method for cache key scoping |
| `path` | `string` | Request path for cache key scoping |
| `headers` | `Record<string, string>` | Headers for vary header extraction |
| `body` | `unknown` | Request body |
| `[key: string]` | `unknown` | Arbitrary additional context |

### Utilities

#### `generateCacheKey(options: CacheKeyOptions): string`

Generates a SHA-256 cache key from the provided options. Used internally by `IdempotencyMiddleware`.

#### `hashBody(body: unknown): string`

SHA-256 hash of a request body for inclusion in cache keys.

#### `serializeResponse(response: unknown): unknown`

Converts `Error` instances to tagged JSON-safe objects so they survive round-trips through `JSON.stringify`-based adapters.

#### `deserializeResponse(response: unknown): unknown`

Reconstructs `Error` instances from the tagged format produced by `serializeResponse`.

#### `normalizeHeaders(headers: OutgoingHttpHeaders): Record<string, string>`

Normalizes Node.js `OutgoingHttpHeaders` to a flat `Record<string, string>`.

## Usage Patterns

### Distributed Locking

When two requests with the same idempotency key arrive concurrently, only the first acquires the lock and executes the handler. All others wait and receive the cached result:

```typescript
const middleware = new IdempotencyMiddleware(storage, {
  lockTimeout: 30000,    // Wait up to 30 seconds
  lockTtl: 60000,        // Lock auto-expires after 60 seconds
  lockPollInterval: 100, // Check every 100ms
});

// Execute concurrently — only one handler invocation
const [r1, r2] = await Promise.all([
  middleware.execute('same-key', {}, handler),
  middleware.execute('same-key', {}, handler),
]);
// r1 === r2, handler called once
```

### Custom Cache Key Extraction

```typescript
const middleware = new IdempotencyMiddleware(storage, {
  getKey: (req) => {
    // Extract from a custom header
    return (req as Request).headers['x-idempotency-key'] as string;
  },
  varyHeaders: ['Accept-Language'],    // Include language in key
  includeBodyInKey: true,               // Different bodies = different keys (default)
  shouldCache: (response) => {
    // Don't cache responses marked as transient
    if (response && typeof response === 'object' && 'transient' in response) return false;
    return true;
  },
});
```

### Lambda / Queue Handler

```typescript
import { idempotentHandler, MemoryAdapter } from '@reaatech/idempotency-middleware';

const storage = new MemoryAdapter();
await storage.connect();

export const handler = idempotentHandler(
  storage,
  async (event: SQSEvent) => {
    // Process the message
    return { processed: event.Records.length };
  },
  { ttl: 3600000 },
);

// Usage — idempotencyKey from message deduplication ID
await handler(event, event.Records[0].messageId);
```

## Related Packages

| Package | Description |
|---|---|
| [`@reaatech/idempotency-middleware-express`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-express) | Express middleware adapter |
| [`@reaatech/idempotency-middleware-koa`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-koa) | Koa middleware adapter |
| [`@reaatech/idempotency-middleware-adapter-redis`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-redis) | Redis storage adapter |
| [`@reaatech/idempotency-middleware-adapter-dynamodb`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-dynamodb) | DynamoDB storage adapter |
| [`@reaatech/idempotency-middleware-adapter-firestore`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-firestore) | Firestore storage adapter |

## License

[MIT](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
