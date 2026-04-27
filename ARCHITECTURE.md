# Architecture: Idempotency Middleware

## System Overview

The idempotency middleware is designed as a modular, framework-agnostic system that prevents duplicate execution of operations when clients retry requests. The architecture addresses four critical challenges:

1. **Concurrent Duplicate Requests** - Multiple identical requests arriving simultaneously
2. **Partial Failures** - Execution starts but crashes before completion
3. **TTL Management** - Automatic expiration of cached responses
4. **Storage Flexibility** - Support for multiple backend storage systems

---

## Core Architecture Principles

### 1. Separation of Concerns

```
┌─────────────────────────────────────────────────────────────┐
│                    Framework Layer                          │
│  (Express / Koa / Raw Handler Adapters)                     │
├─────────────────────────────────────────────────────────────┤
│                   Middleware Core                           │
│  (IdempotencyMiddleware - Orchestration Logic)              │
├─────────────────────────────────────────────────────────────┤
│              Storage & Lock Layer                           │
│  (Storage Adapters with bundled locking)                    │
│  (Redis / Firestore / DynamoDB / Memory)                    │
└─────────────────────────────────────────────────────────────┘
```

### 2. Adapter Pattern

All external dependencies (storage, locks) are abstracted behind interfaces, allowing:
- Easy testing with mock adapters
- Swapping implementations without code changes
- Supporting multiple backends simultaneously

### 3. Fail-Safe Design

- Locks have automatic TTL to prevent deadlocks
- Storage failures don't crash the application
- Partial failures are detected and cleaned up
- Graceful degradation when storage is unavailable

---

## Request Flow

### Happy Path (Cache Hit)

```
Client Request (with Idempotency-Key)
         │
         ▼
┌─────────────────────┐
│ Extract Key         │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Generate Cache Key  │ ◄── Includes: key + method + path + vary headers
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Check Storage       │
└─────────────────────┘
         │
         ▼
    ┌────┴────┐
    │  Hit?   │
    └────┬────┘
         │
    Yes  ▼
┌─────────────────────┐
│ Return Cached       │ ◄── Response + Status + Headers
│ Response            │
└─────────────────────┘
         │
         ▼
    Client Response
```

### Cache Miss with Lock

```
Client Request (with Idempotency-Key)
         │
         ▼
┌─────────────────────┐
│ Extract Key         │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Generate Cache Key  │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Check Storage       │
└─────────────────────┘
         │
         ▼
    ┌────┴────┐
    │  Hit?   │
    └────┬────┘
         │
    No   ▼
┌─────────────────────┐
│ Acquire Lock        │ ◄── Prevents concurrent execution
└─────────────────────┘
         │
    ┌────┴────┐
    │ Success?│
    └────┬────┘
         │
    Yes  ▼
┌─────────────────────┐
│ Execute Handler     │ ◄── Actual business logic
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Store in Cache      │ ◄── Response + TTL
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Release Lock        │
└─────────────────────┘
         │
         ▼
    Client Response
```

### Concurrent Request Handling

```
Request A (Key: "abc123")          Request B (Key: "abc123")
         │                                   │
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│ Generate Key    │                 │ Generate Key    │
│ -> "abc123"     │                 │ -> "abc123"     │
└─────────────────┘                 └─────────────────┘
         │                                   │
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│ Check Storage   │                 │ Check Storage   │
│ -> Miss         │                 │ -> Miss         │
└─────────────────┘                 └─────────────────┘
         │                                   │
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│ Try Lock        │                 │ Try Lock        │
│ -> Acquired ✓   │                 │ -> Waiting...   │
└─────────────────┘                 └─────────────────┘
         │                                   │
         ▼                                   │
┌─────────────────┐                         │
│ Execute Handler │                         │
│ (expensive op)  │                         │
└─────────────────┘                         │
         │                                   │
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│ Store Cache     │                 │ Lock Timeout    │
│ -> Success      │                 │ or Lock Acquired│
└─────────────────┘                 └─────────────────┘
         │                                   │
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│ Release Lock    │                 │ Check Storage   │
└─────────────────┘                 │ -> Hit ✓        │
         │                           └─────────────────┘
         ▼                                   │
    Response A                               ▼
                                       Response B
                                    (same as Response A)
```

---

## Component Design

### 1. IdempotencyMiddleware (Core Orchestrator)

