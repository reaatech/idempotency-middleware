# Framework Integrator Agent Skills

## Role
Framework integration for Express, Koa, and raw handler wrappers to enable idempotency middleware usage across different Node.js frameworks.

## Capabilities

### 1. Express Middleware Integration
- Create Express-compatible middleware functions
- Handle Express request/response lifecycle
- Integrate with Express error handling
- Support Express context and locals

### 2. Koa Middleware Integration
- Create Koa-compatible middleware functions
- Handle Koa context (ctx) properly
- Integrate with Koa error handling
- Support Koa middleware composition

### 3. Raw Handler Wrapper
- Create framework-agnostic wrapper functions
- Support custom handler signatures
- Handle context extraction and injection
- Enable usage in non-HTTP environments

### 4. Framework-Agnostic Design
- Abstract framework-specific details
- Create unified interface across frameworks
- Support custom framework adapters
- Enable easy extension for new frameworks

## Tools

### Framework Libraries
- **express** - Express.js framework
- **koa** - Koa.js framework
- **@types/express** - TypeScript types for Express
- **@types/koa** - TypeScript types for Koa

### Testing Tools
- **supertest** - HTTP assertion library for Express
- **koa-test** - Testing utilities for Koa
- **jest** or **vitest** - Test frameworks

## Constraints

### Compatibility Constraints
- Must work with Express 4.x and 5.x
- Must work with Koa 2.x
- Must support Node.js 18+
- Must maintain backward compatibility

### Performance Constraints
- Middleware overhead: <5ms
- Memory footprint: <10MB per instance
- No blocking operations in middleware
- Efficient request/response handling

### Quality Constraints
- Full TypeScript support
- Comprehensive error handling
- Proper type inference
- Zero breaking changes in minor versions

## Quality Standards

### Code Quality
- **Type Safety**: Full TypeScript strict mode
- **Error Handling**: All framework-specific errors handled
- **Middleware Chain**: Proper next() handling
- **Context Management**: Clean context isolation

### Integration Quality
- **Framework Compliance**: Follow framework conventions
- **Error Propagation**: Proper error handling per framework
- **Request Lifecycle**: Respect framework lifecycle
- **Response Handling**: Consistent response formatting

### Testing Quality
- **Unit Tests**: Test each integration in isolation
- **Integration Tests**: Test full request/response flow
- **E2E Tests**: Test real-world scenarios
- **Edge Cases**: Test error scenarios and edge cases

## Examples

### Example 1: Express Middleware Integration

