// Core
export { IdempotencyMiddleware } from './middleware.js';
export { IdempotencyError, IdempotencyErrorCode } from './errors.js';
export type { IdempotencyRecord, IdempotencyConfig, CacheKeyOptions } from './types.js';

// Adapters (zero-dependency)
export type { StorageAdapter } from './StorageAdapter.js';
export { MemoryAdapter } from './MemoryAdapter.js';

// Raw handler wrapper (framework-agnostic)
export { idempotentHandler, createHandlerContext } from './handler.js';
export type { RawHandler, RawHandlerContext } from './handler.js';

// Utils
export { generateCacheKey, hashBody, extractVaryHeaders } from './hash.js';
export { normalizeHeaders } from './headers.js';
export { serializeResponse, deserializeResponse } from './serialize.js';