**Responsibilities:**
- Extract idempotency key from request
- Generate cache key (including vary headers)
- Coordinate lock acquisition and release
- Execute handler on cache miss
- Store and retrieve cached responses
- Handle errors and cleanup

**Key Methods:**
```typescript
class IdempotencyMiddleware {
  // Main execution method
  async execute<T, R>(
    key: string,
    context: ExecutionContext,
    handler: () => Promise<R>
  ): Promise<R>;

  // Generate cache key from request
  private generateCacheKey(context: ExecutionContext): string;

  // Check if request should be processed
  private shouldProcess(context: ExecutionContext): boolean;

  // Handle concurrent request waiting
  private waitForLock(key: string): Promise<void>;
}
```

### 2. Storage Adapter Interface

**Purpose:** Abstract storage operations for cached responses

```typescript
interface StorageAdapter {
  // Get cached response
  get(key: string): Promise<IdempotencyRecord | null>;

  // Store response with TTL
  set(key: string, record: IdempotencyRecord): Promise<void>;

  // Delete cached response
  delete(key: string): Promise<void>;

  // Lifecycle management
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // --- Locking (bundled with storage for consistency) ---

  // Try to acquire lock (non-blocking)
  acquireLock(key: string, ttl: number): Promise<boolean>;

  // Release lock
  releaseLock(key: string): Promise<void>;

  // Wait for lock to be released (blocking with timeout)
  waitForLock(key: string, timeout: number, pollInterval: number): Promise<void>;
}
```

**Storage Record Structure:**
```typescript
interface IdempotencyRecord {
  response: unknown;           // The actual response body
  statusCode?: number;         // HTTP status code (framework-specific, optional)
  headers?: Record<string, string>; // Response headers (framework-specific, optional)
  createdAt: number;           // Timestamp (ms)
  ttl: number;                 // Time-to-live (ms)
}
```

### 3. Lock Adapter Interface

**Purpose:** Prevent concurrent execution of identical requests

```typescript
// Locking is bundled into StorageAdapter to prevent split-brain scenarios.
// A user cannot accidentally pair RedisStorage with MemoryLock.
```

**Lock Lifecycle:**
1. **Acquire** - First request acquires lock
2. **Hold** - Lock held during execution
3. **Release** - Lock released after caching
4. **Timeout** - Automatic release if TTL expires

### 4. Cache Key Generation

**Algorithm:**
```typescript
function generateCacheKey(options: CacheKeyOptions): string {
  const { idempotencyKey, method, path, bodyHash, varyHeaders } = options;

  // Include vary headers in key if configured
  const headerPart = varyHeaders
    ? Object.entries(varyHeaders)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&')
    : '';

  // Create hash of all components. Body hash is included by default
  // so that POST /pay {amount:100} and POST /pay {amount:1000}
  // with the same idempotency key do NOT collide.
  const keyData = `${method}:${path}:${idempotencyKey}:${bodyHash ?? ''}:${headerPart}`;
  return createHash('sha256').update(keyData).digest('hex');
}
```

**Why include method and path?**
- Same idempotency key might be used for different endpoints
- Prevents cache collisions
- Ensures correct response is returned

**Why include vary headers?**
- Different clients might need different responses
- Example: `Accept-Language` header affects response content
- Configurable per middleware instance

**Why include body hash?**
- Same idempotency key with different payloads must produce different cache entries
- Example: `POST /pay {amount:100}` and `POST /pay {amount:1000}` should not collide
- Stripe and every battle-tested idempotency implementation includes the request body
- Can be disabled via `includeBodyInKey: false` if the user intentionally wants key reuse

**Cache Key Size Limits:**
- Raw idempotency keys are validated to `maxKeyLength` (default 256 chars)
- The final cache key is always a SHA-256 hex string (64 chars), regardless of input size
- Body is hashed, not embedded directly, so large payloads don't explode key size

---

## Storage Adapter Implementations

### 1. Memory Adapter

**Use Cases:**
- Development and testing
- Single-instance applications
- Prototyping

**Implementation:**
```typescript
class MemoryAdapter implements StorageAdapter {
  private cache = new Map<string, {
    record: IdempotencyRecord;
    timeout: NodeJS.Timeout;
  }>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    
    // Check if expired
    if (Date.now() > item.record.createdAt + item.record.ttl) {
      this.delete(key);
      return null;
    }
    
    return item.record;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    // Clear existing timeout
    this.delete(key);
    
    // Set new timeout for TTL
    const timeout = setTimeout(() => {
      this.delete(key);
    }, record.ttl);
    
    this.cache.set(key, { record, timeout });
  }

  async delete(key: string): Promise<void> {
    const item = this.cache.get(key);
    if (item) {
      clearTimeout(item.timeout);
      this.cache.delete(key);
    }
  }
}
```

