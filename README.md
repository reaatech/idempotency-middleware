# idempotency-middleware

[![CI](https://github.com/reaatech/idempotency-middleware/actions/workflows/ci.yml/badge.svg)](https://github.com/reaatech/idempotency-middleware/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> Framework-agnostic idempotency middleware for TypeScript. Make `POST`, `PUT`, and `PATCH` requests safe to retry — duplicate requests with the same `Idempotency-Key` header return the cached original response without re-executing side effects.

This monorepo provides a core middleware library, storage adapters for Redis/DynamoDB/Firestore, and framework integrations for Express and Koa.

## Features

- **Pluggable storage** — in-memory (default), Redis, DynamoDB, and Firestore backends behind a single `StorageAdapter` interface
- **Distributed locking** — bundled lock primitives prevent concurrent handler execution for the same idempotency key across all storage backends
- **True idempotency** — both successes and errors are cached; a failed mutation returns the original error on retry
- **Framework adapters** — first-class Express and Koa middleware, plus a generic `idempotentHandler` for Lambda, queue consumers, and gRPC
- **Body-aware cache keys** — SHA-256 body hashes differentiate requests with the same key but different payloads
- **Vary header support** — include select request headers in cache keys for content negotiation
- **Zero-config core** — `MemoryAdapter` requires no dependencies and works immediately after `connect()`
- **Dual ESM/CJS output** — works with `import` and `require`, targets Node.js 18+

## Installation

### Using the packages

Packages are published under the `@reaatech` scope and can be installed individually:

```bash
# Core middleware (zero-dependency)
npm install @reaatech/idempotency-middleware

# Express middleware
npm install @reaatech/idempotency-middleware-express

# Koa middleware
npm install @reaatech/idempotency-middleware-koa

# Storage adapters
npm install @reaatech/idempotency-middleware-adapter-redis ioredis
npm install @reaatech/idempotency-middleware-adapter-dynamodb @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
npm install @reaatech/idempotency-middleware-adapter-firestore @google-cloud/firestore
```

### Contributing

```bash
# Clone the repository
git clone https://github.com/reaatech/idempotency-middleware.git
cd idempotency-middleware

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the test suite
pnpm test

# Run type checking
pnpm typecheck
```

## Quick Start

### Express

```typescript
import express from 'express';
import { MemoryAdapter } from '@reaatech/idempotency-middleware';
import { idempotentExpress } from '@reaatech/idempotency-middleware-express';

const adapter = new MemoryAdapter();
await adapter.connect();

const app = express();
app.use(express.json());
app.use(idempotentExpress(adapter));

let counter = 0;
app.post('/charges', (req, res) => {
  res.status(201).json({ id: ++counter, amount: req.body.amount });
});

app.listen(3000);
```

### Koa

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

### Raw Handler (Lambda, Queues, gRPC)

```typescript
import { idempotentHandler, MemoryAdapter } from '@reaatech/idempotency-middleware';

const storage = new MemoryAdapter();
await storage.connect();

const handler = idempotentHandler(
  storage,
  async (event) => ({ processed: true }),
  { ttl: 3_600_000 },
);

// Call with input, idempotency key, and optional context
const result = await handler(payload, 'unique-key-abc', {
  method: 'POST',
  path: '/webhook',
});
```

See the [`examples/`](./examples/) directory for complete working samples.

## Packages

| Package | Description |
|---|---|
| [`@reaatech/idempotency-middleware`](./packages/core) | Core middleware, `MemoryAdapter`, `StorageAdapter` interface, utilities |
| [`@reaatech/idempotency-middleware-express`](./packages/express) | Express middleware adapter |
| [`@reaatech/idempotency-middleware-koa`](./packages/koa) | Koa middleware adapter |
| [`@reaatech/idempotency-middleware-adapter-redis`](./packages/adapter-redis) | Redis storage adapter (ioredis) |
| [`@reaatech/idempotency-middleware-adapter-dynamodb`](./packages/adapter-dynamodb) | DynamoDB storage adapter (AWS SDK v3) |
| [`@reaatech/idempotency-middleware-adapter-firestore`](./packages/adapter-firestore) | Firestore storage adapter (GCP Firestore) |

## How It Works

```
Client sends POST /charges with Idempotency-Key: abc-123
                    │
                    ▼
         ┌─────────────────────┐
         │  Cache key lookup   │
         │  (SHA-256 hash of   │
         │   method + path +   │
         │   key + body hash)  │
         └─────────┬───────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   Cache hit              Cache miss
   Return cached          Acquire lock
   response               ──┬──
                       ┌─────┴─────┐
                       ▼           ▼
                  Lock acquired  Lock held
                  Double-check   Wait for lock
                  cache ──┬──    then return
                  ┌───────┴──────┐  cached response
                  ▼              ▼     or 409
             Still empty     Has data
             Execute handler Replay it
             Cache result
             Release lock
```

## Configuration

All configuration flows through `IdempotencyConfig`:

```typescript
{
  headerName: 'Idempotency-Key',  // Header to extract key from
  ttl: 86400000,                   // Cache TTL (24h default)
  methods: ['POST', 'PUT', 'PATCH'], // Methods to apply idempotency to
  includeBodyInKey: true,          // Hash request body into cache key
  maxKeyLength: 256,               // Max idempotency key length
  lockTimeout: 30000,              // Max wait for lock (30s)
  lockTtl: 30000,                  // Lock auto-expiry
  lockPollInterval: 100,           // Lock check interval (ms)
  varyHeaders: [],                 // Headers to include in cache key
  getKey: (req) => string,         // Custom key extraction function
  shouldCache: (res) => boolean,   // Filter which responses to cache
}
```

## Error Handling

All idempotency errors use the typed `IdempotencyError` class with structured error codes:

| Code | HTTP Status | Description |
|---|---|---|
| `KEY_REQUIRED` | 400 | Missing or empty idempotency key |
| `LOCK_TIMEOUT` | 409 | Lock acquisition/wait exceeded timeout |
| `CONFLICT` | 409 | Lock holder crashed without storing a response |
| `STORAGE_ERROR` | 503 | Storage operation failed |
| `SERIALIZATION_ERROR` | 500 | Response serialization failed |
| `INVALID_CONFIG` | 500 | Misconfigured middleware |
| `NOT_CONNECTED` | 500 | Adapter used before `connect()` |

Both the Express and Koa adapters support custom error handlers via the `errorHandler` config option.

## Choosing a Storage Adapter

| Adapter | Use Case |
|---|---|
| `MemoryAdapter` | Development, testing, single-process apps |
| `RedisAdapter` | Multi-process deployments, low-latency distributed locking |
| `DynamoDBAdapter` | Serverless (Lambda), AWS-native deployments |
| `FirestoreAdapter` | GCP-native deployments, strong consistency |

All adapters implement the same `StorageAdapter` interface — swap them without changing application code.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — System design, package relationships, and data flows
- [`AGENTS.md`](./AGENTS.md) — Coding conventions and development guidelines
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Contribution workflow and release process


## License

[MIT](LICENSE)
