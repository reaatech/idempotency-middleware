# @reaatech/idempotency-middleware-adapter-firestore

[![npm version](https://img.shields.io/npm/v/@reaatech/idempotency-middleware-adapter-firestore.svg)](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-firestore)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/idempotency-middleware/ci.yml?branch=main&label=CI)](https://github.com/reaatech/idempotency-middleware/actions/workflows/ci.yml)

GCP Firestore storage adapter for [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware). Uses Firestore transactions for safe distributed locking with TTL-compatible `expiresAt` fields, backed by the Google Cloud Firestore Node.js SDK.

## Installation

```bash
npm install @reaatech/idempotency-middleware-adapter-firestore @google-cloud/firestore
# or
pnpm add @reaatech/idempotency-middleware-adapter-firestore @google-cloud/firestore
```

## Feature Overview

- **Transaction-gated locking** — lock acquisition wrapped in a Firestore `runTransaction` to guarantee atomicity
- **Automatic expired lock reclaim** — expired locks (based on `expiresAt`) are re-acquirable within the same transaction flow
- **TTL-compatible `expiresAt`** — `Date`-typed field compatible with Firestore TTL policies for automatic cleanup
- **Client-side TTL enforcement** — explicit expiry check on `get()` as a safety net before Firestore TTL scavenging
- **Connectionless** — Firestore client is ready immediately; `connect()` and `disconnect()` are no-ops
- **Implements `StorageAdapter`** — drop-in replacement for any other adapter

## Quick Start

```typescript
import { Firestore } from '@google-cloud/firestore';
import { FirestoreAdapter } from '@reaatech/idempotency-middleware-adapter-firestore';
import { IdempotencyMiddleware } from '@reaatech/idempotency-middleware';

const firestore = new Firestore();
const storage = new FirestoreAdapter(firestore, 'idempotency_cache');

const middleware = new IdempotencyMiddleware(storage, { ttl: 3_600_000 });

const result = await middleware.execute(
  'checkout-789',
  { method: 'POST', path: '/checkout', body: { cartId: 'xyz' } },
  async () => ({ id: 1, status: 'confirmed' }),
);
```

## API Reference

### `FirestoreAdapter`

```typescript
import { FirestoreAdapter } from '@reaatech/idempotency-middleware-adapter-firestore';

const adapter = new FirestoreAdapter(firestore, 'my_collection');
```

#### Constructor

| Param | Type | Default | Description |
|---|---|---|---|
| `firestore` | `Firestore` | (required) | Configured Firestore client instance |
| `collectionName` | `string` | `"idempotency_cache"` | The Firestore collection name |

#### Document Schema

Each document in the collection stores:

| Field | Type | Description |
|---|---|---|
| `response` | (any) | The cached response (serialized) |
| `createdAt` | `number` | Epoch milliseconds |
| `ttl` | `number` | TTL in milliseconds |
| `expiresAt` | `Date` | Expiry timestamp (`createdAt + ttl`) — compatible with Firestore TTL policies |

#### Methods

Implements the full `StorageAdapter` interface:

| Method | Firestore Operation | Description |
|---|---|---|
| `connect()` | None | No-op (client is connectionless) |
| `disconnect()` | None | No-op |
| `get(key)` | `doc(key).get()` | Returns `null` if missing or expired |
| `set(key, record)` | `doc(key).set(...)` with `expiresAt` Date | Overwrites existing documents |
| `delete(key)` | `doc(key).delete()` | Removes the document |
| `acquireLock(key, ttl)` | `runTransaction` on `lock:<key>` | Returns `true` on success, `false` if lock exists and is unexpired |
| `releaseLock(key)` | `doc(lock:<key>).delete()` | Removes the lock document |
| `waitForLock(key, timeout, pollInterval)` | `doc(lock:<key>).get()` | Polls until lock disappears, expires, or timeout |

### Locking Design

The Firestore adapter uses transactions for safe distributed locking:

1. **Acquire:** `runTransaction` on the lock document `lock:<key>`. If the document exists and its `expiresAt` is in the future, the transaction throws a marker error (`__idempotency_lock_held__`) which is caught and surfaced as `acquireLock = false`. Otherwise, the document is set with `{ acquiredAt, expiresAt }`.
2. **Release:** `delete()` on `lock:<key>`.
3. **Wait:** polls `doc(lock:<key>).get()` — returns when the document is missing or its `expiresAt` has passed.

Expired locks are automatically re-acquirable because the transaction only rejects when `expiresAt > now`.

## Usage Patterns

### Enabling Firestore TTL

Create a TTL policy on your collection pointing to the `expiresAt` field. This lets Firestore automatically delete expired documents:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=idempotency_cache \
  --enable-ttl
```

### Custom Collection Name

```typescript
const adapter = new FirestoreAdapter(firestore, 'prod_idempotency_cache');
```

### Distributed Workers

Multiple Cloud Run instances or Cloud Functions sharing the same Firestore collection coordinate via transactions:

```typescript
// Instance A and Instance B both execute:
const result = await middleware.execute('same-key', ctx, handler);
// Only one handler executes. Both return the same cached result.
```

### Handling Firestore Latency

Firestore transactions have higher latency than Redis but guarantee strong consistency. Consider these trade-offs:

```typescript
const middleware = new IdempotencyMiddleware(storage, {
  lockTimeout: 60_000,    // Longer timeout for Firestore latency
  lockPollInterval: 500,  // Less frequent polling to save reads
  ttl: 86_400_000,        // 24-hour cache
});
```

## Related Packages

- [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware) — Core middleware, `StorageAdapter` interface
- [`@reaatech/idempotency-middleware-express`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-express) — Express middleware
- [`@reaatech/idempotency-middleware-koa`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-koa) — Koa middleware
- [`@reaatech/idempotency-middleware-adapter-redis`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-redis) — Redis adapter
- [`@reaatech/idempotency-middleware-adapter-dynamodb`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-dynamodb) — DynamoDB adapter

## License

[MIT](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