**Limitations:**
- Not distributed (single instance only)
- Memory leaks if TTL not properly managed
- No persistence across restarts

### 2. Redis Adapter

**Use Cases:**
- High-performance distributed systems
- Existing Redis infrastructure
- Sub-millisecond latency requirements

**Implementation:**
```typescript
class RedisAdapter implements StorageAdapter {
  constructor(private redis: Redis) {}

  async get(key: string): Promise<IdempotencyRecord | null> {
    const data = await this.redis.get(key);
    if (!data) return null;
    
    const record = JSON.parse(data);
    
    // Redis handles TTL automatically
    return record;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const ttlSeconds = Math.ceil(record.ttl / 1000);
    await this.redis.set(key, JSON.stringify(record), 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
```

**Lock Implementation (methods on RedisAdapter):**
```typescript
class RedisAdapter implements StorageAdapter {
  // ... storage methods ...

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const ttlSeconds = Math.ceil(ttl / 1000);
    const result = await this.redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(`lock:${key}`);
  }

  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const exists = await this.redis.exists(lockKey);
      if (!exists) return;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new IdempotencyError(
      IdempotencyErrorCode.LOCK_TIMEOUT,
      'Lock wait timeout exceeded'
    );
  }
}
```

**Advantages:**
- Atomic operations (SETNX)
- Built-in TTL management
- Pub/Sub for lock notifications (optional)
- High performance

### 3. Firestore Adapter

**Use Cases:**
- Google Cloud Platform integration
- Serverless architectures
- Automatic scaling requirements

**Implementation:**
```typescript
class FirestoreAdapter implements StorageAdapter {
  private collection: CollectionReference;

  constructor(firestore: Firestore, collectionName = 'idempotency_cache') {
    this.collection = firestore.collection(collectionName);
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const doc = await this.collection.doc(key).get();
    if (!doc.exists) return null;
    
    const data = doc.data()!;
    
    // Check TTL
    if (Date.now() > data.createdAt + data.ttl) {
      await this.delete(key);
      return null;
    }
    
    return {
      response: data.response,
      statusCode: data.statusCode,
      headers: data.headers,
      createdAt: data.createdAt,
      ttl: data.ttl
    };
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const expiresAt = new Date(record.createdAt + record.ttl);
    
    await this.collection.doc(key).set({
      ...record,
      expiresAt // For Firestore TTL feature
    });
  }

  async delete(key: string): Promise<void> {
    await this.collection.doc(key).delete();
  }
}
```

**Lock Implementation (methods on FirestoreAdapter):**
```typescript
class FirestoreAdapter implements StorageAdapter {
  // ... storage methods ...

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const expiresAt = Date.now() + ttl;

    try {
      await this.firestore.runTransaction(async (transaction) => {
        const docRef = this.collection.doc(lockKey);
        const doc = await transaction.get(docRef);

        if (doc.exists) {
          throw new Error('Lock exists');
        }

        transaction.set(docRef, {
          acquiredAt: Date.now(),
          expiresAt
        });
      });

      return true;
    } catch (error) {
      if ((error as Error).message === 'Lock exists') {
        return false;
      }
      throw error;
    }
  }

  async releaseLock(key: string): Promise<void> {
    await this.collection.doc(`lock:${key}`).delete();
  }

  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const doc = await this.collection.doc(lockKey).get();
      if (!doc.exists) return;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new IdempotencyError(
      IdempotencyErrorCode.LOCK_TIMEOUT,
      'Lock wait timeout exceeded'
    );
  }
}
```

**Advantages:**
- ACID transactions
- Automatic TTL with Firestore feature
- Serverless scaling
- Strong consistency

### 4. DynamoDB Adapter

**Use Cases:**
- AWS infrastructure
- High-throughput applications
- Managed NoSQL database

**Table Schema:**
```json
{
  "TableName": "idempotency-cache",
  "KeySchema": [
    {
      "AttributeName": "cacheKey",
      "KeyType": "HASH"
    }
  ],
  "AttributeDefinitions": [
    {
      "AttributeName": "cacheKey",
      "AttributeType": "S"
    }
  ],
  "TTL": {
    "AttributeName": "expiresAt",
    "Enabled": true
  }
}
```

