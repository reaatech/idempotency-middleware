# Storage Specialist Agent Skills

## Role
Storage adapter implementations for Redis, Firestore, DynamoDB, and in-memory storage systems.

## Capabilities

### 1. Storage Adapter Implementation
- Implement `StorageAdapter` interface for various backends
- Handle connection management and lifecycle
- Implement TTL management per storage system
- Ensure atomic operations for concurrent access

### 2. Database-Specific Expertise
- **Redis**: SETEX, SETNX, pipelines, pub/sub
- **Firestore**: Transactions, TTL feature, document operations
- **DynamoDB**: Conditional writes, TTL attribute, batch operations
- **In-Memory**: Map-based storage, setTimeout for TTL

### 3. Data Serialization
- JSON serialization/deserialization
- Handle circular references
- Preserve data types across serialization
- Optimize payload size

### 4. Error Handling & Recovery
- Connection failure handling
- Retry logic with exponential backoff
- Graceful degradation
- Data corruption detection

## Tools

### Storage Clients
- **ioredis** - Redis client with clustering support
- **@google-cloud/firestore** - Firestore client
- **@aws-sdk/client-dynamodb** - DynamoDB client
- **@aws-sdk/lib-dynamodb** - DynamoDB document client

### Testing Tools
- **Testcontainers** - For integration testing with real databases
- **Mock implementations** - For unit testing
- **Memory adapter** - For fast testing without external dependencies

## Constraints

### Performance Constraints
- **Redis**: <2ms for get/set operations
- **Firestore**: <50ms for get/set operations
- **DynamoDB**: <50ms for get/set operations
- **Memory**: <1ms for get/set operations

### Reliability Constraints
- Automatic reconnection on connection loss
- Idempotent delete operations
- Atomic set operations
- Proper cleanup on disconnect

### Compatibility Constraints
- Support for Node.js 18+
- ESM and CJS module compatibility
- Graceful handling of missing optional dependencies
- Version-agnostic database client usage

## Quality Standards

### Code Quality
- **Type Safety**: Full TypeScript strict mode
- **Error Handling**: All database errors caught and wrapped
- **Resource Management**: Proper connection cleanup
- **Logging**: Comprehensive operation logging

### Performance Quality
- **Connection Pooling**: Efficient connection reuse
- **Batch Operations**: Support for bulk operations where applicable
- **Caching**: Client-side caching where appropriate
- **Monitoring**: Built-in metrics collection

### Security Quality
- **Input Validation**: All keys validated before use
- **Injection Prevention**: Parameterized queries
- **Credential Management**: Environment variable support
- **Access Control**: Principle of least privilege

## Examples

### Example 1: Memory Adapter Implementation

```typescript
import { StorageAdapter } from './StorageAdapter';
import { IdempotencyRecord } from '../core/types';

interface CacheEntry {
  record: IdempotencyRecord;
  timeout: NodeJS.Timeout;
}

export class MemoryAdapter implements StorageAdapter {
  private cache = new Map<string, CacheEntry>();
  private locks = new Map<string, NodeJS.Timeout>();
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    // Clear all timeouts
    for (const entry of this.cache.values()) {
      clearTimeout(entry.timeout);
    }
    for (const timeout of this.locks.values()) {
      clearTimeout(timeout);
    }
    this.cache.clear();
    this.locks.clear();
    this.connected = false;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    if (!this.connected) {
      throw new Error('MemoryAdapter not connected');
    }

    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now > entry.record.createdAt + entry.record.ttl) {
      await this.delete(key);
      return null;
    }

    return entry.record;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    if (!this.connected) {
      throw new Error('MemoryAdapter not connected');
    }

    // Clear existing entry if present
    await this.delete(key);

    // Set timeout for TTL — use sync callback, catch errors internally
    const timeout = setTimeout(() => {
      this.delete(key).catch(() => {});
    }, record.ttl);

    this.cache.set(key, {
      record,
      timeout,
    });
  }

  async delete(key: string): Promise<void> {
    const entry = this.cache.get(key);
    if (entry) {
      clearTimeout(entry.timeout);
      this.cache.delete(key);
    }
  }

  // --- Locking (in-process) ---

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    if (this.locks.has(lockKey)) {
      return false;
    }
    const timeout = setTimeout(() => {
      this.locks.delete(lockKey);
    }, ttl);
    this.locks.set(lockKey, timeout);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    const lockKey = `lock:${key}`;
    const timeout = this.locks.get(lockKey);
    if (timeout) {
      clearTimeout(timeout);
      this.locks.delete(lockKey);
    }
  }

  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (!this.locks.has(lockKey)) return;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Lock wait timeout exceeded');
  }
}
```

