# Test Engineer Agent Skills

## Role
Comprehensive testing strategy implementation including unit, integration, and E2E tests for the idempotency middleware.

## Capabilities

### 1. Test Strategy Design
- Design comprehensive test coverage plans
- Create test hierarchies (unit → integration → E2E)
- Define test data strategies
- Establish test environment requirements

### 2. Unit Testing
- Write isolated unit tests for each component
- Create mock implementations for dependencies
- Test edge cases and error scenarios
- Achieve >90% code coverage

### 3. Integration Testing
- Test component interactions
- Test storage adapter integrations
- Test lock coordination
- Test framework integrations

### 4. E2E Testing
- Test complete request/response flows
- Test concurrent request scenarios
- Test real-world use cases
- Test error recovery

## Tools

### Testing Frameworks
- **Vitest 3** - Fast unit test framework (co-located `*.test.ts`)
- **@vitest/coverage-v8** - Code coverage analysis (per-package thresholds: 90/85/90/90)
- **supertest** - HTTP assertion library for Express/Koa E2E tests
- **Turborepo** - Orchestrates `turbo run test` across all packages

### Mocking Tools
- **Vitest mocks** - Built-in `vi.fn()` and `vi.mock()`
- **In-memory adapter** - For fast testing without external dependencies

## Constraints

### Coverage Constraints
- Line coverage: >90%
- Branch coverage: >85%
- Function coverage: >90%
- Statement coverage: >90%

### Performance Constraints
- Unit tests: <5 seconds total
- Integration tests: <30 seconds total
- E2E tests: <60 seconds total
- No flaky tests

### Quality Constraints
- All tests must be deterministic
- Tests must be independent
- Tests must be maintainable
- Tests must have clear assertions

## Quality Standards

### Test Quality
- **Isolation**: Each test is independent
- **Clarity**: Test intent is clear
- **Maintainability**: Easy to update tests
- **Reliability**: No flaky tests

### Coverage Quality
- **Critical Paths**: All critical paths tested
- **Edge Cases**: Edge cases covered
- **Error Scenarios**: Error handling tested
- **Integration Points**: All integrations tested

### Documentation Quality
- **Test Descriptions**: Clear test descriptions
- **Assertions**: Clear assertion messages
- **Setup**: Clear test setup
- **Teardown**: Proper cleanup

## Examples

### Example 1: Unit Test for IdempotencyMiddleware

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IdempotencyMiddleware } from '../IdempotencyMiddleware';
import { StorageAdapter } from '../../adapters/StorageAdapter';
import { IdempotencyError, IdempotencyErrorCode } from '../IdempotencyError';