**Implementation:**
```typescript
class DynamoDBAdapter implements StorageAdapter {
  constructor(
    private dynamodb: DynamoDBClient,
    private tableName: string = 'idempotency-cache'
  ) {}

  async get(key: string): Promise<IdempotencyRecord | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: { cacheKey: { S: key } }
    });

    const result = await this.dynamodb.send(command);
    if (!result.Item) return null;

    const item = this.unmarshall(result.Item);
    
    // Check TTL
    if (Date.now() > item.createdAt + item.ttl) {
      await this.delete(key);
      return null;
    }

    return item;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const expiresAt = Math.ceil((record.createdAt + record.ttl) / 1000);

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: this.marshall({
        cacheKey: key,
        ...record,
        expiresAt
      })
    });

    await this.dynamodb.send(command);
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: { cacheKey: { S: key } }
    });

    await this.dynamodb.send(command);
  }
}
```

**Lock Implementation (methods on DynamoDBAdapter):**
```typescript
class DynamoDBAdapter implements StorageAdapter {
  // ... storage methods ...

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const expiresAt = Date.now() + ttl;

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: this.marshall({
        cacheKey: lockKey,
        acquiredAt: Date.now(),
        expiresAt
      }),
      ConditionExpression: 'attribute_not_exists(cacheKey)'
    });

    try {
      await this.dynamodb.send(command);
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }

  async releaseLock(key: string): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: { cacheKey: { S: `lock:${key}` } }
    });
    await this.dynamodb.send(command);
  }

  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const command = new GetItemCommand({
        TableName: this.tableName,
        Key: { cacheKey: { S: lockKey } }
      });
      const result = await this.dynamodb.send(command);
      if (!result.Item) return;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new IdempotencyError(
      IdempotencyErrorCode.LOCK_TIMEOUT,
      'Lock wait timeout exceeded'
    );
  }
}
```

**Advantages:**
- Conditional writes for atomicity
- Managed TTL
- High scalability
- AWS integration

---

## Concurrent Request Handling

### The Problem

When multiple identical requests arrive simultaneously:
1. All check cache → all miss
2. All execute handler → duplicate work
3. All store response → race conditions
4. Inconsistent responses returned

### The Solution: Distributed Lock

```typescript
async function handleRequest(key: string, handler: () => Promise<Response>) {
  // 1. Check cache
  const cached = await storage.get(key);
  if (cached) return cached;

  // 2. Try to acquire lock
  const acquired = await storage.acquireLock(key, LOCK_TTL);

  if (acquired) {
    try {
      // 3. Execute handler (only one request does this)
      const response = await handler();

      // 4. Store in cache
      await storage.set(key, response);

      return response;
    } finally {
      // 5. Always release lock
      await storage.releaseLock(key);
    }
  } else {
    // 6. Wait for first request to complete
    await storage.waitForLock(key, WAIT_TIMEOUT, POLL_INTERVAL);

    // 7. Return cached response
    const cached = await storage.get(key);
    if (!cached) {
      // If the lock holder crashed before storing, the lock expired.
      // Return 409 Conflict so the client can retry with a fresh key.
      throw new IdempotencyError(
        IdempotencyErrorCode.CONFLICT,
        'Idempotency-Key In Use. The original request is still processing or failed. Please retry with a new key.'
      );
    }
    return cached;
  }
}
```

### Lock Timeout Strategy

**Lock TTL:** 30 seconds (configurable)
- Long enough for most operations
- Short enough to prevent deadlocks
- Automatically released if process crashes

**Wait Timeout:** 30 seconds (configurable)
- How long concurrent requests wait
- Should be ≥ expected handler execution time
- Returns error if timeout exceeded

**Lock Extension (Heartbeat):**
```typescript
// For long-running operations
async function executeWithHeartbeat(storage: StorageAdapter, key: string, handler: () => Promise<void>) {
  await storage.acquireLock(key, INITIAL_TTL);

  const heartbeat = setInterval(() => {
    storage.acquireLock(key, EXTEND_TTL).catch(() => {});
  }, HEARTBEAT_INTERVAL);

  try {
    await handler();
  } finally {
    clearInterval(heartbeat);
    await storage.releaseLock(key).catch(() => {});
  }
}
```

---

## Partial Failure Handling

### Failure Scenarios

