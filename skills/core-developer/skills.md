# Core Developer Agent Skills

## Role
TypeScript implementation and core logic development for the idempotency middleware project.

## Capabilities

### 1. TypeScript Development
- Implement type-safe TypeScript code with strict mode
- Design and implement complex type systems
- Create generic, reusable components
- Handle advanced TypeScript patterns (conditional types, mapped types)

### 2. Core Middleware Logic
- Implement idempotency key extraction and validation
- Build cache hit/miss detection logic
- Create concurrent request handling with locks
- Implement response serialization and deserialization

### 3. Error Handling
- Design comprehensive error types and codes
- Implement graceful degradation patterns
- Create detailed error messages and context
- Handle edge cases and failure scenarios

### 4. Performance Optimization
- Optimize cache key generation algorithms
- Minimize memory footprint
- Reduce latency for cache operations
- Implement efficient data structures

## Tools

### Development Tools
- **TypeScript 5.x** - Latest TypeScript features
- **tsup** - Fast build tool for TypeScript
- **tsx** - TypeScript executor for development
- **ESLint** - Code quality and consistency

### Testing Tools
- **Vitest** - Fast unit test framework
- **@vitest/coverage-v8** - Code coverage analysis
- **Mock implementations** - For testing in isolation

## Constraints

### Code Quality Constraints
- No `any` types allowed
- Strict null checks enabled
- All functions must have explicit return types
- Maximum function length: 50 lines

### Performance Constraints
- Cache hit latency: <5ms
- Cache miss overhead: <10ms
- Memory usage: <100MB for 10,000 cached items
- CPU usage: <10% for typical workloads

### Compatibility Constraints
- Node.js 18+ compatibility
- ESM and CJS module support
- Backward compatible API design
- Zero breaking changes in minor versions

## Quality Standards

### Code Quality
- **Type Safety**: 100% strict TypeScript compliance
- **Test Coverage**: >90% line coverage, >85% branch coverage
- **Code Complexity**: Cyclomatic complexity <10 per function
- **Maintainability**: Clear, self-documenting code

### Performance Quality
- **Latency**: Sub-millisecond for in-memory operations
- **Throughput**: 1000+ requests per second
- **Memory**: Efficient memory usage with proper cleanup
- **CPU**: Minimal CPU overhead

### Reliability Quality
- **Error Handling**: All edge cases handled
- **Recovery**: Automatic recovery from transient failures
- **Logging**: Comprehensive logging for debugging
- **Monitoring**: Built-in metrics and observability

## Examples

### Example 1: IdempotencyMiddleware Core Implementation

