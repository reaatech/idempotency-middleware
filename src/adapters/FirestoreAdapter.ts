import type { StorageAdapter } from "./StorageAdapter.js";
import type { IdempotencyRecord } from "../core/types.js";
import type { Firestore, CollectionReference } from "@google-cloud/firestore";
import {
  IdempotencyError,
  IdempotencyErrorCode,
} from "../core/IdempotencyError.js";

const LOCK_EXISTS_MARKER = "__idempotency_lock_held__";

export class FirestoreAdapter implements StorageAdapter {
  private firestore: Firestore;
  private collection: CollectionReference;

  constructor(firestore: Firestore, collectionName = "idempotency_cache") {
    this.firestore = firestore;
    this.collection = this.firestore.collection(collectionName);
  }

  async connect(): Promise<void> {
    // Firestore client is ready to use immediately
  }

  async disconnect(): Promise<void> {
    // Firestore doesn't require explicit disconnection
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const docRef = this.collection.doc(key);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as IdempotencyRecord;

    const now = Date.now();
    if (now > data.createdAt + data.ttl) {
      await this.delete(key);
      return null;
    }

    return data;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const docRef = this.collection.doc(key);
    const expiresAt = new Date(record.createdAt + record.ttl);

    await docRef.set({
      ...record,
      expiresAt,
    });
  }

  async delete(key: string): Promise<void> {
    await this.collection.doc(key).delete();
  }

  // --- Locking (Firestore transaction-backed) ---

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const now = Date.now();
    const expiresAt = now + ttl;

    try {
      await this.firestore.runTransaction(async (transaction) => {
        const docRef = this.collection.doc(lockKey);
        const doc = await transaction.get(docRef);

        if (doc.exists) {
          const data = doc.data() as { expiresAt?: number };
          if (typeof data.expiresAt === "number" && data.expiresAt > now) {
            throw new Error(LOCK_EXISTS_MARKER);
          }
        }

        transaction.set(docRef, {
          acquiredAt: now,
          expiresAt,
        });
      });

      return true;
    } catch (error) {
      if ((error as Error).message === LOCK_EXISTS_MARKER) {
        return false;
      }
      throw error;
    }
  }

  async releaseLock(key: string): Promise<void> {
    await this.collection.doc(`lock:${key}`).delete();
  }

  async waitForLock(
    key: string,
    timeout: number,
    pollInterval: number,
  ): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const doc = await this.collection.doc(lockKey).get();
      if (!doc.exists) {
        return;
      }
      const data = doc.data() as { expiresAt?: number } | undefined;
      if (
        data &&
        typeof data.expiresAt === "number" &&
        data.expiresAt < Date.now()
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new IdempotencyError(
      IdempotencyErrorCode.LOCK_TIMEOUT,
      "Lock wait timeout exceeded",
    );
  }
}
