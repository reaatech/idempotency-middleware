import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FirestoreAdapter } from '../../src/adapters/FirestoreAdapter.js';
import type { IdempotencyRecord } from '../../src/core/types.js';

function createMockFirestore() {
  const docs = new Map<string, { exists: boolean; data: () => Record<string, unknown> }>();

  return {
    collection: vi.fn(() => ({
      doc: vi.fn((id: string) => ({
        get: vi.fn(async () => {
          const doc = docs.get(id);
          return doc ?? { exists: false, data: () => ({}) };
        }),
        set: vi.fn(async (data: Record<string, unknown>) => {
          docs.set(id, { exists: true, data: () => data });
        }),
        delete: vi.fn(async () => {
          docs.delete(id);
        }),
      })),
    })),
    runTransaction: vi.fn(async (fn: (t: unknown) => Promise<void>) => {
      const transaction = {
        get: vi.fn(async (docRef: { get: () => Promise<unknown>; set: (data: Record<string, unknown>) => Promise<void> }) => {
          return docRef.get();
        }),
        set: vi.fn((docRef: { get: () => Promise<unknown>; set: (data: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) => {
          // Persist via the docRef's set method
          void docRef.set(data);
        }),
      };
      await fn(transaction);
    }),
  };
}

describe('FirestoreAdapter', () => {
  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let adapter: FirestoreAdapter;

  beforeEach(() => {
    mockFirestore = createMockFirestore();
    adapter = new FirestoreAdapter(mockFirestore as unknown as import('@google-cloud/firestore').Firestore);
  });

  it('should store and retrieve responses', async () => {
    const record: IdempotencyRecord = {
      response: { id: 1 },
      createdAt: Date.now(),
      ttl: 60000,
    };

    await adapter.set('test-key', record);
    const retrieved = await adapter.get('test-key');

    expect(retrieved).toMatchObject({
      response: { id: 1 },
      createdAt: record.createdAt,
      ttl: 60000,
    });
  });

  it('should return null for missing keys', async () => {
    const result = await adapter.get('missing-key');
    expect(result).toBeNull();
  });

  it('should delete cached responses', async () => {
    const record: IdempotencyRecord = {
      response: { data: 'test' },
      createdAt: Date.now(),
      ttl: 60000,
    };

    await adapter.set('delete-key', record);
    await adapter.delete('delete-key');

    const result = await adapter.get('delete-key');
    expect(result).toBeNull();
  });

  it('should expire entries after TTL', async () => {
    const record: IdempotencyRecord = {
      response: { data: 'test' },
      createdAt: Date.now() - 100000, // Created in the past
      ttl: 50, // 50ms TTL
    };

    await adapter.set('ttl-key', record);
    const result = await adapter.get('ttl-key');
    expect(result).toBeNull();
  });

  describe('locking', () => {
    it('should acquire lock via transaction', async () => {
      const acquired = await adapter.acquireLock('lock-key', 30000);
      expect(acquired).toBe(true);
      expect(mockFirestore.runTransaction).toHaveBeenCalled();
    });

    it('should fail to acquire if lock exists and is not expired', async () => {
      await adapter.acquireLock('lock-key', 30000);

      const acquired = await adapter.acquireLock('lock-key', 30000);
      expect(acquired).toBe(false);
    });

    it('should re-acquire lock if existing one has expired', async () => {
      await adapter.acquireLock('expired-key', 1);
      await new Promise((resolve) => setTimeout(resolve, 5));

      const acquired = await adapter.acquireLock('expired-key', 30000);
      expect(acquired).toBe(true);
    });

    it('should release lock', async () => {
      await adapter.acquireLock('lock-key', 30000);
      await adapter.releaseLock('lock-key');

      const result = await adapter.get('lock:lock-key');
      expect(result).toBeNull();
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
        'Lock wait timeout exceeded'
      );
    });
  });
});