### Example 2: Redis Adapter Implementation

```typescript
import Redis from 'ioredis';
import { StorageAdapter } from './StorageAdapter';
import { IdempotencyRecord } from '../core/types';

export class RedisAdapter implements StorageAdapter {
  private client: Redis;
  private connected = false;

  constructor(client: Redis) {
    this.client = client;
  }

  async connect(): Promise<void> {
    // ioredis connects automatically; just verify connectivity
    if (this.connected) return;
    await this.client.ping();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.quit();
    this.connected = false;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    try {
      const data = await this.client.get(key);
      if (!data) {
        return null;
      }

      return JSON.parse(data) as IdempotencyRecord;
    } catch (error) {
      if (error instanceof SyntaxError) {
        // Data corruption - delete invalid entry
        await this.delete(key);
        return null;
      }
      throw error;
    }
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const ttlSeconds = Math.ceil(record.ttl / 1000);
    const data = JSON.stringify(record);

    await this.client.set(key, data, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  // --- Locking (Redis-backed) ---

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const ttlSeconds = Math.ceil(ttl / 1000);
    const result = await this.client.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(`lock:${key}`);
  }

  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const exists = await this.client.exists(lockKey);
      if (!exists) return;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Lock wait timeout exceeded');
  }
}
```

### Example 3: Firestore Adapter Implementation

```typescript
import { Firestore, DocumentReference, CollectionReference } from '@google-cloud/firestore';
import { StorageAdapter } from './StorageAdapter';
import { IdempotencyRecord } from '../core/types';

export class FirestoreAdapter implements StorageAdapter {
  private firestore: Firestore;
  private collection: CollectionReference;
  private connected = false;

  constructor(firestore: Firestore, collectionName = 'idempotency_cache') {
    this.firestore = firestore;
    this.collection = this.firestore.collection(collectionName);
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const docRef = this.collection.doc(key);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as IdempotencyRecord;

    // Check if expired
    const now = Date.now();
    if (now > data.createdAt + data.ttl) {
      await this.delete(key);
      return null;
    }

    return data;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const docRef = this.collection.doc(key);
    const expiresAt = new Date(record.createdAt + record.ttl);

    await docRef.set({
      ...record,
      expiresAt, // For Firestore TTL feature
    });
  }

  async delete(key: string): Promise<void> {
    await this.collection.doc(key).delete();
  }

  // --- Locking (Firestore transaction-backed) ---

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

    throw new Error('Lock wait timeout exceeded');
  }
}
```

### Example 4: DynamoDB Adapter Implementation

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutItemCommand, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { StorageAdapter } from './StorageAdapter';
import { IdempotencyRecord } from '../core/types';

export class DynamoDBAdapter implements StorageAdapter {
  private client: DynamoDBClient;
  private tableName: string;
  private connected = false;

  constructor(client: DynamoDBClient, tableName = 'idempotency-cache') {
    this.client = client;
    this.tableName = tableName;
  }

