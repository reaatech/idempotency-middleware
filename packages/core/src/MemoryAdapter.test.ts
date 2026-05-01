import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from './MemoryAdapter.js';
import { IdempotencyError, IdempotencyErrorCode } from './errors.js';
import type { IdempotencyRecord } from './types.js';

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
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

  it('should return null for missing keys', async () => {
    const result = await adapter.get('non-existent-key');
    expect(result).toBeNull();
  });

  it('should delete cached responses', async () => {
    const record: IdempotencyRecord = {
      response: { data: 'test' },
      createdAt: Date.now(),
      ttl: 60000,
    };

    await adapter.set('delete-test-key', record);
    await adapter.delete('delete-test-key');

    const result = await adapter.get('delete-test-key');
    expect(result).toBeNull();
  });

  it('should expire entries after TTL', async () => {
    const record: IdempotencyRecord = {
      response: { data: 'test' },
      createdAt: Date.now(),
      ttl: 50,
    };

    await adapter.set('ttl-test-key', record);

    expect(await adapter.get('ttl-test-key')).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await adapter.get('ttl-test-key')).toBeNull();
  });

  describe('locking', () => {
    it('should acquire and release locks', async () => {
      const acquired = await adapter.acquireLock('lock-key', 1000);
      expect(acquired).toBe(true);

      const acquired2 = await adapter.acquireLock('lock-key', 1000);
      expect(acquired2).toBe(false);

      await adapter.releaseLock('lock-key');

      const acquired3 = await adapter.acquireLock('lock-key', 1000);
      expect(acquired3).toBe(true);
    });

    it('should wait for lock release', async () => {
      await adapter.acquireLock('wait-key', 5000);

      const waitPromise = adapter.waitForLock('wait-key', 1000, 10);

      setTimeout(() => adapter.releaseLock('wait-key'), 50);

      await expect(waitPromise).resolves.toBeUndefined();
    });

    it('should timeout waiting for lock', async () => {
      await adapter.acquireLock('timeout-key', 5000);

      await expect(adapter.waitForLock('timeout-key', 50, 10)).rejects.toThrow(
        'Lock wait timeout exceeded',
      );
    });

    it('should auto-release lock after TTL', async () => {
      await adapter.acquireLock('auto-release-key', 50);

      expect(await adapter.acquireLock('auto-release-key', 1000)).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await adapter.acquireLock('auto-release-key', 1000)).toBe(true);
    });
  });

  describe('not-connected', () => {
    it('throws NOT_CONNECTED on get/set when not connected', async () => {
      const fresh = new MemoryAdapter();

      await expect(fresh.get('k')).rejects.toMatchObject({
        code: IdempotencyErrorCode.NOT_CONNECTED,
      });
      await expect(
        fresh.set('k', { response: {}, createdAt: Date.now(), ttl: 1000 }),
      ).rejects.toBeInstanceOf(IdempotencyError);
    });
  });
});
