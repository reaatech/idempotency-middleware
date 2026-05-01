import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IdempotencyMiddleware } from './middleware.js';
import { MemoryAdapter } from './MemoryAdapter.js';
import { IdempotencyError } from './errors.js';
import type { StorageAdapter } from './StorageAdapter.js';

describe('IdempotencyMiddleware', () => {
  let storage: StorageAdapter;
  let middleware: IdempotencyMiddleware;

  beforeEach(async () => {
    storage = new MemoryAdapter();
    await storage.connect();
    middleware = new IdempotencyMiddleware(storage, {
      ttl: 3600000,
      lockTimeout: 30000,
    });
  });

  afterEach(async () => {
    await storage.disconnect();
  });

  it('should return cached response on cache hit', async () => {
    const cachedResponse = { data: 'cached' };

    const setupHandler = vi.fn().mockResolvedValue(cachedResponse);
    await middleware.execute('test-key', {}, setupHandler);

    const handler = vi.fn().mockResolvedValue({ data: 'new' });
    const result = await middleware.execute('test-key', {}, handler);

    expect(result).toEqual(cachedResponse);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should execute handler and cache response on cache miss', async () => {
    const handlerResponse = { data: 'new' };
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const result = await middleware.execute('test-key', {}, handler);

    expect(result).toEqual(handlerResponse);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should throw error when idempotency key is missing', async () => {
    const handler = vi.fn();

    await expect(middleware.execute('', {}, handler)).rejects.toThrow(IdempotencyError);
    await expect(middleware.execute('   ', {}, handler)).rejects.toThrow(IdempotencyError);
  });

  it('should throw error when idempotency key exceeds max length', async () => {
    const handler = vi.fn();
    const longKey = 'a'.repeat(257);

    await expect(middleware.execute(longKey, {}, handler)).rejects.toThrow(IdempotencyError);
  });

  it('should handle concurrent duplicate requests correctly', async () => {
    const originalAcquire = storage.acquireLock.bind(storage);
    storage.acquireLock = vi.fn(async (key: string, ttl: number) => {
      return originalAcquire(key, ttl);
    });

    const originalWait = storage.waitForLock.bind(storage);
    storage.waitForLock = vi.fn(
      async (key: string, timeout: number, pollInterval: number) => {
        await originalWait(key, timeout, pollInterval);
      },
    );

    const handler = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { data: 'result' };
    });

    const [result1, result2] = await Promise.all([
      middleware.execute('same-key', {}, handler),
      middleware.execute('same-key', {}, handler),
    ]);

    expect(result1).toEqual({ data: 'result' });
    expect(result2).toEqual({ data: 'result' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should cache error responses for idempotency', async () => {
    const error = new Error('Payment failed');
    const handler = vi.fn().mockRejectedValue(error);

    await expect(middleware.execute('error-key', {}, handler)).rejects.toThrow(
      'Payment failed',
    );

    await expect(middleware.execute('error-key', {}, handler)).rejects.toThrow(
      'Payment failed',
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should replay errors stored as JSON-serialized payloads', async () => {
    const cachedAt = Date.now();
    storage.get = vi.fn(async () => ({
      response: {
        '@@idempotency/error': true,
        name: 'PaymentError',
        message: 'Card declined',
        stack: 'fake stack',
      },
      createdAt: cachedAt,
      ttl: 60000,
    }));

    const handler = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      middleware.execute('serialized-error-key', {}, handler),
    ).rejects.toThrow('Card declined');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should return 409 conflict when lock holder crashes without storing', async () => {
    storage.acquireLock = vi.fn().mockResolvedValue(false);
    storage.waitForLock = vi.fn().mockResolvedValue(undefined);
    storage.get = vi.fn().mockResolvedValue(null);

    const handler = vi.fn();

    await expect(middleware.execute('conflict-key', {}, handler)).rejects.toThrow(
      'Idempotency-Key In Use',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not cache when shouldCache returns false', async () => {
    const customMiddleware = new IdempotencyMiddleware(storage, {
      ttl: 3600000,
      shouldCache: () => false,
    });

    const handlerResponse = { data: 'new' };
    const handler = vi.fn().mockResolvedValue(handlerResponse);

    const result = await customMiddleware.execute('no-cache-key', {}, handler);
    expect(result).toEqual(handlerResponse);

    await storage.get(expect.stringContaining('no-cache-key') as unknown as string);
    const handler2 = vi.fn().mockResolvedValue({ data: 'different' });
    const result2 = await customMiddleware.execute('no-cache-key', {}, handler2);
    expect(result2).toEqual({ data: 'different' });
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('should include body hash in cache key by default', async () => {
    const handler = vi.fn().mockResolvedValue({ data: 'result' });

    const result1 = await middleware.execute(
      'body-key',
      { body: { amount: 100 } },
      handler,
    );
    const result2 = await middleware.execute(
      'body-key',
      { body: { amount: 200 } },
      handler,
    );

    expect(result1).toEqual({ data: 'result' });
    expect(result2).toEqual({ data: 'result' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should reuse cache key when body is same', async () => {
    const handler = vi.fn().mockResolvedValue({ data: 'result' });

    const result1 = await middleware.execute(
      'same-body-key',
      { body: { amount: 100 } },
      handler,
    );
    const result2 = await middleware.execute(
      'same-body-key',
      { body: { amount: 100 } },
      handler,
    );

    expect(result1).toEqual({ data: 'result' });
    expect(result2).toEqual({ data: 'result' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should use vary headers in cache key when configured', async () => {
    const varyMiddleware = new IdempotencyMiddleware(storage, {
      ttl: 3600000,
      varyHeaders: ['x-client-version'],
    });

    const handler = vi.fn().mockResolvedValue({ data: 'result' });

    const result1 = await varyMiddleware.execute(
      'vary-key',
      {
        headers: { 'x-client-version': '1.0' },
      },
      handler,
    );

    const result2 = await varyMiddleware.execute(
      'vary-key',
      {
        headers: { 'x-client-version': '2.0' },
      },
      handler,
    );

    expect(result1).toEqual({ data: 'result' });
    expect(result2).toEqual({ data: 'result' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should extract method and path from context', async () => {
    const handler = vi.fn().mockResolvedValue({ data: 'result' });

    const result = await middleware.execute(
      'ctx-key',
      {
        method: 'PUT',
        path: '/api/items/123',
      },
      handler,
    );

    expect(result).toEqual({ data: 'result' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should throw cached error after waiting for lock', async () => {
    const cachedError = new Error('Previous handler failed');
    let getCallCount = 0;
    storage.get = vi.fn(async (_key: string) => {
      getCallCount++;
      if (getCallCount === 1) return null;
      return {
        response: cachedError,
        createdAt: Date.now(),
        ttl: 60000,
      };
    });
    storage.acquireLock = vi.fn().mockResolvedValue(false);
    storage.waitForLock = vi.fn().mockResolvedValue(undefined);

    const handler = vi.fn().mockResolvedValue({ data: 'new' });

    await expect(
      middleware.execute('cached-error-key', {}, handler),
    ).rejects.toThrow('Previous handler failed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should return double-checked cached response after acquiring lock', async () => {
    const cachedResponse = { data: 'double-checked' };
    let getCallCount = 0;
    storage.get = vi.fn(async (_key: string) => {
      getCallCount++;
      if (getCallCount === 1) return null;
      return {
        response: cachedResponse,
        statusCode: 200,
        createdAt: Date.now(),
        ttl: 60000,
      };
    });

    const handler = vi.fn().mockResolvedValue({ data: 'new' });

    const result = await middleware.execute('double-check-key', {}, handler);

    expect(result).toEqual({ data: 'double-checked' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should throw double-checked cached error after acquiring lock', async () => {
    const cachedError = new Error('Double-check error');
    let getCallCount = 0;
    storage.get = vi.fn(async (_key: string) => {
      getCallCount++;
      if (getCallCount === 1) return null;
      return {
        response: cachedError,
        createdAt: Date.now(),
        ttl: 60000,
      };
    });

    const handler = vi.fn().mockResolvedValue({ data: 'new' });

    await expect(
      middleware.execute('double-check-error-key', {}, handler),
    ).rejects.toThrow('Double-check error');
    expect(handler).not.toHaveBeenCalled();
  });
});
