# @reaatech/idempotency-middleware

[![npm version](https://img.shields.io/npm/v/%40reaatech%2Fidempotency-middleware)](https://www.npmjs.com/package/@reaatech/idempotency-middleware)
[![license](https://img.shields.io/npm/l/%40reaatech%2Fidempotency-middleware)](./LICENSE)
[![node](https://img.shields.io/node/v/%40reaatech%2Fidempotency-middleware)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%23007ACC)](https://www.typescriptlang.org/)

Framework-agnostic idempotency middleware for TypeScript and Node.js. Makes `POST`, `PUT`, and `PATCH` requests safe to retry by caching responses keyed by the `Idempotency-Key` header so that repeated requests produce the same result without re-executing side effects.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Express](#express)
  - [Koa](#koa)
  - [Raw Handler (any framework)](#raw-handler-any-framework)
- [Storage Adapters](#storage-adapters)
- [Configuration](#configuration)
- [Error Handling](#error-handling)
- [How It Works](#how-it-works)
- [Compatibility](#compatibility)
- [License](#license)

## Features

- **Pluggable storage** — in-memory (default), Redis, DynamoDB, and Firestore adapters, all implementing a common interface.
- **Framework adapters** — first-class Express and Koa middleware, plus a generic `idempotentHandler` wrapper that works with any runtime (Lambda functions, queue consumers, gRPC services, etc.).
- **Distributed locking** — when concurrent requests share the same idempotency key, only the first executes the handler. All others wait and receive the same cached response.
- **True idempotency** — both successes and errors are cached. A failed mutation (e.g. insufficient funds) returns the original error on retry instead of re-executing.
- **Zero-config core** — the `MemoryAdapter` requires no external dependencies and works immediately after `await adapter.connect()`.
- **Strict TypeScript** — full type definitions with no `any`, targeting ES2022, requires Node.js 18+.

## Installation

```bash
npm install @reaatech/idempotency-middleware
```

The core package ships with the `MemoryAdapter` and requires no additional dependencies. Install peer packages only for the storage backend(s) you use:

```bash
npm install ioredis                                           # Redis
npm install @aws-sdk/client-dynamodb \                        # DynamoDB
           @aws-sdk/util-dynamodb \
           @aws-sdk/lib-dynamodb
npm install @google-cloud/firestore                           # Firestore
```

> Express and Koa are optional peer dependencies. To use a framework adapter, `express` or `koa` must already be installed in your project.

## Quick Start

### Express

```ts
import express from "express";
import { MemoryAdapter } from "@reaatech/idempotency-middleware";
import { idempotentExpress } from "@reaatech/idempotency-middleware/express";

const adapter = new MemoryAdapter();
await adapter.connect();

const app = express();
app.use(express.json());
app.use(idempotentExpress(adapter, { ttl: 24 * 60 * 60 * 1000 }));

app.post("/charges", (req, res) => {
  res.status(201).json({ id: createCharge(req.body) });
});
```

```bash
curl -XPOST http://localhost:3000/charges \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-42" \
  -d '{"amount": 100}'
# Subsequent requests with the same Idempotency-Key return the cached
# 201 + body without re-executing the handler.
```

### Koa

```ts
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import Redis from "ioredis";
import { RedisAdapter } from "@reaatech/idempotency-middleware/redis";
import { idempotentKoa } from "@reaatech/idempotency-middleware/koa";

const adapter = new RedisAdapter(new Redis(process.env.REDIS_URL));
await adapter.connect();

const app = new Koa();
app.use(bodyParser());
app.use(idempotentKoa(adapter));

app.use(async (ctx) => {
  if (ctx.method === "POST" && ctx.path === "/charges") {
    ctx.status = 201;
    ctx.body = { id: await createCharge(ctx.request.body) };
  }
});
```

### Raw Handler (any framework)

`idempotentHandler` wraps any async function, making it safe to retry with the same key — ideal for Lambda handlers, queue consumers, gRPC services, and other non-HTTP runtimes.

```ts
import { MemoryAdapter, idempotentHandler } from "@reaatech/idempotency-middleware";

const adapter = new MemoryAdapter();
await adapter.connect();

const charge = idempotentHandler(
  adapter,
  async (input: { amount: number }) => {
    return { id: await createCharge(input) };
  },
);

await charge({ amount: 100 }, "order-42");
await charge({ amount: 100 }, "order-42"); // cache hit, handler not invoked
```

## Storage Adapters

| Adapter            | Import path | Peer dependency |
|--------------------|-------------|----------------|
| `MemoryAdapter`    | `@reaatech/idempotency-middleware` | _none_ |
| `RedisAdapter`     | `@reaatech/idempotency-middleware/redis` | `ioredis` |
| `DynamoDBAdapter`  | `@reaatech/idempotency-middleware/dynamodb` | `@aws-sdk/client-dynamodb`, `@aws-sdk/util-dynamodb`, `@aws-sdk/lib-dynamodb` |
| `FirestoreAdapter` | `@reaatech/idempotency-middleware/firestore` | `@google-cloud/firestore` |

Each adapter implements the same `StorageAdapter` interface, so swapping backends is a one-line change.

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBAdapter } from "@reaatech/idempotency-middleware/dynamodb";

const adapter = new DynamoDBAdapter(
  new DynamoDBClient({ region: "us-east-1" }),
  "idempotency-cache", // table name (default: "idempotency-cache")
);
```

DynamoDB table prerequisites: partition key `cacheKey` (String). Optionally enable DynamoDB TTL on the `expiresAt` attribute (numeric, epoch seconds) for automatic eviction.

Firestore prerequisites: collection name defaults to `idempotency_cache`. Configure a Firestore TTL policy on the `expiresAt` field for automatic eviction.

## Configuration

All framework adapters accept the same options:

```ts
interface IdempotencyConfig {
  /** Header to read the key from. Default: "Idempotency-Key" */
  headerName?: string;

  /** Cache lifetime in ms. Default: 24h */
  ttl?: number;

  /** HTTP methods to apply idempotency to. Default: POST, PUT, PATCH */
  methods?: string[];

  /** Custom key extractor. Falls back to header. */
  getKey?: (request: unknown) => string | undefined;

  /** Decide whether to cache a particular response. Default: cache everything. */
  shouldCache?: (response: unknown) => boolean;

  /** Headers that vary the response (added to cache key). */
  varyHeaders?: string[];

  /** Hash the request body into the cache key. Default: true. */
  includeBodyInKey?: boolean;

  /** Max idempotency-key length. Default: 256 chars. */
  maxKeyLength?: number;

  /**
   * Max time (ms) a duplicate request will wait for the original to finish.
   * Throws IdempotencyError(LOCK_TIMEOUT) on expiry. Default: 30s.
   */
  lockTimeout?: number;

  /**
   * How long an acquired lock stays valid (ms). Should be greater than the
   * worst-case handler runtime. Defaults to lockTimeout.
   */
  lockTtl?: number;

  /** Lock polling interval (ms). Default: 100. */
  lockPollInterval?: number;
}
```

### Skipping cache for certain responses

```ts
idempotentExpress(adapter, {
  shouldCache: (body) => {
    // Allow retries for transient errors (e.g. 503, rate limits).
    if (body instanceof Error) return false;
    return true;
  },
});
```

### Custom key extraction

```ts
idempotentExpress(adapter, {
  getKey: (req) => `${req.user.id}:${req.headers["idempotency-key"]}`,
});
```

## Error Handling

All errors thrown by the library extend `IdempotencyError` and expose a `code` property and a suggested HTTP status:

| Code                  | HTTP | Meaning                                                  |
| --------------------- | ---- | -------------------------------------------------------- |
| `KEY_REQUIRED`        | 400  | Missing or oversized key                                 |
| `LOCK_TIMEOUT`        | 409  | Waited too long for original request to finish          |
| `CONFLICT`            | 409  | Lock holder finished without storing a response         |
| `STORAGE_ERROR`       | 503  | Underlying storage adapter failed                        |
| `SERIALIZATION_ERROR` | 500  | Could not serialize the response for caching             |
| `INVALID_CONFIG`      | 500  | Bad config supplied                                      |
| `NOT_CONNECTED`       | 500  | `adapter.connect()` was never awaited                    |

Express adapter accepts a custom `errorHandler`; Koa adapter falls back to a JSON `{ error, code }` body if none is provided.

## How It Works

1. Request arrives with an `Idempotency-Key` header.
2. The middleware computes a SHA-256 cache key from `(method, path, key, body, varyHeaders)`.
3. If the cache hits, the stored response is replayed.
4. Otherwise the middleware acquires a distributed lock for that cache key.
5. If the lock can't be acquired (a duplicate is already running), it polls until the lock releases, then returns the cached response.
6. On the leader's first run, the response (success **or** error) is stored under the cache key for the configured TTL, and the lock is released.

Errors are serialized with a tag so they survive JSON-only storage backends and are reconstructed as real `Error` instances on read.

## Compatibility

- **Node.js 18+**
- **TypeScript 5.x** (works without TS too — full `.d.ts` shipped)
- **ESM and CJS** dual package

## License

MIT — see [LICENSE](./LICENSE).
