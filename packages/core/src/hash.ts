import { createHash } from 'node:crypto';
import type { CacheKeyOptions } from './types.js';

/**
 * Generate a cache key from idempotency options.
 * The result is always a SHA-256 hex string (64 chars).
 */
export function generateCacheKey(options: CacheKeyOptions): string {
  const { idempotencyKey, method, path, bodyHash, varyHeaders } = options;

  const headerPart = varyHeaders
    ? Object.entries(varyHeaders)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&')
    : '';

  const keyData = `${method}:${path}:${idempotencyKey}:${bodyHash ?? ''}:${headerPart}`;
  return createHash('sha256').update(keyData).digest('hex');
}

/**
 * Hash an arbitrary value for inclusion in the cache key.
 */
export function hashBody(body: unknown): string {
  if (body === undefined || body === null) {
    return '';
  }
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Extract vary headers from a headers record.
 */
export function extractVaryHeaders(
  headers: Record<string, string | string[] | undefined>,
  varyHeaders?: string[],
): Record<string, string> | undefined {
  if (!varyHeaders || varyHeaders.length === 0) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const header of varyHeaders) {
    const lower = header.toLowerCase();
    const value = headers[lower];
    if (typeof value === 'string') {
      result[header] = value;
    } else if (Array.isArray(value)) {
      result[header] = value.join(', ');
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
