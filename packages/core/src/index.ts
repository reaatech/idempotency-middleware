// Core

export { IdempotencyError, IdempotencyErrorCode } from './errors.js';
export type { RawHandler, RawHandlerContext } from './handler.js';
// Raw handler wrapper (framework-agnostic)
export { createHandlerContext, idempotentHandler } from './handler.js';
// Utils
export { extractVaryHeaders, generateCacheKey, hashBody } from './hash.js';
export { normalizeHeaders } from './headers.js';
export { MemoryAdapter } from './MemoryAdapter.js';
export { IdempotencyMiddleware } from './middleware.js';
// Adapters (zero-dependency)
export type { StorageAdapter } from './StorageAdapter.js';
export { deserializeResponse, serializeResponse } from './serialize.js';
export type { CacheKeyOptions, IdempotencyConfig, IdempotencyRecord } from './types.js';