1. **Handler crashes after acquiring lock**
   - Lock automatically expires (TTL)
   - Next request can acquire lock and retry

2. **Storage fails during write**
   - Lock is released
   - Next request treats as cache miss
   - Error is not cached

3. **Network partition**
   - Lock cannot be acquired
   - Request fails fast with error
   - Prevents duplicate execution

### Failure Recovery Pattern

```typescript
async function executeWithRecovery(key: string, handler: () => Promise<Response>) {
  let lockAcquired = false;

  try {
    // Check cache first
    const cached = await storage.get(key);
    if (cached) return cached;

    // Acquire lock
    lockAcquired = await storage.acquireLock(key, LOCK_TTL);
    if (!lockAcquired) {
      // Wait for lock holder to complete
      await storage.waitForLock(key, WAIT_TIMEOUT, POLL_INTERVAL);
      const cached = await storage.get(key);
      if (!cached) {
        throw new IdempotencyError(
          IdempotencyErrorCode.CONFLICT,
          'Idempotency-Key In Use. The original request is still processing or failed. Please retry with a new key.'
        );
      }
      return cached;
    }

    // Execute handler
    const response = await handler();

    // Store in cache (including error responses for true idempotency)
    await storage.set(key, response);

    return response;
  } catch (error) {
    // Don't let idempotency errors suppress the real error
    if (error instanceof IdempotencyError) throw error;

    // For handler errors, store the error response so retries
    // don't re-execute side effects (e.g., don't re-charge a card)
    if (lockAcquired) {
      await storage.set(key, {
        response: error,
        statusCode: (error as any)?.statusCode ?? 500,
        createdAt: Date.now(),
        ttl: LOCK_TTL, // Short TTL for errors
      }).catch(() => {}); // Best-effort
    }
    throw error;
  } finally {
    // Always release lock if we acquired it
    if (lockAcquired) {
      await storage.releaseLock(key).catch(console.error);
    }
  }
}
```

### Caching Policy

**Default behavior: cache ALL responses.** This is critical for idempotency — if a payment processor returns "insufficient funds", retries must return the same error, not re-attempt the charge.

```typescript
function shouldCacheResponse(response: Response): boolean {
  // Default: cache everything for true idempotency
  return true;
}
```

Users can override `shouldCache` to skip caching of transient errors (e.g., 503 Service Unavailable) if they want retries to re-attempt:

```typescript
const config = {
  shouldCache: (response) => {
    // Don't cache transient errors — let retries re-attempt
    if (response.statusCode === 503) return false;
    return true;
  }
};
```

### What NOT to Cache

```typescript
function shouldCacheResponse(response: Response): boolean {
  // Don't cache redirects
  if (response.statusCode >= 300 && response.statusCode < 400) return false;
  
  // Don't cache streaming responses
  if (response.body instanceof Readable) return false;
  
  // Don't cache if explicitly marked
  if (response.headers?.['cache-control']?.includes('no-store')) return false;
  
  return true;
}
```

---

## TTL Management

### TTL Configuration

```typescript
interface TTLConfig {
  // Default TTL for all responses
  defaultTTL: number; // 24 hours
  
  // Override TTL based on response
  getTTL?: (response: Response) => number;
  
  // Override TTL based on request
  getTTLFromRequest?: (request: Request) => number;
}
```

### TTL Strategies

**1. Fixed TTL**
```typescript
const config = {
  ttl: 24 * 60 * 60 * 1000 // 24 hours
};
```

**2. Response-Based TTL**
```typescript
const config = {
  getTTL: (response) => {
    // Cache successful responses longer
    if (response.statusCode === 200) {
      return 7 * 24 * 60 * 60 * 1000; // 7 days
    }
    return 60 * 60 * 1000; // 1 hour
  }
};
```

**3. Cache-Control Header Respect**
```typescript
const config = {
  getTTL: (response) => {
    const cacheControl = response.headers['cache-control'];
    if (cacheControl) {
      const maxAge = cacheControl.match(/max-age=(\d+)/);
      if (maxAge) {
        return parseInt(maxAge[1]) * 1000;
      }
    }
    return DEFAULT_TTL;
  }
};
```

### TTL Implementation per Adapter

**Memory:**
- `setTimeout` for each entry
- Cleared on delete or expiration

**Redis:**
- `SETEX` command sets TTL atomically
- Redis automatically deletes expired keys

**Firestore:**
- Store `expiresAt` timestamp
- Use Firestore TTL feature for automatic deletion
- Check expiration on read

