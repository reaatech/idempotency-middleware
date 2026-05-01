import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { idempotentHandler, createHandlerContext } from './handler.js';
import { MemoryAdapter } from './MemoryAdapter.js';
import { IdempotencyError, IdempotencyErrorCode } from './errors.js';

describe('idempotentHandler', () => {
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('should execute and cache handler result', async () => {
    const handler = async (input: { name: string }) => ({
      id: 1,
      name: input.name,
    });

    const wrapped = idempotentHandler(adapter, handler);
    const result = await wrapped({ name: 'Test' }, 'key-1');

    expect(result).toEqual({ id: 1, name: 'Test' });

    const result2 = await wrapped({ name: 'Test' }, 'key-1');
    expect(result2).toEqual({ id: 1, name: 'Test' });
  });

  it('should throw KEY_REQUIRED for empty key', async () => {
    const handler = async () => 'result';
    const wrapped = idempotentHandler(adapter, handler);

    await expect(wrapped('input', '')).rejects.toThrow(IdempotencyError);
    await expect(wrapped('input', '   ')).rejects.toThrow(IdempotencyError);
  });

  it('should throw KEY_REQUIRED when key exceeds maxKeyLength', async () => {
    const handler = async () => 'result';
    const wrapped = idempotentHandler(adapter, handler, { maxKeyLength: 8 });

    await expect(wrapped('input', 'this-key-is-way-too-long')).rejects.toMatchObject({
      code: IdempotencyErrorCode.KEY_REQUIRED,
    });
  });

  it('should skip caching when shouldCache returns false', async () => {
    let callCount = 0;
    const handler = async () => {
      callCount++;
      return { count: callCount };
    };

    const wrapped = idempotentHandler(adapter, handler, {
      shouldCache: () => false,
    });

    const r1 = await wrapped('input', 'no-cache-key');
    const r2 = await wrapped('input', 'no-cache-key');
    expect(r1).toEqual({ count: 1 });
    expect(r2).toEqual({ count: 2 });
  });

  it('should cache and replay errors', async () => {
    let callCount = 0;
    const handler = async () => {
      callCount++;
      throw new Error('Handler failed');
    };

    const wrapped = idempotentHandler(adapter, handler);

    await expect(wrapped('input', 'error-key')).rejects.toThrow('Handler failed');
    expect(callCount).toBe(1);

    await expect(wrapped('input', 'error-key')).rejects.toThrow('Handler failed');
    expect(callCount).toBe(1);
  });

  it('should include body hash in cache key by default', async () => {
    let callCount = 0;
    const handler = async (input: number) => {
      callCount++;
      return input * 2;
    };

    const wrapped = idempotentHandler(adapter, handler);

    const result1 = await wrapped(5, 'body-key');
    expect(result1).toBe(10);

    const result2 = await wrapped(10, 'body-key');
    expect(result2).toBe(20);
    expect(callCount).toBe(2);
  });

  it('should reuse cache key when body is same', async () => {
    let callCount = 0;
    const handler = async (input: number) => {
      callCount++;
      return input * 2;
    };

    const wrapped = idempotentHandler(adapter, handler);

    const result1 = await wrapped(5, 'same-body-key');
    const result2 = await wrapped(5, 'same-body-key');

    expect(result1).toBe(10);
    expect(result2).toBe(10);
    expect(callCount).toBe(1);
  });

  it('should return 409 conflict when lock holder crashes', async () => {
    adapter.acquireLock = async () => false;
    adapter.waitForLock = async () => undefined;
    adapter.get = async () => null;

    const handler = async () => 'result';
    const wrapped = idempotentHandler(adapter, handler);

    await expect(wrapped('input', 'conflict-key')).rejects.toThrow(
      'Idempotency-Key In Use',
    );
  });

  it('should throw cached error when lock holder stored an error', async () => {
    adapter.acquireLock = async () => false;
    adapter.waitForLock = async () => undefined;
    const cachedError = new Error('Previous failure');
    let getCallCount = 0;
    adapter.get = async () => {
      getCallCount++;
      if (getCallCount === 1) return null;
      return {
        response: cachedError,
        createdAt: Date.now(),
        ttl: 60000,
      };
    };

    const handler = async () => 'result';
    const wrapped = idempotentHandler(adapter, handler);

    await expect(wrapped('input', 'cached-error-key')).rejects.toThrow(
      'Previous failure',
    );
  });

  it('should return cached response after waiting for lock', async () => {
    adapter.acquireLock = async () => false;
    adapter.waitForLock = async () => undefined;
    let getCallCount = 0;
    adapter.get = async () => {
      getCallCount++;
      if (getCallCount === 1) return null;
      return {
        response: { cached: true },
        statusCode: 200,
        createdAt: Date.now(),
        ttl: 60000,
      };
    };

    const handler = async () => 'result';
    const wrapped = idempotentHandler(adapter, handler);

    const result = await wrapped('input', 'cached-success-key');
    expect(result).toEqual({ cached: true });
  });

  it('should not include body hash when includeBodyInKey is false', async () => {
    let callCount = 0;
    const handler = async (input: number) => {
      callCount++;
      return input * 2;
    };

    const wrapped = idempotentHandler(adapter, handler, {
      includeBodyInKey: false,
    });

    const result1 = await wrapped(5, 'no-body-key');
    expect(result1).toBe(10);

    const result2 = await wrapped(999, 'no-body-key');
    expect(result2).toBe(10);
    expect(callCount).toBe(1);
  });

  it('should accept custom context', async () => {
    const handler = async (_input: string, context: { method: string }) => context.method;
    const wrapped = idempotentHandler(adapter, handler);

    const result = await wrapped('input', 'ctx-key', { method: 'PUT', path: '/items' });
    expect(result).toBe('PUT');
  });
});

describe('createHandlerContext', () => {
  it('should create default context', () => {
    const ctx = createHandlerContext();
    expect(ctx.method).toBe('POST');
    expect(ctx.path).toBe('/');
    expect(ctx.headers).toEqual({});
  });

  it('should apply overrides', () => {
    const ctx = createHandlerContext({ method: 'PUT', path: '/api' });
    expect(ctx.method).toBe('PUT');
    expect(ctx.path).toBe('/api');
  });
});
