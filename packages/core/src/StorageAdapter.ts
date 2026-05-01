import type { IdempotencyRecord } from './types.js';

/**
 * Interface for idempotency storage adapters.
 * Implementations must handle TTL management, concurrent access,
 * and bundled distributed locking.
 */
export interface StorageAdapter {
  /** Get cached response by key */
  get(key: string): Promise<IdempotencyRecord | null>;

  /** Store response with TTL */
  set(key: string, record: IdempotencyRecord): Promise<void>;

  /** Delete cached response */
  delete(key: string): Promise<void>;

  /** Initialize connection */
  connect(): Promise<void>;

  /** Close connection */
  disconnect(): Promise<void>;

  // --- Locking (bundled with storage for consistency) ---

  /** Acquire lock, returns true if acquired */
  acquireLock(key: string, ttl: number): Promise<boolean>;

  /** Release lock */
  releaseLock(key: string): Promise<void>;

  /** Wait for lock to be released, then resolve. Throws on timeout. */
  waitForLock(key: string, timeout: number, pollInterval: number): Promise<void>;
}