```typescript
import { StorageAdapter } from '../adapters/StorageAdapter';
import { IdempotencyConfig, IdempotencyRecord, CacheKeyOptions } from './types';
import { IdempotencyError, IdempotencyErrorCode } from './IdempotencyError';
import { generateCacheKey } from '../utils/hash';

export class IdempotencyMiddleware {
  private readonly storage: StorageAdapter;
  private readonly config: Required<IdempotencyConfig>;

  constructor(
    storage: StorageAdapter,
    config: IdempotencyConfig = {}
  ) {
    this.storage = storage;
    this.config = this.mergeConfig(config);
  }

  private mergeConfig(config: IdempotencyConfig): Required<IdempotencyConfig> {
    return {
      headerName: config.headerName ?? 'Idempotency-Key',
      ttl: config.ttl ?? 24 * 60 * 60 * 1000, // 24 hours
      methods: config.methods ?? ['POST', 'PUT', 'PATCH'],
      getKey: config.getKey ?? ((req: unknown) => {
        if (req && typeof req === 'object' && 'headers' in req) {
          const headers = (req as Record<string, unknown>).headers as Record<string, string>;
          return headers[this.config.headerName.toLowerCase()];
        }
        return undefined;
      }),
      shouldCache: config.shouldCache ?? (() => true),
      varyHeaders: config.varyHeaders ?? [],
      includeBodyInKey: config.includeBodyInKey ?? true,
      maxKeyLength: config.maxKeyLength ?? 256,
      lockTimeout: config.lockTimeout ?? 30 * 1000, // 30 seconds
      lockPollInterval: config.lockPollInterval ?? 100,
    };
  }

  async execute<T, R>(
    key: string,
    context: T,
    handler: () => Promise<R>
  ): Promise<R> {
    // Validate idempotency key
    if (!key || key.trim() === '') {
      throw new IdempotencyError(
        IdempotencyErrorCode.KEY_REQUIRED,
        'Idempotency key is required'
      );
    }
    if (key.length > this.config.maxKeyLength) {
      throw new IdempotencyError(
        IdempotencyErrorCode.KEY_REQUIRED,
        `Idempotency key exceeds maximum length of ${this.config.maxKeyLength} characters`
      );
    }

    // Generate cache key
    const cacheKey = this.generateCacheKey(key, context);

    // Check cache first
    const cached = await this.storage.get(cacheKey);
    if (cached) {
      return cached.response as R;
    }

    // Try to acquire lock
    const lockAcquired = await this.storage.acquireLock(cacheKey, this.config.lockTimeout);

    if (lockAcquired) {
      try {
        // Double-check cache after acquiring lock
        const doubleCheck = await this.storage.get(cacheKey);
        if (doubleCheck) {
          return doubleCheck.response as R;
        }

        // Execute handler
        const response = await handler();

        // Store in cache if should cache
        if (this.config.shouldCache(response)) {
          const record: IdempotencyRecord = {
            response,
            createdAt: Date.now(),
            ttl: this.config.ttl,
          };
          await this.storage.set(cacheKey, record);
        }

        return response;
      } catch (error) {
        // For handler errors, store a short-lived error record so retries
        // don't re-execute side effects
        if (this.config.shouldCache(error)) {
          await this.storage.set(cacheKey, {
            response: error,
            createdAt: Date.now(),
            ttl: Math.min(this.config.lockTimeout, this.config.ttl),
          }).catch(() => {});
        }
        throw error;
      } finally {
        await this.storage.releaseLock(cacheKey);
      }
    } else {
      // Wait for lock holder to complete
      await this.storage.waitForLock(
        cacheKey,
        this.config.lockTimeout,
        this.config.lockPollInterval
      );

      // Return cached response
      const cached = await this.storage.get(cacheKey);
      if (!cached) {
        // Lock holder crashed before storing
        throw new IdempotencyError(
          IdempotencyErrorCode.CONFLICT,
          'Idempotency-Key In Use. The original request is still processing or failed. Please retry with a new key.'
        );
      }

      return cached.response as R;
    }
  }

  private generateCacheKey(idempotencyKey: string, context: unknown): string {
    const options: CacheKeyOptions = {
      idempotencyKey,
      method: 'POST', // Will be overridden by framework
      path: '/', // Will be overridden by framework
      varyHeaders: {},
    };

    // Extract vary headers if configured
    if (this.config.varyHeaders.length > 0 && context) {
      const headers = this.extractHeaders(context);
      options.varyHeaders = {};
      for (const header of this.config.varyHeaders) {
        if (headers[header.toLowerCase()]) {
          options.varyHeaders[header] = headers[header.toLowerCase()];
        }
      }
    }

    return generateCacheKey(options);
  }

  private extractHeaders(context: unknown): Record<string, string> {
    // Framework-specific header extraction
    if (context && typeof context === 'object' && 'headers' in context) {
      return (context as Record<string, unknown>).headers as Record<string, string>;
    }
    return {};
  }
}
```

### Example 2: Error Handling Implementation

```typescript
export enum IdempotencyErrorCode {
  /** Missing or empty idempotency key */
  KEY_REQUIRED = 'KEY_REQUIRED',
  
  /** Lock acquisition or wait timeout */
  LOCK_TIMEOUT = 'LOCK_TIMEOUT',
  
  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',
  
  /** Response serialization failed */
  SERIALIZATION_ERROR = 'SERIALIZATION_ERROR',
  
  /** Conflict with existing operation */
  CONFLICT = 'CONFLICT',
  
  /** Invalid configuration */
  INVALID_CONFIG = 'INVALID_CONFIG',
  
  /** Storage adapter not connected */
  NOT_CONNECTED = 'NOT_CONNECTED',
}

export class IdempotencyError extends Error {
  public readonly code: IdempotencyErrorCode;
  public readonly cause?: Error;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: IdempotencyErrorCode,
    message: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'IdempotencyError';
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;
    
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IdempotencyError);
    }
  }

  /**
   * Check if error is recoverable
   */
  isRecoverable(): boolean {
    const recoverableCodes: IdempotencyErrorCode[] = [
      IdempotencyErrorCode.LOCK_TIMEOUT,
      IdempotencyErrorCode.STORAGE_ERROR,
    ];
    return recoverableCodes.includes(this.code);
  }

  /**
   * Get HTTP status code for this error
   */
  getStatusCode(): number {
    switch (this.code) {
      case IdempotencyErrorCode.KEY_REQUIRED:
        return 400;
      case IdempotencyErrorCode.LOCK_TIMEOUT:
        return 409;
      case IdempotencyErrorCode.CONFLICT:
        return 409;
      case IdempotencyErrorCode.STORAGE_ERROR:
        return 503;
      case IdempotencyErrorCode.SERIALIZATION_ERROR:
        return 500;
      default:
        return 500;
    }
  }
}
```

### Example 3: Type Definitions

