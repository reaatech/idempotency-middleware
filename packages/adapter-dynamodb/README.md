# @reaatech/idempotency-middleware-adapter-dynamodb

[![npm version](https://img.shields.io/npm/v/@reaatech/idempotency-middleware-adapter-dynamodb.svg)](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-dynamodb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/idempotency-middleware/ci.yml?branch=main&label=CI)](https://github.com/reaatech/idempotency-middleware/actions/workflows/ci.yml)

AWS DynamoDB storage adapter for [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware). Uses conditional writes for distributed locking with TTL-compatible `expiresAt` attributes, backed by the AWS SDK for JavaScript v3.

## Installation

```bash
npm install @reaatech/idempotency-middleware-adapter-dynamodb @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
# or
pnpm add @reaatech/idempotency-middleware-adapter-dynamodb @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
```

## Feature Overview

- **Conditional write locking** — `attribute_not_exists(cacheKey) OR expiresAt < :nowSec` prevents concurrent lock acquisition across distributed instances
- **TTL-compatible `expiresAt`** — epoch-second attribute compatible with DynamoDB's native TTL feature for automatic record cleanup
- **Client-side TTL enforcement** — explicit expiry check on `get()` as a safety net before DynamoDB TTL scavenging
- **Connectionless** — DynamoDB client is ready immediately; `connect()` and `disconnect()` are no-ops
- **Implements `StorageAdapter`** — drop-in replacement for any other adapter

## Quick Start

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBAdapter } from '@reaatech/idempotency-middleware-adapter-dynamodb';
import { IdempotencyMiddleware } from '@reaatech/idempotency-middleware';

const client = new DynamoDBClient({ region: 'us-east-1' });
const storage = new DynamoDBAdapter(client, 'idempotency-cache');

const middleware = new IdempotencyMiddleware(storage, { ttl: 3_600_000 });

const result = await middleware.execute(
  'order-456',
  { method: 'POST', path: '/orders', body: { productId: 'abc' } },
  async () => ({ id: 1, status: 'created' }),
);
```

## API Reference

### `DynamoDBAdapter`

```typescript
import { DynamoDBAdapter } from '@reaatech/idempotency-middleware-adapter-dynamodb';

const adapter = new DynamoDBAdapter(client, 'my-table');
```

#### Constructor

| Param | Type | Default | Description |
|---|---|---|---|
| `client` | `DynamoDBClient` | (required) | Configured AWS SDK v3 DynamoDB client |
| `tableName` | `string` | `"idempotency-cache"` | The DynamoDB table name |

#### Table Schema

The adapter expects a table with a partition key `cacheKey` (type `String`). Each item stores:

| Attribute | Type | Description |
|---|---|---|
| `cacheKey` | `S` | Partition key — the SHA-256 cache key |
| `response` | (any) | The cached response (serialized) |
| `createdAt` | `N` | Epoch milliseconds |
| `ttl` | `N` | TTL in milliseconds |
| `expiresAt` | `N` | Epoch seconds (`createdAt + ttl`) — compatible with DynamoDB TTL |

#### Methods

Implements the full `StorageAdapter` interface:

| Method | DynamoDB Operation | Description |
|---|---|---|
| `connect()` | None | No-op (client is connectionless) |
| `disconnect()` | None | No-op |
| `get(key)` | `GetItem` with `cacheKey` partition key | Returns `null` if missing or expired |
| `set(key, record)` | `PutItem` with marshalled data + `expiresAt` | Overwrites existing entries |
| `delete(key)` | `DeleteItem` with `cacheKey` partition key | Removes the item |
| `acquireLock(key, ttl)` | `PutItem` with `ConditionExpression` | Returns `true` on success, `false` on `ConditionalCheckFailedException` |
| `releaseLock(key)` | `DeleteItem` on `lock:<key>` | Removes the lock item |
| `waitForLock(key, timeout, pollInterval)` | `GetItem` on `lock:<key>` | Polls until lock disappears, expires, or timeout |

### Locking Design

The DynamoDB adapter uses conditional writes for distributed locking:

1. **Acquire:** `PutItem` on `lock:<key>` with condition `attribute_not_exists(cacheKey) OR expiresAt < :nowSec`
2. **Release:** `DeleteItem` on `lock:<key>`
3. **Wait:** polls `GetItem` on `lock:<key>` — returns when the item is missing or its `expiresAt` has passed

Expired locks are automatically re-acquirable due to the `expiresAt < :nowSec` clause in the condition expression.

## Usage Patterns

### Enabling DynamoDB TTL

Enable TTL on your DynamoDB table pointing to the `expiresAt` attribute. This lets DynamoDB automatically delete expired items without consuming write capacity:

```bash
aws dynamodb update-time-to-live \
  --table-name idempotency-cache \
  --time-to-live-specification "AttributeName=expiresAt,Enabled=true"
```

### IAM Permissions

The adapter requires these DynamoDB actions:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:DeleteItem"
  ],
  "Resource": "arn:aws:dynamodb:*:*:table/idempotency-cache"
}
```

### Custom Table Name

```typescript
const adapter = new DynamoDBAdapter(client, 'prod-idempotency-cache');
```

### Distributed Workers

Multiple Lambda functions or ECS tasks sharing the same DynamoDB table coordinate via conditional writes:

```typescript
// Lambda A and Lambda B both execute:
const result = await middleware.execute('same-key', ctx, handler);
// Only one handler executes. Both return the same cached result.
```

## Related Packages

- [`@reaatech/idempotency-middleware`](https://www.npmjs.com/package/@reaatech/idempotency-middleware) — Core middleware, `StorageAdapter` interface
- [`@reaatech/idempotency-middleware-express`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-express) — Express middleware
- [`@reaatech/idempotency-middleware-koa`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-koa) — Koa middleware
- [`@reaatech/idempotency-middleware-adapter-redis`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-redis) — Redis adapter
- [`@reaatech/idempotency-middleware-adapter-firestore`](https://www.npmjs.com/package/@reaatech/idempotency-middleware-adapter-firestore) — Firestore adapter

## License

[MIT](https://github.com/reaatech/idempotency-middleware/blob/main/LICENSE)
