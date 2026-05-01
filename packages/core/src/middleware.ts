import type { StorageAdapter } from './StorageAdapter.js';
import { IdempotencyError, IdempotencyErrorCode } from './errors.js';
import { extractVaryHeaders, generateCacheKey, hashBody } from './hash.js';
import { deserializeResponse, serializeResponse } from './serialize.js';
import type { CacheKeyOptions, IdempotencyConfig, IdempotencyRecord } from './types.js';

interface ResolvedConfig extends Required<Omit<IdempotencyConfig, 'lockTtl'>> {
  lockTtl: number;
}

export class IdempotencyMiddleware {
  private readonly storage: StorageAdapter;
  private readonly config: ResolvedConfig;

  constructor(storage: StorageAdapter, config: IdempotencyConfig = {}) {
    const lockTimeout = config.lockTimeout ?? 30 * 1000;
    this.storage = storage;
    this.config = {
      headerName: config.headerName ?? 'Idempotency-Key',
      ttl: config.ttl ?? 24 * 60 * 60 * 1000,
      methods: config.methods ?? ['POST', 'PUT', 'PATCH'],
      getKey: config.getKey ?? ((): string | undefined => undefined),
      shouldCache: config.shouldCache ?? ((): boolean => true),
      varyHeaders: config.varyHeaders ?? [],
      includeBodyInKey: config.includeBodyInKey ?? true,
      maxKeyLength: config.maxKeyLength ?? 256,
      lockTimeout,
      lockTtl: config.lockTtl ?? lockTimeout,
      lockPollInterval: config.lockPollInterval ?? 100,
    };
  }

  async execute<T, R>(key: string, context: T, handler: () => Promise<R>): Promise<R> {
    if (!key || key.trim() === '') {
      throw new IdempotencyError(IdempotencyErrorCode.KEY_REQUIRED, 'Idempotency key is required');
    }
    if (key.length > this.config.maxKeyLength) {
      throw new IdempotencyError(
        IdempotencyErrorCode.KEY_REQUIRED,
        `Idempotency key exceeds maximum length of ${this.config.maxKeyLength} characters`,
      );
    }

    const cacheKey = this.generateCacheKey(key, context);

    const cached = await this.storage.get(cacheKey);
    if (cached) {
      const response = deserializeResponse(cached.response);
      if (response instanceof Error) {
        throw response;
      }
      return response as R;
    }

    const lockAcquired = await this.storage.acquireLock(cacheKey, this.config.lockTtl);

    if (lockAcquired) {
      try {
        const doubleCheck = await this.storage.get(cacheKey);
        if (doubleCheck) {
          const response = deserializeResponse(doubleCheck.response);
          if (response instanceof Error) {
            throw response;
          }
          return response as R;
        }

        const response = await handler();

        if (this.config.shouldCache(response)) {
          const record: IdempotencyRecord = {
            response: serializeResponse(response),
            createdAt: Date.now(),
            ttl: this.config.ttl,
          };
          await this.storage.set(cacheKey, record);
        }

        return response;
      } catch (error) {
        if (this.config.shouldCache(error)) {
          await this.storage
            .set(cacheKey, {
              response: serializeResponse(error),
              createdAt: Date.now(),
              ttl: Math.min(this.config.lockTtl, this.config.ttl),
            })
            .catch(() => {
              // Best-effort
            });
        }
        throw error;
      } finally {
        await this.storage.releaseLock(cacheKey).catch(() => {
          // Best-effort
        });
      }
    } else {
      await this.storage.waitForLock(
        cacheKey,
        this.config.lockTimeout,
        this.config.lockPollInterval,
      );

      const cached = await this.storage.get(cacheKey);
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
      return response as R;
    }
  }

  private generateCacheKey(idempotencyKey: string, context: unknown): string {
    const options: CacheKeyOptions = {
      idempotencyKey,
      method: 'POST',
      path: '/',
    };

    if (context && typeof context === 'object') {
      const ctx = context as Record<string, unknown>;
      if (typeof ctx.method === 'string') {
        options.method = ctx.method;
      }
      if (typeof ctx.path === 'string') {
        options.path = ctx.path;
      }

      if (this.config.varyHeaders.length > 0 && ctx.headers) {
        options.varyHeaders = extractVaryHeaders(
          ctx.headers as Record<string, string | string[] | undefined>,
          this.config.varyHeaders,
        );
      }

      if (this.config.includeBodyInKey) {
        const body = ctx.body ?? ctx.input;
        if (body !== undefined) {
          options.bodyHash = hashBody(body);
        }
      }
    }

    return generateCacheKey(options);
  }
}
