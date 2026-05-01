import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoDBAdapter } from './index.js';
import {
  DynamoDBClient,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { IdempotencyRecord } from '@reaatech/idempotency-middleware';

describe('DynamoDBAdapter', () => {
  let mockClient: DynamoDBClient;
  let adapter: DynamoDBAdapter;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock = vi.fn();
    mockClient = {
      send: sendMock,
    } as unknown as DynamoDBClient;

    adapter = new DynamoDBAdapter(mockClient, 'test-table');
  });

  it('should store and retrieve responses', async () => {
    const record: IdempotencyRecord = {
      response: { id: 1 },
      createdAt: Date.now(),
      ttl: 60000,
    };

    sendMock.mockResolvedValueOnce({ Item: undefined });
    sendMock.mockResolvedValueOnce({
      Item: marshall({
        cacheKey: 'test-key',
        ...record,
        expiresAt: Math.ceil((record.createdAt + record.ttl) / 1000),
      }),
    });

    await adapter.set('test-key', record);
    const retrieved = await adapter.get('test-key');

    expect(retrieved).toMatchObject({
      response: { id: 1 },
      createdAt: record.createdAt,
      ttl: 60000,
    });
  });

  it('should return null for missing keys', async () => {
    sendMock.mockResolvedValue({ Item: undefined });

    const result = await adapter.get('missing-key');
    expect(result).toBeNull();
  });

  it('should delete cached responses', async () => {
    sendMock.mockResolvedValue({});

    await adapter.delete('delete-key');

    expect(sendMock).toHaveBeenCalledWith(expect.any(DeleteItemCommand));
  });

  it('should expire entries after TTL', async () => {
    sendMock.mockResolvedValue({
      Item: marshall({
        cacheKey: 'ttl-key',
        response: { data: 'test' },
        createdAt: Date.now() - 100000,
        ttl: 50,
        expiresAt: 0,
      }),
    });

    const result = await adapter.get('ttl-key');
    expect(result).toBeNull();
  });

  describe('locking', () => {
    it('should acquire lock with conditional write that allows expired locks', async () => {
      sendMock.mockResolvedValue({});

      const acquired = await adapter.acquireLock('lock-key', 30000);

      expect(acquired).toBe(true);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ConditionExpression:
              'attribute_not_exists(cacheKey) OR expiresAt < :nowSec',
            ExpressionAttributeValues: expect.objectContaining({
              ':nowSec': expect.objectContaining({ N: expect.any(String) }),
            }),
          }),
        }),
      );
    });

    it('should fail to acquire if lock exists', async () => {
      const error = new Error('ConditionalCheckFailedException');
      (error as { name: string }).name = 'ConditionalCheckFailedException';
      sendMock.mockRejectedValue(error);

      const acquired = await adapter.acquireLock('lock-key', 30000);
      expect(acquired).toBe(false);
    });

    it('should release lock', async () => {
      sendMock.mockResolvedValue({});

      await adapter.releaseLock('lock-key');

      expect(sendMock).toHaveBeenCalledWith(expect.any(DeleteItemCommand));
    });

    it('should wait for lock release', async () => {
      sendMock
        .mockResolvedValueOnce({
          Item: marshall({ cacheKey: 'lock:wait-key' }),
        })
        .mockResolvedValueOnce({
          Item: marshall({ cacheKey: 'lock:wait-key' }),
        })
        .mockResolvedValueOnce({ Item: undefined });

      await adapter.waitForLock('wait-key', 1000, 10);

      expect(sendMock).toHaveBeenCalledTimes(3);
    });

    it('should timeout waiting for lock', async () => {
      sendMock.mockResolvedValue({
        Item: marshall({ cacheKey: 'lock:timeout-key' }),
      });

      await expect(adapter.waitForLock('timeout-key', 50, 10)).rejects.toThrow(
        'Lock wait timeout exceeded',
      );
    });
  });
});