```typescript
import { Request, Response, NextFunction } from 'express';
import { StorageAdapter } from '../adapters/StorageAdapter';
import { IdempotencyConfig } from '../core/types';
import { IdempotencyError, IdempotencyErrorCode } from '../core/IdempotencyError';

export interface ExpressIdempotencyConfig extends IdempotencyConfig {
  /**
   * Custom error handler for Express
   */
  errorHandler?: (err: IdempotencyError, req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Create Express middleware for idempotency.
 * Use with `app.use(idempotentExpress(adapter))` before your routes.
 */
export function idempotentExpress(
  storage: StorageAdapter,
  config: ExpressIdempotencyConfig = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip if not a tracked method
      const methods = config.methods ?? ['POST', 'PUT', 'PATCH'];
      if (!methods.includes(req.method)) {
        return next();
      }

      // Extract idempotency key
      const headerName = config.headerName ?? 'Idempotency-Key';
      const key = req.headers[headerName.toLowerCase()] as string | undefined;

      // Skip if no key provided
      if (!key) {
        return next();
      }

      const cacheKey = generateCacheKey({
        idempotencyKey: key,
        method: req.method,
        path: req.path,
        bodyHash: config.includeBodyInKey !== false
          ? hashBody(req.body)
          : undefined,
        varyHeaders: extractVaryHeaders(req.headers, config.varyHeaders),
      });

      // Check cache first
      const cached = await storage.get(cacheKey);
      if (cached) {
        res.status(cached.statusCode ?? 200);
        if (cached.headers) {
          Object.entries(cached.headers).forEach(([k, v]) => res.set(k, v));
        }
        res.send(cached.response);
        return;
      }

      // Try to acquire lock
      const acquired = await storage.acquireLock(cacheKey, config.lockTimeout ?? 30000);

      if (!acquired) {
        // Another request is processing. Wait for it.
        await storage.waitForLock(
          cacheKey,
          config.lockTimeout ?? 30000,
          config.lockPollInterval ?? 100
        );

        const cached = await storage.get(cacheKey);
        if (!cached) {
          // Lock holder crashed before storing
          res.status(409).json({ error: 'Idempotency-Key In Use' });
          return;
        }

        res.status(cached.statusCode ?? 200);
        if (cached.headers) {
          Object.entries(cached.headers).forEach(([k, v]) => res.set(k, v));
        }
        res.send(cached.response);
        return;
      }

      // We hold the lock. Patch response methods to capture the body,
      // then let the route handler run. On 'finish', store the response.
      let capturedBody: unknown;
      let bodyCaptured = false;

      const originalJson = res.json.bind(res);
      res.json = function json(body: unknown) {
        if (!bodyCaptured) {
          bodyCaptured = true;
          capturedBody = body;
        }
        return originalJson(body);
      };

      const originalSend = res.send.bind(res);
      res.send = function send(body: unknown) {
        if (!bodyCaptured && arguments.length === 1 && typeof body !== 'number') {
          bodyCaptured = true;
          capturedBody = body;
        }
        return originalSend(body);
      };

      res.on('finish', async () => {
        if (!bodyCaptured) {
          capturedBody = undefined; // e.g., res.end() or streaming
        }
        await storage.set(cacheKey, {
          response: capturedBody,
          statusCode: res.statusCode,
          headers: res.getHeaders() as Record<string, string>,
          createdAt: Date.now(),
          ttl: config.ttl ?? 86400000,
        }).catch(() => {});
        await storage.releaseLock(cacheKey).catch(() => {});
      });

      next();

    } catch (error) {
      if (error instanceof IdempotencyError && config.errorHandler) {
        return config.errorHandler(error, req, res, next);
      }
      return next(error);
    }
  };
}

/**
 * Alternative: wrap an individual Express route handler.
 * This is simpler and doesn't require response interception.
 */
export function withIdempotency<T = unknown>(
  storage: StorageAdapter,
  handler: (req: Request<T>, res: Response) => Promise<void>,
  config: IdempotencyConfig = {}
) {
  return async (req: Request<T>, res: Response, next: NextFunction) => {
    try {
      const headerName = config.headerName ?? 'Idempotency-Key';
      const key = req.headers[headerName.toLowerCase()] as string | undefined;

      if (!key) {
        return handler(req, res);
      }

      const cacheKey = generateCacheKey({
        idempotencyKey: key,
        method: req.method,
        path: req.path,
        bodyHash: config.includeBodyInKey !== false
          ? hashBody(req.body)
          : undefined,
        varyHeaders: extractVaryHeaders(req.headers, config.varyHeaders),
      });

      const cached = await storage.get(cacheKey);
      if (cached) {
        res.status(cached.statusCode ?? 200);
        if (cached.headers) {
          Object.entries(cached.headers).forEach(([k, v]) => res.set(k, v));
        }
        res.send(cached.response);
        return;
      }

      const acquired = await storage.acquireLock(cacheKey, config.lockTimeout ?? 30000);
      if (!acquired) {
        await storage.waitForLock(
          cacheKey,
          config.lockTimeout ?? 30000,
          config.lockPollInterval ?? 100
        );
        const cached = await storage.get(cacheKey);
        if (!cached) {
          res.status(409).json({ error: 'Idempotency-Key In Use' });
          return;
        }
        res.status(cached.statusCode ?? 200);
        if (cached.headers) {
          Object.entries(cached.headers).forEach(([k, v]) => res.set(k, v));
        }
        res.send(cached.response);
        return;
      }

      try {
        await handler(req, res);
        // After handler completes, capture the response
        await storage.set(cacheKey, {
          response: res.body ?? undefined,
          statusCode: res.statusCode,
          headers: res.getHeaders() as Record<string, string>,
          createdAt: Date.now(),
          ttl: config.ttl ?? 86400000,
        }).catch(() => {});
      } catch (error) {
        // Cache error responses for idempotency
        await storage.set(cacheKey, {
          response: error,
          statusCode: (error as { statusCode?: number })?.statusCode ?? 500,
          createdAt: Date.now(),
          ttl: Math.min(config.lockTimeout ?? 30000, config.ttl ?? 86400000),
        }).catch(() => {});
        throw error;
      } finally {
        await storage.releaseLock(cacheKey).catch(() => {});
      }
    } catch (error) {
      return next(error);
    }
  };
}
```