```typescript
/**
 * Cached idempotency record structure
 */
export interface IdempotencyRecord {
  /** The cached response body */
  response: unknown;

  /** HTTP status code (framework-specific, optional) */
  statusCode?: number;

  /** Response headers (framework-specific, optional) */
  headers?: Record<string, string>;

  /** Timestamp when record was created (ms) */
  createdAt: number;

  /** Time-to-live in milliseconds */
  ttl: number;
}

/**
 * Configuration for idempotency middleware
 */
export interface IdempotencyConfig {
  /**
   * Header name for idempotency key
   * @default 'Idempotency-Key'
   */
  headerName?: string;

  /**
   * TTL in milliseconds
   * @default 86400000 (24 hours)
   */
  ttl?: number;

  /**
   * HTTP methods to apply idempotency
   * @default ['POST', 'PUT', 'PATCH']
   */
  methods?: string[];

  /**
   * Function to extract idempotency key from request
   * @default Extract from header
   */
  getKey?: (req: unknown) => string | undefined;

  /**
   * Function to determine if response should be cached
   * @default Cache all responses (including errors) for true idempotency
   */
  shouldCache?: (res: unknown) => boolean;

  /**
   * Additional headers to include in cache key
   * @default []
   */
  varyHeaders?: string[];

  /**
   * Include request body hash in cache key
   * @default true
   */
  includeBodyInKey?: boolean;

  /**
   * Maximum length of idempotency key in characters
   * @default 256
   */
  maxKeyLength?: number;

  /**
   * Lock timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  lockTimeout?: number;

  /**
   * Poll interval for lock waiting in milliseconds
   * @default 100
   */
  lockPollInterval?: number;
}

/**
 * Options for cache key generation
 */
export interface CacheKeyOptions {
  /** The idempotency key from client */
  idempotencyKey: string;

  /** HTTP method */
  method: string;

  /** Request path */
  path: string;

  /** SHA-256 hash of request body */
  bodyHash?: string;

  /** Vary headers and their values */
  varyHeaders?: Record<string, string>;
}

/**
 * Execution context passed to middleware
 */
export interface ExecutionContext {
  /** HTTP method */
  method: string;
  
  /** Request path */
  path: string;
  
  /** Request headers */
  headers: Record<string, string>;
  
  /** Request body (if available) */
  body?: unknown;
  
  /** Original request object */
  request: unknown;
}
```

## Workflow Integration

### Input Reception
1. Receive technical specifications from Architect
2. Review interface definitions and requirements
3. Identify implementation dependencies
4. Create implementation plan

### Implementation Phase
1. Set up TypeScript project structure
2. Implement core types and interfaces
3. Build middleware logic incrementally
4. Add comprehensive error handling
5. Optimize for performance

### Testing Phase
1. Write unit tests for each component
2. Test edge cases and error scenarios
3. Verify type safety and compilation
4. Measure performance metrics

### Output Delivery
1. Complete TypeScript implementation
2. Full test coverage
3. Performance benchmarks
4. Implementation documentation

## Communication Protocol

### With Architect
```json
{
  "from": "core-developer",
  "to": ["architect"],
  "type": "response",
  "subject": "IdempotencyMiddleware implementation complete",
  "content": {
    "status": "complete",
    "files": [
      "src/core/IdempotencyMiddleware.ts",
      "src/core/types.ts",
      "src/core/IdempotencyError.ts"
    ],
    "coverage": {
      "lines": 92,
      "branches": 87,
      "functions": 95
    },
    "performance": {
      "cacheHitLatency": "2ms",
      "cacheMissLatency": "8ms"
    }
  }
}
```

### With Storage Specialist
```json
{
  "from": "core-developer",
  "to": ["storage-specialist"],
  "type": "request",
  "subject": "Storage adapter integration requirements",
  "content": {
    "interface": "StorageAdapter",
    "requirements": {
      "get": "Must return null for missing keys",
      "set": "Must handle TTL automatically",
      "delete": "Must be idempotent",
      "exists": "Must check expiration"
    },
    "testing": {
      "mockRequired": true,
      "integrationTests": true
    }
  }
}
```

## Success Metrics

### Code Quality Metrics
- **Type Safety**: 100% strict TypeScript compliance
- **Test Coverage**: >90% line, >85% branch coverage
- **Code Complexity**: Average cyclomatic complexity <5
- **Maintainability Index**: >80/100

### Performance Metrics
- **Cache Hit Latency**: <5ms
- **Cache Miss Latency**: <10ms
- **Memory Usage**: <100MB for 10k items
- **CPU Usage**: <10% for typical workloads

### Reliability Metrics
- **Error Rate**: <0.1% in production
- **Recovery Time**: <1 second for transient failures
- **Uptime**: >99.9% availability
- **Bug Rate**: <1 bug per 1000 lines of code

## Continuous Improvement

### Code Quality
- Regular code reviews and refactoring
- Performance profiling and optimization
- Security vulnerability scanning
- Dependency updates and upgrades

### Skill Development
- Stay updated on TypeScript features
- Learn new design patterns
- Study performance optimization techniques
- Research error handling best practices

### Process Improvement
- Automate repetitive tasks
- Improve testing strategies
- Enhance debugging tools
- Streamline development workflow

## References

- [DEV_PLAN.md](../../DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Technical architecture
- [AGENTS.md](../../AGENTS.md) - Agent system overview