describe('IdempotencyMiddleware', () => {
  let storage: StorageAdapter;
  let middleware: IdempotencyMiddleware;

  beforeEach(() => {
    storage = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      acquireLock: vi.fn().mockResolvedValue(true),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      waitForLock: vi.fn().mockResolvedValue(undefined),
    };

    middleware = new IdempotencyMiddleware(storage, {
      ttl: 3600000,
      lockTimeout: 30000,
    });
  });

  it('should return cached response on cache hit', async () => {
    const cachedResponse = { data: 'cached' };
    vi.mocked(storage.get).mockResolvedValue({
      response: cachedResponse,
      createdAt: Date.now(),
      ttl: 3600000,
    });

    const handler = vi.fn().mockResolvedValue({ data: 'new' });
    const result = await middleware.execute('test-key', {}, handler);

    expect(result).toEqual(cachedResponse);
    expect(handler).not.toHaveBeenCalled();
    expect(storage.get).toHaveBeenCalledWith(expect.stringContaining('test-key'));
  });

  it('should execute handler and cache response on cache miss', async () => {
    vi.mocked(storage.get).mockResolvedValue(null);
    const handlerResponse = { data: 'new' };
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const result = await middleware.execute('test-key', {}, handler);

    expect(result).toEqual(handlerResponse);
    expect(handler).toHaveBeenCalled();
    expect(storage.set).toHaveBeenCalledWith(
      expect.stringContaining('test-key'),
      expect.objectContaining({
        response: handlerResponse,
      })
    );
  });

  it('should throw error when idempotency key is missing', async () => {
    const handler = vi.fn();

    await expect(middleware.execute('', {}, handler)).rejects.toThrow(IdempotencyError);
    await expect(middleware.execute('   ', {}, handler)).rejects.toThrow(IdempotencyError);
  });

  it('should handle concurrent duplicate requests correctly', async () => {
    vi.mocked(storage.get).mockResolvedValue(null);

    let lockHeld = false;
    vi.mocked(storage.acquireLock).mockImplementation(async () => {
      if (lockHeld) return false;
      lockHeld = true;
      return true;
    });

    // Second request waits, then finds cached result
    vi.mocked(storage.waitForLock).mockImplementation(async () => {
      // Simulate lock holder finishing and storing result
      vi.mocked(storage.get).mockResolvedValue({
        response: { data: 'result' },
        createdAt: Date.now(),
        ttl: 3600000,
      });
    });

    const handler = vi.fn().mockResolvedValue({ data: 'result' });

    const [result1, result2] = await Promise.all([
      middleware.execute('same-key', {}, handler),
      middleware.execute('same-key', {}, handler),
    ]);

    expect(result1).toEqual({ data: 'result' });
    expect(result2).toEqual({ data: 'result' });
    expect(handler).toHaveBeenCalledTimes(1); // Only executed once
  });
});
```

### Example 2: Integration Test for Redis Adapter

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { RedisAdapter } from '../RedisAdapter';
import { IdempotencyRecord } from '../../core/types';

describe('RedisAdapter Integration', () => {
  let redis: Redis;
  let adapter: RedisAdapter;

  beforeAll(async () => {
    redis = new Redis({
      host: 'localhost',
      port: 6379,
    });
    adapter = new RedisAdapter(redis);
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.disconnect();
    await redis.quit();
  });

  it('should store and retrieve responses', async () => {
    const record: IdempotencyRecord = {
      response: { id: 1, name: 'Test' },
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      createdAt: Date.now(),
      ttl: 60000,
    };

    await adapter.set('test-key', record);
    const retrieved = await adapter.get('test-key');

    expect(retrieved).toEqual(record);
  });

  it('should return null for non-existent keys', async () => {
    const result = await adapter.get('non-existent-key');
    expect(result).toBeNull();
  });

  it('should delete cached responses', async () => {
    const record: IdempotencyRecord = {
      response: { data: 'test' },
      statusCode: 200,
      headers: {},
      createdAt: Date.now(),
      ttl: 60000,
    };

    await adapter.set('delete-test-key', record);
    await adapter.delete('delete-test-key');

    const result = await adapter.get('delete-test-key');
    expect(result).toBeNull();
  });

  it('should return null for missing keys and value for existing keys', async () => {
    const missing = await adapter.get('existing-key');
    expect(missing).toBeNull();

    await adapter.set('existing-key', {
      response: {},
      createdAt: Date.now(),
      ttl: 60000,
    });

    const found = await adapter.get('existing-key');
    expect(found).not.toBeNull();
  });
});
```

### Example 3: E2E Test for Express Middleware

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { idempotentExpress } from '../express';
import { MemoryAdapter } from '../../adapters/MemoryAdapter';

