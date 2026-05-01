import { randomUUID } from 'node:crypto';
import { IdempotencyError, IdempotencyErrorCode } from '@reaatech/idempotency-middleware';
import type { IdempotencyRecord, StorageAdapter } from '@reaatech/idempotency-middleware';
import type { Redis } from 'ioredis';

const RELEASE_LOCK_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

export class RedisAdapter implements StorageAdapter {
  private client: Redis;
  private connected = false;
  private lockTokens = new Map<string, string>();

  constructor(client: Redis) {
    this.client = client;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.ping();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    await this.client.quit();
    this.connected = false;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    try {
      const data = await this.client.get(key);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as IdempotencyRecord;
    } catch (error) {
      if (error instanceof SyntaxError) {
        await this.delete(key);
        return null;
      }
      throw error;
    }
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil(record.ttl / 1000));
    const data = JSON.stringify(record);
    await this.client.set(key, data, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  // --- Locking (Redis-backed, token-guarded) ---

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const ttlSeconds = Math.max(1, Math.ceil(ttl / 1000));
    const token = randomUUID();
    const result = await this.client.set(lockKey, token, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') {
      this.lockTokens.set(lockKey, token);
      return true;
    }
    return false;
  }

  async releaseLock(key: string): Promise<void> {
    const lockKey = `lock:${key}`;
    const token = this.lockTokens.get(lockKey);
    if (!token) {
      return;
    }
    this.lockTokens.delete(lockKey);
    await this.client.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
  }

  async waitForLock(key: string, timeout: number, pollInterval: number): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const exists = await this.client.exists(lockKey);
      if (!exists) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new IdempotencyError(IdempotencyErrorCode.LOCK_TIMEOUT, 'Lock wait timeout exceeded');
  }
}