**DynamoDB:**
- Store `expiresAt` Unix timestamp
- Enable DynamoDB TTL feature
- Check expiration on read

---

## Error Handling

### Error Types

```typescript
enum IdempotencyErrorCode {
  // Missing idempotency key
  KEY_REQUIRED = 'KEY_REQUIRED',
  
  // Lock acquisition timeout
  LOCK_TIMEOUT = 'LOCK_TIMEOUT',
  
  // Storage operation failed
  STORAGE_ERROR = 'STORAGE_ERROR',
  
  // Response serialization failed
  SERIALIZATION_ERROR = 'SERIALIZATION_ERROR',
  
  // Conflict with existing lock
  CONFLICT = 'CONFLICT'
}
```

### Error Recovery

```typescript
class IdempotencyError extends Error {
  constructor(
    public code: IdempotencyErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'IdempotencyError';
  }
}

// Usage
try {
  await middleware.execute(key, context, handler);
} catch (error) {
  if (error instanceof IdempotencyError) {
    switch (error.code) {
      case IdempotencyErrorCode.KEY_REQUIRED:
        // Proceed without idempotency
        return await handler();
      
      case IdempotencyErrorCode.LOCK_TIMEOUT:
        // Return conflict error to client
        return res.status(409).json({ error: 'Request in progress' });

      case IdempotencyErrorCode.CONFLICT:
        // Lock holder crashed before storing. Client must retry with a new key.
        return res.status(409).json({ error: 'Idempotency-Key In Use' });

      case IdempotencyErrorCode.STORAGE_ERROR:
        // Log and proceed without caching
        console.error('Storage error:', error);
        return await handler();
      
      default:
        throw error;
    }
  }
  throw error;
}
```

---

## Performance Considerations

### 1. Cache Key Generation

**Optimization:** Use fast hashing algorithm
```typescript
import { createHash } from 'crypto';

function generateCacheKey(components: CacheKeyComponents): string {
  const keyString = JSON.stringify(components);
  return createHash('sha256').update(keyString).digest('hex');
}
```

### 2. Lock Waiting Strategy

**Optimization:** Exponential backoff
```typescript
async function waitWithBackoff(key: string, timeout: number) {
  const startTime = Date.now();
  let delay = 10; // Start with 10ms
  
  while (Date.now() - startTime < timeout) {
    const acquired = await storage.acquireLock(key, LOCK_TTL);
    if (acquired) return;
    
    await sleep(delay);
    delay = Math.min(delay * 2, 1000); // Cap at 1 second
  }
  
  throw new Error('Lock timeout');
}
```

### 3. Storage Optimization

**Redis Pipeline:**
```typescript
async function batchGet(keys: string[]): Promise<IdempotencyRecord[]> {
  const pipeline = redis.pipeline();
  keys.forEach(key => pipeline.get(key));
  const results = await pipeline.exec();
  return results.map(r => JSON.parse(r));
}
```

### 4. Memory Usage

**Memory Adapter Limits:**
```typescript
class MemoryAdapter implements StorageAdapter {
  private maxEntries = 10000;
  
  async set(key: string, record: IdempotencyRecord) {
    if (this.cache.size >= this.maxEntries) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.delete(oldestKey);
    }
    // ... rest of implementation
  }
}
```

---

## Security Considerations

### 1. Key Validation

```typescript
function validateIdempotencyKey(key: string, maxLength = 256): boolean {
  // Must be non-empty
  if (!key || key.trim() === '') return false;

  // Maximum length (prevent DoS via oversized keys)
  if (key.length > maxLength) return false;

  // Reject keys that look like injection attempts
  if (key.includes('\0') || key.includes('\n')) return false;

  return true;
}
```

### 2. Response Sanitization

```typescript
function sanitizeForCache(response: Response): Response {
  // Remove sensitive headers
  const { authorization, cookie, 'set-cookie': _, ...headers } = response.headers;
  
  // Ensure response is serializable
  try {
    JSON.stringify(response.body);
  } catch {
    throw new IdempotencyError(
      IdempotencyErrorCode.SERIALIZATION_ERROR,
      'Response body is not serializable'
    );
  }
  
  return { ...response, headers };
}
```

### 3. Rate Limiting Integration

```typescript
// Don't cache rate-limited responses
function shouldCacheResponse(response: Response): boolean {
  if (response.statusCode === 429) return false;
  return true;
}
```

