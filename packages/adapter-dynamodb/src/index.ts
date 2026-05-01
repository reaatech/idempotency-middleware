import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  IdempotencyError,
  IdempotencyErrorCode,
} from '@reaatech/idempotency-middleware';
import type {
  StorageAdapter,
  IdempotencyRecord,
} from '@reaatech/idempotency-middleware';

export class DynamoDBAdapter implements StorageAdapter {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(client: DynamoDBClient, tableName = 'idempotency-cache') {
    this.client = client;
    this.tableName = tableName;
  }

  async connect(): Promise<void> {
    // DynamoDB client is ready to use immediately
  }

  async disconnect(): Promise<void> {
    // DynamoDB doesn't require explicit disconnection
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: { cacheKey: { S: key } },
    });

    const result = await this.client.send(command);

    if (!result.Item) {
      return null;
    }

    const item = unmarshall(result.Item) as IdempotencyRecord;

    const now = Date.now();
    if (now > item.createdAt + item.ttl) {
      await this.delete(key);
      return null;
    }

    return item;
  }

  async set(key: string, record: IdempotencyRecord): Promise<void> {
    const expiresAt = Math.ceil((record.createdAt + record.ttl) / 1000);

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        cacheKey: key,
        ...record,
        expiresAt,
      }),
    });

    await this.client.send(command);
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: { cacheKey: { S: key } },
    });

    await this.client.send(command);
  }

  // --- Locking (DynamoDB conditional write-backed) ---

  async acquireLock(key: string, ttl: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const now = Date.now();
    const expiresAt = Math.ceil((now + ttl) / 1000);

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        cacheKey: lockKey,
        acquiredAt: now,
        expiresAt,
      }),
      ConditionExpression: 'attribute_not_exists(cacheKey) OR expiresAt < :nowSec',
      ExpressionAttributeValues: marshall({ ':nowSec': Math.ceil(now / 1000) }),
    });

    try {
      await this.client.send(command);
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }

  async releaseLock(key: string): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: { cacheKey: { S: `lock:${key}` } },
    });
    await this.client.send(command);
  }

  async waitForLock(
    key: string,
    timeout: number,
    pollInterval: number,
  ): Promise<void> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const command = new GetItemCommand({
        TableName: this.tableName,
        Key: { cacheKey: { S: lockKey } },
      });
      const result = await this.client.send(command);
      if (!result.Item) {
        return;
      }
      const item = unmarshall(result.Item) as { expiresAt?: number };
      if (typeof item.expiresAt === 'number' && item.expiresAt < Math.ceil(Date.now() / 1000)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new IdempotencyError(
      IdempotencyErrorCode.LOCK_TIMEOUT,
      'Lock wait timeout exceeded',
    );
  }
}