### Example 2: Koa Middleware Integration

```typescript
import { Context, Next } from 'koa';
import { StorageAdapter } from '../adapters/StorageAdapter';
import { IdempotencyConfig } from '../core/types';
import { IdempotencyError, IdempotencyErrorCode } from '../core/IdempotencyError';

export interface KoaIdempotencyConfig extends IdempotencyConfig {
  /**
   * Custom error handler for Koa
   */
  errorHandler?: (ctx: Context, err: IdempotencyError) => void;
}

/**
 * Create Koa middleware for idempotency
 */
export function idempotentKoa(
  storage: StorageAdapter,
  config: KoaIdempotencyConfig = {}
) {
  return async (ctx: Context, next: Next) => {
    try {
      // Skip if not a tracked method
      const methods = config.methods ?? ['POST', 'PUT', 'PATCH'];
      if (!methods.includes(ctx.method)) {
        return next();
      }

      // Extract idempotency key
      const headerName = config.headerName ?? 'Idempotency-Key';
      const key = ctx.get(headerName);

      // Skip if no key provided
      if (!key) {
        return next();
      }

      const cacheKey = generateCacheKey({
        idempotencyKey: key,
        method: ctx.method,
        path: ctx.path,
        bodyHash: config.includeBodyInKey !== false
          ? hashBody(ctx.request.body)
          : undefined,
        varyHeaders: extractVaryHeaders(ctx.headers, config.varyHeaders),
      });

      // Check cache
      const cached = await storage.get(cacheKey);
      if (cached) {
        ctx.status = cached.statusCode ?? 200;
        ctx.body = cached.response;
        if (cached.headers) {
          Object.entries(cached.headers).forEach(([k, v]) => {
            ctx.set(k, v);
          });
        }
        return;
      }

      // Try to acquire lock
      const acquired = await storage.acquireLock(cacheKey, config.lockTimeout ?? 30000);

      if (!acquired) {
        await storage.waitForLock(
          cacheKey,
          config.lockTimeout ?? 30000,
          config.lockPollInterval ?? 100
        );
        const cached = await storage.get(cacheKey);
        if (!cached) {
          ctx.status = 409;
          ctx.body = { error: 'Idempotency-Key In Use' };
          return;
        }
        ctx.status = cached.statusCode ?? 200;
        ctx.body = cached.response;
        if (cached.headers) {
          Object.entries(cached.headers).forEach(([k, v]) => {
            ctx.set(k, v);
          });
        }
        return;
      }

      try {
        // Execute downstream middleware
        await next();

        // Store response
        await storage.set(cacheKey, {
          response: ctx.body,
          statusCode: ctx.status,
          headers: ctx.response.headers as Record<string, string>,
          createdAt: Date.now(),
          ttl: config.ttl ?? 86400000,
        });
      } catch (error) {
        // Cache error responses for idempotency
        await storage.set(cacheKey, {
          response: error,
          statusCode: (error as { status?: number })?.status ?? 500,
          createdAt: Date.now(),
          ttl: Math.min(config.lockTimeout ?? 30000, config.ttl ?? 86400000),
        }).catch(() => {});
        throw error;
      } finally {
        await storage.releaseLock(cacheKey).catch(() => {});
      }
    } catch (error) {
      if (error instanceof IdempotencyError) {
        if (config.errorHandler) {
          config.errorHandler(ctx, error);
        } else {
          ctx.status = error.getStatusCode();
          ctx.body = {
            error: error.message,
            code: error.code,
          };
        }
        return;
      }
      throw error;
    }
  };
}
```

### Example 3: Raw Handler Wrapper

