import type { Request, Response, NextFunction } from "express";
import type { StorageAdapter } from "../adapters/StorageAdapter.js";
import type { IdempotencyConfig } from "../core/types.js";
import {
  IdempotencyError,
  IdempotencyErrorCode,
} from "../core/IdempotencyError.js";
import {
  generateCacheKey,
  hashBody,
  extractVaryHeaders,
} from "../utils/hash.js";
import {
  serializeResponse,
  deserializeResponse,
} from "../utils/serialize.js";
import { normalizeHeaders } from "../utils/headers.js";

export interface ExpressIdempotencyConfig extends IdempotencyConfig {
  /**
   * Custom error handler for Express
   */
  errorHandler?: (
    err: IdempotencyError,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void;
}

function applyCachedResponse(
  res: Response,
  statusCode: number | undefined,
  headers: Record<string, string> | undefined,
  body: unknown,
): void {
  res.status(statusCode ?? 200);
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      // Skip headers that Express/Node will set itself based on the body
      if (
        k.toLowerCase() === "content-length" ||
        k.toLowerCase() === "transfer-encoding"
      ) {
        continue;
      }
      res.set(k, v);
    }
  }
  res.send(body);
}

/**
 * Create Express middleware for idempotency.
 * Use with `app.use(idempotentExpress(adapter))` before your routes.
 */
export function idempotentExpress(
  storage: StorageAdapter,
  config: ExpressIdempotencyConfig = {},
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const methods = config.methods ?? ["POST", "PUT", "PATCH"];
  const headerName = config.headerName ?? "Idempotency-Key";
  const lockTimeout = config.lockTimeout ?? 30000;
  const lockTtl = config.lockTtl ?? lockTimeout;
  const lockPollInterval = config.lockPollInterval ?? 100;
  const ttl = config.ttl ?? 86400000;
  const includeBodyInKey = config.includeBodyInKey ?? true;
  const varyHeaders = config.varyHeaders ?? [];
  const maxKeyLength = config.maxKeyLength ?? 256;
  const shouldCache = config.shouldCache ?? ((): boolean => true);
  const getKey = config.getKey;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!methods.includes(req.method)) {
        next();
        return;
      }

      let key: string | undefined;
      if (getKey) {
        const candidate = getKey(req);
        if (typeof candidate === "string" && candidate.length > 0) {
          key = candidate;
        }
      }
      if (!key) {
        const headerValue = req.headers[headerName.toLowerCase()];
        if (typeof headerValue === "string" && headerValue.length > 0) {
          key = headerValue;
        }
      }
      if (!key) {
        next();
        return;
      }

      if (key.length > maxKeyLength) {
        throw new IdempotencyError(
          IdempotencyErrorCode.KEY_REQUIRED,
          `Idempotency key exceeds maximum length of ${maxKeyLength} characters`,
        );
      }

      const cacheKey = generateCacheKey({
        idempotencyKey: key,
        method: req.method,
        path: req.path,
        bodyHash: includeBodyInKey ? hashBody(req.body) : undefined,
        varyHeaders: extractVaryHeaders(
          req.headers as Record<string, string | string[] | undefined>,
          varyHeaders,
        ),
      });

      const cached = await storage.get(cacheKey);
      if (cached) {
        applyCachedResponse(
          res,
          cached.statusCode,
          cached.headers,
          deserializeResponse(cached.response),
        );
        return;
      }

      const acquired = await storage.acquireLock(cacheKey, lockTtl);

      if (!acquired) {
        await storage.waitForLock(cacheKey, lockTimeout, lockPollInterval);
        const cached = await storage.get(cacheKey);
        if (!cached) {
          res.status(409).json({ error: "Idempotency-Key In Use" });
          return;
        }
        applyCachedResponse(
          res,
          cached.statusCode,
          cached.headers,
          deserializeResponse(cached.response),
        );
        return;
      }

      const doubleCheck = await storage.get(cacheKey);
      if (doubleCheck) {
        applyCachedResponse(
          res,
          doubleCheck.statusCode,
          doubleCheck.headers,
          deserializeResponse(doubleCheck.response),
        );
        await storage.releaseLock(cacheKey).catch(() => {
          // Best-effort
        });
        return;
      }

      // We hold the lock. Patch response methods to capture the body,
      // then let the route handler run. Release the lock + persist on
      // either 'finish' (response flushed) or 'close' (connection dropped).
      let capturedBody: unknown;
      let bodyCaptured = false;
      let cleanupRan = false;

      const originalJson = res.json.bind(res);
      res.json = function json(body: unknown): Response {
        if (!bodyCaptured) {
          bodyCaptured = true;
          capturedBody = body;
        }
        return originalJson(body);
      };

      const originalSend = res.send.bind(res);
      res.send = function send(body: unknown): Response {
        if (
          !bodyCaptured &&
          arguments.length === 1 &&
          typeof body !== "number"
        ) {
          bodyCaptured = true;
          capturedBody = body;
        }
        return originalSend(body);
      };

      const cleanup = (persist: boolean): void => {
        if (cleanupRan) return;
        cleanupRan = true;
        void (async (): Promise<void> => {
          if (persist) {
            const body = bodyCaptured ? capturedBody : undefined;
            if (shouldCache(body)) {
              await storage
                .set(cacheKey, {
                  response: serializeResponse(body),
                  statusCode: res.statusCode,
                  headers: normalizeHeaders(res.getHeaders()),
                  createdAt: Date.now(),
                  ttl,
                })
                .catch(() => {
                  // Best-effort
                });
            }
          }
          await storage.releaseLock(cacheKey).catch(() => {
            // Best-effort
          });
        })();
      };

      res.on("finish", () => cleanup(true));
      res.on("close", () => cleanup(false));

      next();
    } catch (error) {
      if (error instanceof IdempotencyError) {
        if (config.errorHandler) {
          config.errorHandler(error, req, res, next);
          return;
        }
        res.status(error.getStatusCode()).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      next(error);
    }
  };
}
