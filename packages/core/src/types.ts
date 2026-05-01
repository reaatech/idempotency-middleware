/**
 * Cached idempotency record structure
 */
export interface IdempotencyRecord {
  /** The cached response body */
  response: unknown;

  /** HTTP status code (framework-specific, optional) */
  statusCode?: number;

  /** Response headers (framework-specific, optional) */
  headers?: Record<string, string>;

  /** Timestamp when record was created (ms) */
  createdAt: number;

  /** Time-to-live in milliseconds */
  ttl: number;
}

/**
 * Configuration for idempotency middleware
 */
export interface IdempotencyConfig {
  /**
   * The header name to extract the idempotency key from.
   * The key extraction is case-insensitive.
   *
   * @default 'Idempotency-Key'
   */
  headerName?: string;

  /**
   * Time-to-live for cached responses in milliseconds.
   * After this period, the cached response will be considered expired.
   *
   * @default 86400000 (24 hours)
   */
  ttl?: number;

  /**
   * HTTP methods to apply idempotency to.
   * Requests with methods not in this list will bypass the middleware.
   *
   * @default ['POST', 'PUT', 'PATCH']
   */
  methods?: string[];

  /**
   * Custom function to extract the idempotency key from the request.
   * If not provided, the key will be extracted from the header specified
   * by `headerName`.
   *
   * @param request - The incoming request object
   * @returns The idempotency key, or undefined if not found
   */
  getKey?: (request: unknown) => string | undefined;

  /**
   * Custom function to determine if a response should be cached.
   * Return `true` to cache the response, `false` to skip caching.
   *
   * @param response - The response object from the handler
   * @returns Whether to cache the response
   *
   * @default Cache all responses (including errors) for true idempotency
   */
  shouldCache?: (response: unknown) => boolean;

  /**
   * Additional headers to include in the cache key.
   * Use this when the response varies based on specific headers.
   *
   * @default []
   */
  varyHeaders?: string[];

  /**
   * Include request body hash in cache key.
   *
   * @default true
   */
  includeBodyInKey?: boolean;

  /**
   * Maximum length of idempotency key in characters.
   *
   * @default 256
   */
  maxKeyLength?: number;

  /**
   * Maximum time to wait for a lock in milliseconds when another request is
   * already executing. If the wait exceeds this, an `IdempotencyError` with
   * code `LOCK_TIMEOUT` is thrown.
   *
   * @default 30000 (30 seconds)
   */
  lockTimeout?: number;

  /**
   * Lifetime of an acquired lock in milliseconds. Should be greater than the
   * worst-case handler execution time so the lock cannot expire while the
   * original request is still running. Defaults to `lockTimeout`.
   *
   * @default lockTimeout (30 seconds)
   */
  lockTtl?: number;

  /**
   * Interval between lock acquisition attempts in milliseconds.
   *
   * @default 100
   */
  lockPollInterval?: number;
}

/**
 * Options for cache key generation.
 *
 * `method` and `path` participate in the cache key. When calling
 * `IdempotencyMiddleware.execute` directly, supply both via the context
 * argument; otherwise the defaults (`POST` / `/`) collide across endpoints
 * that share an idempotency key.
 */
export interface CacheKeyOptions {
  /** The idempotency key from client */
  idempotencyKey: string;

  /** HTTP method */
  method: string;

  /** Request path */
  path: string;

  /** SHA-256 hash of request body */
  bodyHash?: string;

  /** Vary headers and their values */
  varyHeaders?: Record<string, string>;
}