```typescript
import { StorageAdapter } from '../adapters/StorageAdapter';
import { IdempotencyConfig } from '../core/types';
import { IdempotencyError, IdempotencyErrorCode } from '../core/IdempotencyError';

/**
 * Context for raw handler execution
 */
export interface RawHandlerContext {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  [key: string]: unknown;
}

/**
 * Raw handler function type
 */
export type RawHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: RawHandlerContext
) => Promise<TOutput>;

/**
 * Create a wrapped handler with idempotency
 */
export function idempotentHandler<TInput = unknown, TOutput = unknown>(
  storage: StorageAdapter,
  handler: RawHandler<TInput, TOutput>,
  config: IdempotencyConfig = {}
) {
  return async (
    input: TInput,
    idempotencyKey: string,
    context: Partial<RawHandlerContext> = {}
  ): Promise<TOutput> => {
    // Validate idempotency key
    if (!idempotencyKey || idempotencyKey.trim() === '') {
      throw new IdempotencyError(
        IdempotencyErrorCode.KEY_REQUIRED,
        'Idempotency key is required for raw handler'
      );
    }

    const cacheKey = generateCacheKey({
      idempotencyKey,
      method: context.method ?? 'POST',
      path: context.path ?? '/',
      bodyHash: config.includeBodyInKey !== false
        ? hashBody(input)
        : undefined,
      varyHeaders: extractVaryHeaders(context.headers ?? {}, config.varyHeaders),
    });

    // Check cache
    const cached = await storage.get(cacheKey);
    if (cached) {
      if (cached.response instanceof Error) {
        throw cached.response;
      }
      return cached.response as TOutput;
    }

    // Try to acquire lock
    const acquired = await storage.acquireLock(cacheKey, config.lockTimeout ?? 30000);
    if (!acquired) {
      await storage.waitForLock(
        cacheKey,
        config.lockTimeout ?? 30000,
        config.lockPollInterval ?? 100
      );
      const cached = await storage.get(cacheKey);
      if (!cached) {
        throw new IdempotencyError(
          IdempotencyErrorCode.CONFLICT,
          'Idempotency-Key In Use. The original request is still processing or failed. Please retry with a new key.'
        );
      }
      if (cached.response instanceof Error) {
        throw cached.response;
      }
      return cached.response as TOutput;
    }

    // Create full execution context
    const fullContext: RawHandlerContext = {
      method: context.method ?? 'POST',
      path: context.path ?? '/',
      headers: context.headers ?? {},
      body: input,
      ...context,
    };

    try {
      const result = await handler(input, fullContext);
      await storage.set(cacheKey, {
        response: result,
        createdAt: Date.now(),
        ttl: config.ttl ?? 86400000,
      });
      return result;
    } catch (error) {
      await storage.set(cacheKey, {
        response: error,
        createdAt: Date.now(),
        ttl: Math.min(config.lockTimeout ?? 30000, config.ttl ?? 86400000),
      }).catch(() => {});
      throw error;
    } finally {
      await storage.releaseLock(cacheKey).catch(() => {});
    }
  };
}

/**
 * Helper to create context for common use cases
 */
export function createHandlerContext(
  overrides: Partial<RawHandlerContext> = {}
): RawHandlerContext {
  return {
    method: 'POST',
    path: '/',
    headers: {},
    ...overrides,
  };
}
```

### Example 4: Custom Framework Adapter Template

