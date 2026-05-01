import type { Context, Next, Request as KoaRequest } from 'koa';
import {
  IdempotencyError,
  IdempotencyErrorCode,
  generateCacheKey,
  hashBody,
  extractVaryHeaders,
  serializeResponse,
  deserializeResponse,
  normalizeHeaders,
} from '@reaatech/idempotency-middleware';
import type {
  StorageAdapter,
  IdempotencyConfig,
} from '@reaatech/idempotency-middleware';

export interface KoaIdempotencyConfig extends IdempotencyConfig {
  /**
   * Custom error handler for Koa
   */
  errorHandler?: (ctx: Context, err: IdempotencyError) => void;
}

interface RequestWithBody extends KoaRequest {
  body?: unknown;
}

function applyCachedResponse(
  ctx: Context,
  statusCode: number | undefined,
  headers: Record<string, string> | undefined,
  body: unknown,
): void {
  ctx.status = statusCode ?? 200;
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      const lower = k.toLowerCase();
      if (lower === 'content-length' || lower === 'transfer-encoding') {
        continue;
      }
      ctx.set(k, v);
    }
  }
  ctx.body = body;
}

/**
 * Create Koa middleware for idempotency
 */
export function idempotentKoa(
  storage: StorageAdapter,
  config: KoaIdempotencyConfig = {},
): (ctx: Context, next: Next) => Promise<void> {
  const methods = config.methods ?? ['POST', 'PUT', 'PATCH'];
  const headerName = config.headerName ?? 'Idempotency-Key';
  const lockTimeout = config.lockTimeout ?? 30000;
  const lockTtl = config.lockTtl ?? lockTimeout;
  const lockPollInterval = config.lockPollInterval ?? 100;
  const ttl = config.ttl ?? 86400000;
  const includeBodyInKey = config.includeBodyInKey ?? true;
  const varyHeaders = config.varyHeaders ?? [];
  const maxKeyLength = config.maxKeyLength ?? 256;
  const shouldCache = config.shouldCache ?? ((): boolean => true);
  const getKey = config.getKey;

  return async (ctx: Context, next: Next) => {
    try {
      if (!methods.includes(ctx.method)) {
        await next();
        return;
      }

      let key: string | undefined;
      if (getKey) {
        const candidate = getKey(ctx);
        if (typeof candidate === 'string' && candidate.length > 0) {
          key = candidate;
        }
      }
      if (!key) {
        const headerValue = ctx.get(headerName);
        if (headerValue) {
          key = headerValue;
        }
      }
      if (!key) {
        await next();
        return;
      }

      if (key.length > maxKeyLength) {
        throw new IdempotencyError(
          IdempotencyErrorCode.KEY_REQUIRED,
          `Idempotency key exceeds maximum length of ${maxKeyLength} characters`,
        );
      }

      const requestBody = (ctx.request as RequestWithBody).body;

      const cacheKey = generateCacheKey({
        idempotencyKey: key,
        method: ctx.method,
        path: ctx.path,
        bodyHash: includeBodyInKey ? hashBody(requestBody) : undefined,
        varyHeaders: extractVaryHeaders(ctx.headers, varyHeaders),
      });

      const cached = await storage.get(cacheKey);
      if (cached) {
        applyCachedResponse(
          ctx,
          cached.statusCode,
          cached.headers,
          deserializeResponse(cached.response),
        );
        return;
      }

      const acquired = await storage.acquireLock(cacheKey, lockTtl);

      if (!acquired) {
        await storage.waitForLock(cacheKey, lockTimeout, lockPollInterval);
        const cached = await storage.get(cacheKey);
        if (!cached) {
          ctx.status = 409;
          ctx.body = { error: 'Idempotency-Key In Use' };
          return;
        }
        applyCachedResponse(
          ctx,
          cached.statusCode,
          cached.headers,
          deserializeResponse(cached.response),
        );
        return;
      }

      const doubleCheck = await storage.get(cacheKey);
      if (doubleCheck) {
        applyCachedResponse(
          ctx,
          doubleCheck.statusCode,
          doubleCheck.headers,
          deserializeResponse(doubleCheck.response),
        );
        await storage.releaseLock(cacheKey).catch(() => {
          // Best-effort
        });
        return;
      }

      try {
        await next();

        const responseBody = ctx.body;
        if (shouldCache(responseBody)) {
          await storage.set(cacheKey, {
            response: serializeResponse(responseBody),
            statusCode: ctx.status,
            headers: normalizeHeaders(ctx.response.headers),
            createdAt: Date.now(),
            ttl,
          });
        }
      } catch (error) {
        if (shouldCache(error)) {
          await storage
            .set(cacheKey, {
              response: serializeResponse(error),
              statusCode: (error as { status?: number }).status ?? 500,
              createdAt: Date.now(),
              ttl: Math.min(lockTtl, ttl),
            })
            .catch(() => {
              // Best-effort
            });
        }
        throw error;
      } finally {
        await storage.releaseLock(cacheKey).catch(() => {
          // Best-effort
        });
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