---

## Monitoring & Observability

### Metrics to Track

```typescript
interface IdempotencyMetrics {
  // Cache performance
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  
  // Lock performance
  lockAcquisitions: number;
  lockTimeouts: number;
  lockWaits: number;
  
  // Storage performance
  storageErrors: number;
  storageLatency: number[];
  
  // Request metrics
  duplicateRequests: number;
  uniqueRequests: number;
}
```

### Logging

```typescript
const logger = {
  cacheHit: (key: string, latency: number) => {
    console.log(`[Idempotency] Cache hit: ${key} (${latency}ms)`);
  },
  
  cacheMiss: (key: string) => {
    console.log(`[Idempotency] Cache miss: ${key}`);
  },
  
  lockAcquired: (key: string) => {
    console.log(`[Idempotency] Lock acquired: ${key}`);
  },
  
  lockTimeout: (key: string) => {
    console.warn(`[Idempotency] Lock timeout: ${key}`);
  },
  
  storageError: (error: Error, key: string) => {
    console.error(`[Idempotency] Storage error for ${key}:`, error);
  }
};
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('IdempotencyMiddleware', () => {
  it('should return cached response on cache hit', async () => {
    const storage = new MockStorage();
    storage.get.mockResolvedValue(cachedResponse);
    
    const middleware = new IdempotencyMiddleware(storage);
    const result = await middleware.execute(key, context, handler);
    
    expect(result).toEqual(cachedResponse);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should execute handler and cache on cache miss', async () => {
    const storage = new MockStorage();
    storage.get.mockResolvedValue(null);
    
    const middleware = new IdempotencyMiddleware(storage);
    await middleware.execute(key, context, handler);
    
    expect(handler).toHaveBeenCalled();
    expect(storage.set).toHaveBeenCalled();
  });

  it('should handle concurrent requests correctly', async () => {
    const lock = new MockLock();
    storage.acquireLock.mockImplementation(async (key) => {
      if (key === 'first') {
        await sleep(100); // Simulate work
        return true;
      }
      return false; // Second request waits
    });
    
    // Test implementation...
  });
});
```

### Integration Tests

```typescript
describe('Redis Adapter Integration', () => {
  let redis: Redis;
  let adapter: RedisAdapter;

  beforeAll(async () => {
    redis = new Redis();
    adapter = new RedisAdapter(redis);
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('should store and retrieve responses', async () => {
    const record: IdempotencyRecord = {
      response: { data: 'test' },
      statusCode: 200,
      headers: {},
      createdAt: Date.now(),
      ttl: 60000
    };

    await adapter.set('test-key', record);
    const retrieved = await adapter.get('test-key');

    expect(retrieved).toEqual(record);
  });
});
```

### E2E Tests

```typescript
describe('Express Middleware E2E', () => {
  let app: Express;
  let server: http.Server;

  beforeAll(() => {
    app = express();
    const adapter = new MemoryAdapter();
    app.use(idempotentExpress(adapter));
    
    app.post('/api/resource', (req, res) => {
      res.json({ id: 1, name: 'Test' });
    });
    
    server = app.listen(3001);
  });

  afterAll((done) => {
    server.close(done);
  });

  it('should return same response for duplicate requests', async () => {
    const key = 'unique-key-123';
    
    const [response1, response2] = await Promise.all([
      fetch('http://localhost:3001/api/resource', {
        method: 'POST',
        headers: { 'Idempotency-Key': key }
      }),
      fetch('http://localhost:3001/api/resource', {
        method: 'POST',
        headers: { 'Idempotency-Key': key }
      })
    ]);

    const body1 = await response1.json();
    const body2 = await response2.json();

    expect(body1).toEqual(body2);
  });
});
```

---

## Conclusion

This architecture provides a robust, scalable solution for idempotency in distributed systems. Key strengths:

1. **Modular Design** - Easy to extend with new adapters
2. **Battle-Tested Pattern** - Proven approach used in production
3. **Framework Agnostic** - Works with any Node.js framework
4. **Production Ready** - Handles edge cases and failures
5. **Type Safe** - Full TypeScript support
6. **Well Documented** - Comprehensive examples and guides

The implementation addresses all four critical challenges:
- ✅ Concurrent duplicate requests (distributed locks)
- ✅ Partial failures (automatic cleanup)
- ✅ TTL management (adapter-specific implementations)
- ✅ Storage flexibility (4 production-ready adapters)
