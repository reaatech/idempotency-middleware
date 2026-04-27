import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisAdapter } from '../../src/adapters/RedisAdapter.js';
import type { Redis } from 'ioredis';
import type { IdempotencyRecord } from '../../src/core/types.js';

describe('RedisAdapter', () => {
  let mockClient: Redis;
  let adapter: RedisAdapter;

  beforeEach(() => {
    mockClient = {
      ping: vi.fn().mockResolvedValue('PONG'),
      quit: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(0),
      eval: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    adapter = new RedisAdapter(mockClient);
  });

  it('should connect and disconnect', async () => {
    await adapter.connect();
    expect(mockClient.ping).toHaveBeenCalled();

    await adapter.disconnect();
    expect(mockClient.quit).toHaveBeenCalled();
  });

  it('should store and retrieve responses', async () => {
    const record: IdempotencyRecord = {
      response: { id: 1 },
      createdAt: Date.now(),
      ttl: 60000,
    };

    vi.mocked(mockClient.get).mockResolvedValue(JSON.stringify(record));

    await adapter.set('test-key', record);
    const retrieved = await adapter.get('test-key');

    expect(retrieved).toEqual(record);
  });

  it('should return null for missing keys', async () => {
    const result = await adapter.get('missing-key');
    expect(result).toBeNull();
  });

  it('should delete cached responses', async () => {
    await adapter.delete('delete-key');
    expect(mockClient.del).toHaveBeenCalledWith('delete-key');
  });

  it('should handle corrupted data gracefully', async () => {
    vi.mocked(mockClient.get).mockResolvedValue('invalid-json');

    const result = await adapter.get('corrupt-key');
    expect(result).toBeNull();
    expect(mockClient.del).toHaveBeenCalledWith('corrupt-key');
  });

  describe('locking', () => {
    it('should acquire lock with SET NX', async () => {
      vi.mocked(mockClient.set).mockResolvedValue('OK');

      const acquired = await adapter.acquireLock('lock-key', 30000);

      expect(acquired).toBe(true);
      expect(mockClient.set).toHaveBeenCalledWith(
        'lock:lock-key',
        expect.any(String),
        'EX',
        30,
        'NX'
      );
    });

    it('should fail to acquire if lock exists', async () => {
      vi.mocked(mockClient.set).mockResolvedValue(null);

      const acquired = await adapter.acquireLock('lock-key', 30000);
      expect(acquired).toBe(false);
    });

    it('should release lock with token-guarded eval', async () => {
      vi.mocked(mockClient.set).mockResolvedValue('OK');
      await adapter.acquireLock('lock-key', 30000);

      const acquireCall = vi.mocked(mockClient.set).mock.calls[0];
      const token = acquireCall[1];

      await adapter.releaseLock('lock-key');

      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'lock:lock-key',
        token
      );
    });

    it('should noop releaseLock if no token was acquired', async () => {
      await adapter.releaseLock('never-acquired');
      expect(mockClient.eval).not.toHaveBeenCalled();
      expect(mockClient.del).not.toHaveBeenCalledWith('lock:never-acquired');
    });

    it('should wait for lock release', async () => {
      vi.mocked(mockClient.exists)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);

      await adapter.waitForLock('wait-key', 1000, 10);

      expect(mockClient.exists).toHaveBeenCalledWith('lock:wait-key');
    });

    it('should timeout waiting for lock', async () => {
      vi.mocked(mockClient.exists).mockResolvedValue(1);

      await expect(adapter.waitForLock('timeout-key', 50, 10)).rejects.toThrow(
        'Lock wait timeout exceeded'
      );
    });
  });
});
