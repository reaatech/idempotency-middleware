import type { StorageAdapter } from './StorageAdapter.js';
import { IdempotencyError, IdempotencyErrorCode } from './errors.js';
import { extractVaryHeaders, generateCacheKey, hashBody } from './hash.js';
import { deserializeResponse, serializeResponse } from './serialize.js';
import type { IdempotencyConfig } from './types.js';

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
  context: RawHandlerContext,
) => Promise<TOutput>;

/**
 * Create a wrapped handler with idempotency
 */
export function idempotentHandler<TInput = unknown, TOutput = unknown>(
  storage: StorageAdapter,
  handler: RawHandler<TInput, TOutput>,
  config: IdempotencyConfig = {},
): (
  input: TInput,
  idempotencyKey: string,
  context?: Partial<RawHandlerContext>,
) => Promise<TOutput> {
  const lockTimeout = config.lockTimeout ?? 30000;
  const lockTtl = config.lockTtl ?? lockTimeout;
  const lockPollInterval = config.lockPollInterval ?? 100;
  const ttl = config.ttl ?? 86400000;
  const includeBodyInKey = config.includeBodyInKey ?? true;
  const varyHeaders = config.varyHeaders ?? [];
  const maxKeyLength = config.maxKeyLength ?? 256;
  const shouldCache = config.shouldCache ?? ((): boolean => true);

  return async (
    input: TInput,
    idempotencyKey: string,
    context: Partial<RawHandlerContext> = {},
  ): Promise<TOutput> => {
    if (!idempotencyKey || idempotencyKey.trim() === '') {
      throw new IdempotencyError(
        IdempotencyErrorCode.KEY_REQUIRED,
        'Idempotency key is required for raw handler',
      );
    }
    if (idempotencyKey.length > maxKeyLength) {
      throw new IdempotencyError(
        IdempotencyErrorCode.KEY_REQUIRED,
        `Idempotency key exceeds maximum length of ${maxKeyLength} characters`,
      );
    }

    const cacheKey = generateCacheKey({
      idempotencyKey,
      method: context.method ?? 'POST',
      path: context.path ?? '/',
      bodyHash: includeBodyInKey ? hashBody(input) : undefined,
      varyHeaders: extractVaryHeaders(context.headers ?? {}, varyHeaders),
    });

    const cached = await storage.get(cacheKey);
    if (cached) {
      const response = deserializeResponse(cached.response);
      if (response instanceof Error) {
        throw response;
      }
      return response as TOutput;
    }

    const acquired = await storage.acquireLock(cacheKey, lockTtl);
    if (!acquired) {
      await storage.waitForLock(cacheKey, lockTimeout, lockPollInterval);
      const cached = await storage.get(cacheKey);
      if (!cached) {
        throw new IdempotencyError(
          IdempotencyErrorCode.CONFLICT,
          'Idempotency-Key In Use. The original request is still processing or failed. Please retry with a new key.',
        );
      }
      const response = deserializeResponse(cached.response);
      if (response instanceof Error) {
        throw response;
      }
      return response as TOutput;
    }

    const fullContext: RawHandlerContext = {
      method: context.method ?? 'POST',
      path: context.path ?? '/',
      headers: context.headers ?? {},
      body: input,
      ...context,
    };

    try {
      const result = await handler(input, fullContext);
      if (shouldCache(result)) {
        await storage.set(cacheKey, {
          response: serializeResponse(result),
          createdAt: Date.now(),
          ttl,
        });
      }
      return result;
    } catch (error) {
      if (shouldCache(error)) {
        await storage
          .set(cacheKey, {
            response: serializeResponse(error),
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
  };
}

/**
 * Helper to create context for common use cases
 */
export function createHandlerContext(
  overrides: Partial<RawHandlerContext> = {},
): RawHandlerContext {
  return {
    method: 'POST',
    path: '/',
    headers: {},
    ...overrides,
  };
}
