import type { StorageAdapter } from './StorageAdapter.js';
import { IdempotencyError, IdempotencyErrorCode } from './errors.js';
import type { IdempotencyRecord } from './types.js';

interface CacheEntry {
  record: IdempotencyRecord;
  timeout: NodeJS.Timeout;
}

export class MemoryAdapter implements StorageAdapter {
  private cache = new Map<string, CacheEntry>();
  private locks = new Map<string, NodeJS.Timeout>();
  private connected = false;

  // eslint-disable-next-line @typescript-eslint/require-await
  async connect(): Promise<void> {
    this.connected = true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async disconnect(): Promise<void> {
    for (const entry of this.cache.values()) {
      clearTimeout(entry.timeout);
    }
    for (const timeout of this.locks.values()) {
      clearTimeout(timeout);
    }
    this.cache.clear();
    this.locks.clear();
    this.connected = false;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    if (!this.connected) {
      throw new IdempotencyError(IdempotencyErrorCode.NOT_CONNECTED, 'MemoryAdapter not connected');
    }

    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now > entry.record.createdAt + entry.record.ttl) {
      await this.delete(key);
      return null;
    }

    return entry.record;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    if (!this.connected) {
      throw new IdempotencyError(IdempotencyErrorCode.NOT_CONNECTED, 'MemoryAdapter not connected');
    }

    await this.delete(key);

    const timeout = setTimeout(() => {
      this.delete(key).catch(() => {
        // Best-effort cleanup
      });
    }, record.ttl);
    timeout.unref?.();

    this.cache.set(key, { record, timeout });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(key: string): Promise<void> {
    const entry = this.cache.get(key);
    if (entry) {
      clearTimeout(entry.timeout);
      this.cache.delete(key);
    }
  }

  // --- Locking (in-process) ---

  // eslint-disable-next-line @typescript-eslint/require-await
  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    if (this.locks.has(lockKey)) {
      return false;
    }
    const timeout = setTimeout(() => {
      this.locks.delete(lockKey);
    }, ttl);
    timeout.unref?.();
    this.locks.set(lockKey, timeout);
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async releaseLock(key: string): Promise<void> {
    const lockKey = `lock:${key}`;
    const timeout = this.locks.get(lockKey);
    if (timeout) {
      clearTimeout(timeout);
      this.locks.delete(lockKey);
    }
  }

  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (!this.locks.has(lockKey)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new IdempotencyError(IdempotencyErrorCode.LOCK_TIMEOUT, 'Lock wait timeout exceeded');
  }
}