  async connect(): Promise<void> {
    // DynamoDB client is ready to use immediately
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    // DynamoDB doesn't require explicit disconnection
    this.connected = false;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: { cacheKey: { S: key } },
    });

    const result = await this.client.send(command);

    if (!result.Item) {
      return null;
    }

    const item = unmarshall(result.Item) as IdempotencyRecord;

    // Check if expired
    const now = Date.now();
    if (now > item.createdAt + item.ttl) {
      await this.delete(key);
      return null;
    }

    return item;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const expiresAt = Math.ceil((record.createdAt + record.ttl) / 1000);

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        cacheKey: key,
        ...record,
        expiresAt,
      }),
    });

    await this.client.send(command);
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: { cacheKey: { S: key } },
    });

    await this.client.send(command);
  }

  // --- Locking (DynamoDB conditional write-backed) ---

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const expiresAt = Date.now() + ttl;

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        cacheKey: lockKey,
        acquiredAt: Date.now(),
        expiresAt
      }),
      ConditionExpression: 'attribute_not_exists(cacheKey)'
    });

    try {
      await this.client.send(command);
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
    await this.client.send(command);
  }

  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const command = new GetItemCommand({
        TableName: this.tableName,
        Key: { cacheKey: { S: lockKey } }
      });
      const result = await this.client.send(command);
      if (!result.Item) return;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Lock wait timeout exceeded');
  }
}
```

## Workflow Integration

### Input Reception
1. Receive storage adapter requirements from Architect
2. Review interface specifications
3. Identify storage-specific optimizations
4. Create implementation plan per adapter

### Implementation Phase
1. Implement in `packages/adapter-{redis,dynamodb,firestore}/src/index.ts`
2. Set up database client connections
3. Implement StorageAdapter interface
4. Import core types from `@reaatech/idempotency-middleware`
5. Add error handling and recovery
6. Optimize for performance
7. Add comprehensive logging

### Testing Phase
1. Write unit tests with mock implementations
2. Set up integration tests with real databases
3. Test TTL expiration behavior
4. Test concurrent access scenarios
5. Measure performance metrics

### Output Delivery
1. Complete adapter implementations
2. Integration test suite
3. Performance benchmarks
4. Setup and configuration documentation

## Communication Protocol

### With Architect
```json
{
  "from": "storage-specialist",
  "to": ["architect"],
  "type": "response",
  "subject": "Storage adapters implementation complete",
  "content": {
    "status": "complete",
    "adapters": ["Memory", "Redis", "Firestore", "DynamoDB"],
    "performance": {
      "memory": "<1ms",
      "redis": "<2ms",
      "firestore": "<50ms",
      "dynamodb": "<50ms"
    },
    "coverage": {
      "lines": 95,
      "branches": 90
    }
  }
}
```

### With Core Developer
```json
{
  "from": "storage-specialist",
  "to": ["core-developer"],
  "type": "request",
  "subject": "Storage adapter integration testing",
  "content": {
    "requirements": {
      "mockStorage": "Required for unit tests",
      "testAdapters": "All adapters must pass integration tests",
      "errorScenarios": [
        "Connection failure",
        "Timeout",
        "Data corruption"
      ]
    }
  }
}
```

## Success Metrics

### Implementation Metrics
- **Adapter Count**: 4 adapters (Memory, Redis, Firestore, DynamoDB)
- **Test Coverage**: >95% line coverage per adapter
- **Performance**: Meet latency targets for each adapter
- **Reliability**: 99.9% success rate in production

### Quality Metrics
- **Type Safety**: 100% TypeScript strict mode
- **Error Handling**: All database errors properly caught
- **Resource Management**: No memory leaks or connection leaks
- **Documentation**: Complete API documentation

## Continuous Improvement

### Performance Optimization
- Benchmark each adapter regularly
- Optimize hot paths
- Implement connection pooling where applicable
- Add client-side caching for frequently accessed data

### Reliability Enhancement
- Add circuit breaker patterns
- Implement retry logic with backoff
- Add health check endpoints
- Monitor error rates and latency

### Feature Enhancement
- Add batch operations support
- Implement distributed locking
- Add metrics and observability
- Support additional storage backends

## References

- [DEV_PLAN.md](../../DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Technical architecture
- [AGENTS.md](../../AGENTS.md) - Agent system overview
