// Core
export { IdempotencyMiddleware } from "./core/IdempotencyMiddleware.js";
export {
  IdempotencyError,
  IdempotencyErrorCode,
} from "./core/IdempotencyError.js";
export type {
  IdempotencyRecord,
  IdempotencyConfig,
  CacheKeyOptions,
} from "./core/types.js";

// Adapters (zero-dependency)
export type { StorageAdapter } from "./adapters/StorageAdapter.js";
export { MemoryAdapter } from "./adapters/MemoryAdapter.js";

// Raw handler wrapper (framework-agnostic)
export {
  idempotentHandler,
  createHandlerContext,
} from "./frameworks/handler.js";
export type {
  RawHandler,
  RawHandlerContext,
} from "./frameworks/handler.js";

// Utils
export {
  generateCacheKey,
  hashBody,
  extractVaryHeaders,
} from "./utils/hash.js";
