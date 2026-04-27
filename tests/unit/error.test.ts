import { describe, it, expect } from 'vitest';
import { IdempotencyError, IdempotencyErrorCode } from '../../src/core/IdempotencyError.js';

describe('IdempotencyError', () => {
  it('should create error with code and message', () => {
    const error = new IdempotencyError(
      IdempotencyErrorCode.KEY_REQUIRED,
      'Key is required'
    );

    expect(error.code).toBe(IdempotencyErrorCode.KEY_REQUIRED);
    expect(error.message).toBe('Key is required');
    expect(error.name).toBe('IdempotencyError');
  });

  it('should include cause and context', () => {
    const cause = new Error('Underlying error');
    const error = new IdempotencyError(
      IdempotencyErrorCode.STORAGE_ERROR,
      'Storage failed',
      { cause, context: { key: 'test' } }
    );

    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ key: 'test' });
  });

  describe('isRecoverable', () => {
    it('should return true for recoverable codes', () => {
      expect(
        new IdempotencyError(IdempotencyErrorCode.LOCK_TIMEOUT, '').isRecoverable()
      ).toBe(true);
      expect(
        new IdempotencyError(IdempotencyErrorCode.STORAGE_ERROR, '').isRecoverable()
      ).toBe(true);
    });

    it('should return false for non-recoverable codes', () => {
      expect(
        new IdempotencyError(IdempotencyErrorCode.KEY_REQUIRED, '').isRecoverable()
      ).toBe(false);
      expect(
        new IdempotencyError(IdempotencyErrorCode.CONFLICT, '').isRecoverable()
      ).toBe(false);
    });
  });

  describe('getStatusCode', () => {
    it('should return correct status codes', () => {
      const cases: [IdempotencyErrorCode, number][] = [
        [IdempotencyErrorCode.KEY_REQUIRED, 400],
        [IdempotencyErrorCode.LOCK_TIMEOUT, 409],
        [IdempotencyErrorCode.CONFLICT, 409],
        [IdempotencyErrorCode.STORAGE_ERROR, 503],
        [IdempotencyErrorCode.SERIALIZATION_ERROR, 500],
        [IdempotencyErrorCode.INVALID_CONFIG, 500],
        [IdempotencyErrorCode.NOT_CONNECTED, 500],
      ];

      for (const [code, expected] of cases) {
        const error = new IdempotencyError(code, '');
        expect(error.getStatusCode()).toBe(expected);
      }
    });
  });
});
