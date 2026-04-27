import { describe, it, expect } from 'vitest';
import {
  serializeResponse,
  deserializeResponse,
} from '../../src/utils/serialize.js';

describe('serializeResponse / deserializeResponse', () => {
  it('passes through plain values unchanged', () => {
    expect(serializeResponse(undefined)).toBeUndefined();
    expect(serializeResponse(null)).toBeNull();
    expect(serializeResponse(42)).toBe(42);
    expect(serializeResponse('hi')).toBe('hi');
    expect(serializeResponse({ a: 1 })).toEqual({ a: 1 });
  });

  it('passes through plain values on deserialize', () => {
    expect(deserializeResponse({ a: 1 })).toEqual({ a: 1 });
    expect(deserializeResponse(null)).toBeNull();
    expect(deserializeResponse('x')).toBe('x');
  });

  it('round-trips an Error through JSON', () => {
    const original = new Error('boom');
    const serialized = serializeResponse(original);
    const json = JSON.parse(JSON.stringify(serialized)) as unknown;
    const reconstructed = deserializeResponse(json);

    expect(reconstructed).toBeInstanceOf(Error);
    expect((reconstructed as Error).message).toBe('boom');
    expect((reconstructed as Error).name).toBe('Error');
    expect((reconstructed as Error).stack).toBe(original.stack);
  });

  it('preserves custom enumerable properties on errors', () => {
    const original = new Error('paid');
    (original as unknown as { code: string; status: number }).code = 'PAID';
    (original as unknown as { code: string; status: number }).status = 422;

    const json = JSON.parse(
      JSON.stringify(serializeResponse(original)),
    ) as unknown;
    const reconstructed = deserializeResponse(json) as Error & {
      code: string;
      status: number;
    };

    expect(reconstructed).toBeInstanceOf(Error);
    expect(reconstructed.code).toBe('PAID');
    expect(reconstructed.status).toBe(422);
  });

  it('preserves the error name for subclasses', () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }
    const original = new CustomError('nope');

    const json = JSON.parse(
      JSON.stringify(serializeResponse(original)),
    ) as unknown;
    const reconstructed = deserializeResponse(json) as Error;

    expect(reconstructed.name).toBe('CustomError');
    expect(reconstructed.message).toBe('nope');
  });
});