```typescript
import { StorageAdapter } from '../adapters/StorageAdapter';
import { IdempotencyConfig } from '../core/types';
import { IdempotencyError, IdempotencyErrorCode } from '../core/IdempotencyError';

/**
 * Template for creating custom framework adapters
 */
export interface FrameworkAdapterOptions<Request, Response, Context> {
  /**
   * Extract idempotency key from request
   */
  extractKey: (req: Request, ctx: Context) => string | undefined;

  /**
   * Generate cache key from request
   */
  generateCacheKey: (req: Request, ctx: Context) => string;

  /**
   * Execute the next middleware/handler
   */
  executeNext: (ctx: Context) => Promise<void>;

  /**
   * Get response for caching
   */
  getResponse: (res: Response) => { statusCode?: number; body: unknown; headers?: Record<string, string> };

  /**
   * Set response from cached result
   */
  setResponse: (res: Response, result: unknown, statusCode?: number, headers?: Record<string, string>) => void;

  /**
   * Handle idempotency errors
   */
  handleError?: (ctx: Context, error: IdempotencyError) => void;
}

/**
 * Create a custom framework adapter
 */
export function createFrameworkAdapter<Request, Response, Context>(
  storage: StorageAdapter,
  options: FrameworkAdapterOptions<Request, Response, Context>,
  config: IdempotencyConfig = {}
) {
  return async (req: Request, res: Response, ctx: Context, next?: () => Promise<void>) => {
    try {
      // Extract idempotency key
      const key = options.extractKey(req, ctx);

      // Skip if no key
      if (!key) {
        if (next) return next();
        return;
      }

      const cacheKey = options.generateCacheKey(req, ctx);

      // Check cache
      const cached = await storage.get(cacheKey);
      if (cached) {
        options.setResponse(res, cached.response, cached.statusCode, cached.headers);
        return;
      }

      // Acquire lock
      const acquired = await storage.acquireLock(cacheKey, config.lockTimeout ?? 30000);
      if (!acquired) {
        await storage.waitForLock(
          cacheKey,
          config.lockTimeout ?? 30000,
          config.lockPollInterval ?? 100
        );
        const cached = await storage.get(cacheKey);
        if (!cached) {
          throw new IdempotencyError(
            IdempotencyErrorCode.CONFLICT,
            'Idempotency-Key In Use'
          );
        }
        options.setResponse(res, cached.response, cached.statusCode, cached.headers);
        return;
      }

      try {
        // Execute next handler
        if (next) {
          await next();
        } else {
          await options.executeNext(ctx);
        }

        // Capture and cache response
        const { statusCode, body, headers } = options.getResponse(res);
        await storage.set(cacheKey, {
          response: body,
          statusCode,
          headers,
          createdAt: Date.now(),
          ttl: config.ttl ?? 86400000,
        });
      } catch (error) {
        await storage.set(cacheKey, {
          response: error,
          statusCode: (error as { statusCode?: number })?.statusCode ?? 500,
          createdAt: Date.now(),
          ttl: Math.min(config.lockTimeout ?? 30000, config.ttl ?? 86400000),
        }).catch(() => {});
        throw error;
      } finally {
        await storage.releaseLock(cacheKey).catch(() => {});
      }
    } catch (error) {
      if (error instanceof IdempotencyError) {
        if (options.handleError) {
          options.handleError(ctx, error);
        } else {
          throw error;
        }
        return;
      }
      throw error;
    }
  };
}
```

## Workflow Integration

### Input Reception
1. Receive framework integration requirements
2. Review middleware specifications
3. Identify framework-specific considerations
4. Create integration plan

### Implementation Phase
1. Set up framework-specific middleware
2. Handle framework lifecycle properly
3. Integrate error handling
4. Add type definitions
5. Optimize for performance

### Testing Phase
1. Write unit tests for each integration
2. Test framework-specific behaviors
3. Test error scenarios
4. Measure performance overhead

### Output Delivery
1. Complete framework integrations
2. Type definitions for each framework
3. Integration test suite
4. Usage examples and documentation

## Communication Protocol

### With Core Developer
```json
{
  "from": "framework-integrator",
  "to": ["core-developer"],
  "type": "request",
  "subject": "Middleware integration requirements",
  "content": {
    "requirements": {
      "contextExtraction": "Need to extract method, path, headers from context",
      "responseCapture": "Need to capture response for caching",
      "errorHandling": "Need proper error propagation per framework"
    },
    "frameworks": ["Express", "Koa", "Raw"]
  }
}
```

### With Test Engineer
```json
{
  "from": "framework-integrator",
  "to": ["test-engineer"],
  "type": "request",
  "subject": "Framework integration testing",
  "content": {
    "testScenarios": [
      "Cache hit returns stored response",
      "Cache miss executes handler",
      "Concurrent requests handled correctly",
      "Error handling per framework",
      "Type safety verification"
    ],
    "frameworks": ["Express", "Koa"]
  }
}
```

## Success Metrics

### Integration Metrics
- **Framework Support**: Express, Koa, raw handler
- **Test Coverage**: >90% for each integration
- **Performance**: <5ms middleware overhead
- **Type Safety**: 100% TypeScript strict mode

### Quality Metrics
- **Framework Compliance**: Follows framework conventions
- **Error Handling**: Proper error propagation
- **Documentation**: Complete usage examples
- **Backward Compatibility**: No breaking changes

## Continuous Improvement

### Framework Updates
- Stay updated on framework changes
- Support new framework versions
- Add support for new frameworks
- Improve integration patterns

### Performance Optimization
- Reduce middleware overhead
- Optimize context extraction
- Improve response handling
- Add performance monitoring

### Feature Enhancement
- Add support for more frameworks (Fastify, Hapi, etc.)
- Implement streaming response support
- Add WebSocket idempotency
- Support GraphQL operations

## References

- [DEV_PLAN.md](../../DEV_PLAN.md) - Development plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Technical architecture
- [AGENTS.md](../../AGENTS.md) - Agent system overview