describe('Express Middleware E2E', () => {
  let app: express.Express;
  let server: any;
  let adapter: MemoryAdapter;

  beforeAll(() => {
    adapter = new MemoryAdapter();
    app = express();
    app.use(express.json());
    app.use(idempotentExpress(adapter, { ttl: 60000 }));

    app.post('/api/users', (req, res) => {
      res.status(201).json({
        id: 1,
        name: req.body.name,
        email: req.body.email,
      });
    });

    app.put('/api/users/:id', (req, res) => {
      res.json({
        id: req.params.id,
        name: req.body.name,
        email: req.body.email,
      });
    });

    server = app.listen(3001);
  });

  afterAll((done) => {
    server.close(done);
  });

  it('should return same response for duplicate POST requests', async () => {
    const idempotencyKey = 'unique-key-123';
    const payload = { name: 'John Doe', email: 'john@example.com' };

    const [response1, response2] = await Promise.all([
      request(app)
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201),
      request(app)
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201),
    ]);

    expect(response1.body).toEqual(response2.body);
    expect(response1.body).toEqual({
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
    });
  });

  it('should handle concurrent duplicate requests', async () => {
    const idempotencyKey = 'concurrent-key-456';
    const payload = { name: 'Jane Doe', email: 'jane@example.com' };

    const responses = await Promise.all([
      request(app)
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201),
      request(app)
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201),
      request(app)
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201),
    ]);

    // All responses should be identical
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[1].body).toEqual(responses[2].body);
  });

  it('should not cache requests without idempotency key', async () => {
    const payload = { name: 'Test User', email: 'test@example.com' };

    const response1 = await request(app)
      .post('/api/users')
      .send(payload)
      .expect(201);

    const response2 = await request(app)
      .post('/api/users')
      .send(payload)
      .expect(201);

    // Without idempotency key, each request should execute independently
    // In a real scenario, these might have different IDs
    expect(response1.body).toEqual(response2.body);
  });
});
```

## Workflow Integration

### Input Reception
1. Receive component specifications
2. Review implementation details
3. Identify test scenarios
4. Create test plan

### Test Development Phase
1. Write unit tests co-located with source (`src/*.test.ts`)
2. Create integration tests per package
3. Develop E2E test scenarios for framework packages
4. Maintain >90% line coverage and >85% branch coverage per package

### Test Execution Phase
1. Run unit tests
2. Run integration tests
3. Run E2E tests
4. Analyze coverage reports

### Output Delivery
1. Complete test suite
2. Coverage reports
3. Test documentation
4. Performance benchmarks

## Communication Protocol

### With Core Developer
```json
{
  "from": "test-engineer",
  "to": ["core-developer"],
  "type": "request",
  "subject": "Test coverage requirements",
  "content": {
    "requirements": {
      "unitTests": "All core functions must have unit tests",
      "edgeCases": "Edge cases must be documented",
      "errorScenarios": "Error handling must be tested"
    },
    "coverage": {
      "target": ">90% line coverage"
    }
  }
}
```

### With DevOps Engineer
```json
{
  "from": "test-engineer",
  "to": ["devops-engineer"],
  "type": "request",
  "subject": "CI/CD test integration",
  "content": {
    "requirements": {
      "testEnvironments": ["Node 18", "Node 20"],
      "databaseSetup": "Redis, Firestore emulator, DynamoDB local",
      "coverageReporting": "Upload coverage to coverage service"
    }
  }
}
```

## Success Metrics

### Coverage Metrics
- **Line Coverage**: >90%
- **Branch Coverage**: >85%
- **Function Coverage**: >90%
- **Statement Coverage**: >90%

### Quality Metrics
- **Flaky Tests**: 0%
- **Test Execution Time**: <2 minutes total
- **Test Independence**: 100%
- **Test Maintainability**: High

### Reliability Metrics
- **Test Pass Rate**: >99%
- **False Positives**: <1%
- **False Negatives**: 0%
- **Test Stability**: High

## Continuous Improvement

### Test Enhancement
- Add more edge case tests
- Improve test coverage
- Optimize test execution time
- Add performance tests

### Process Improvement
- Automate test generation
- Improve test data management
- Enhance test reporting
- Streamline test maintenance

### Tool Enhancement
- Adopt new testing tools
- Improve mocking strategies
- Enhance test infrastructure
- Add visual regression tests

## References

- [DEV_PLAN.md](../../DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Technical architecture
- [AGENTS.md](../../AGENTS.md) - Agent system overview
