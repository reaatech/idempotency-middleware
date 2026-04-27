import { describe, it, expect } from 'vitest';
import { generateCacheKey, hashBody, extractVaryHeaders } from '../../src/utils/hash.js';

describe('hash utils', () => {
  describe('generateCacheKey', () => {
    it('should generate consistent keys for same input', () => {
      const options = {
        idempotencyKey: 'abc123',
        method: 'POST',
        path: '/api/users',
      };

      const key1 = generateCacheKey(options);
      const key2 = generateCacheKey(options);

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex
    });

    it('should include body hash in key', () => {
      const base = {
        idempotencyKey: 'abc123',
        method: 'POST',
        path: '/api/users',
      };

      const keyWithoutBody = generateCacheKey(base);
      const keyWithBody = generateCacheKey({ ...base, bodyHash: hashBody({ amount: 100 }) });

      expect(keyWithBody).not.toBe(keyWithoutBody);
    });

    it('should include vary headers in key', () => {
      const base = {
        idempotencyKey: 'abc123',
        method: 'POST',
        path: '/api/users',
      };

      const keyWithoutHeaders = generateCacheKey(base);
      const keyWithHeaders = generateCacheKey({
        ...base,
        varyHeaders: { 'Accept-Language': 'en' },
      });

      expect(keyWithHeaders).not.toBe(keyWithoutHeaders);
    });

    it('should sort vary headers for consistency', () => {
      const options = {
        idempotencyKey: 'abc123',
        method: 'POST',
        path: '/api/users',
      };

      const key1 = generateCacheKey({
        ...options,
        varyHeaders: { b: '2', a: '1' },
      });
      const key2 = generateCacheKey({
        ...options,
        varyHeaders: { a: '1', b: '2' },
      });

      expect(key1).toBe(key2);
    });
  });

  describe('hashBody', () => {
    it('should return empty string for undefined/null', () => {
      expect(hashBody(undefined)).toBe('');
      expect(hashBody(null)).toBe('');
    });

    it('should hash strings directly', () => {
      const hash1 = hashBody('hello');
      const hash2 = hashBody('hello');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should hash objects via JSON', () => {
      const hash1 = hashBody({ a: 1, b: 2 });
      const hash2 = hashBody({ a: 1, b: 2 });
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different values', () => {
      const hash1 = hashBody({ amount: 100 });
      const hash2 = hashBody({ amount: 1000 });
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('extractVaryHeaders', () => {
    it('should return undefined when varyHeaders is empty', () => {
      expect(extractVaryHeaders({}, [])).toBeUndefined();
      expect(extractVaryHeaders({ 'x-custom': 'val' }, undefined)).toBeUndefined();
    });

    it('should extract matching headers', () => {
      const headers = {
        'accept-language': 'en-US',
        'content-type': 'application/json',
      };

      const result = extractVaryHeaders(headers, ['Accept-Language']);

      expect(result).toEqual({ 'Accept-Language': 'en-US' });
    });

    it('should join array values', () => {
      const headers = {
        'accept': ['application/json', 'text/html'],
      };

      const result = extractVaryHeaders(headers, ['Accept']);

      expect(result).toEqual({ Accept: 'application/json, text/html' });
    });

    it('should skip missing headers', () => {
      const headers = {};

      const result = extractVaryHeaders(headers, ['Accept-Language']);

      expect(result).toBeUndefined();
    });
  });
});
