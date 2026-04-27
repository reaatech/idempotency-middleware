/**
 * Marker used to identify a serialized Error inside a stored response payload.
 * The marker survives JSON round-trips through remote storage adapters.
 */
const ERROR_MARKER = "@@idempotency/error";

interface SerializedError {
  [ERROR_MARKER]: true;
  name: string;
  message: string;
  stack?: string;
  extras?: Record<string, unknown>;
}

/**
 * Convert a value to a JSON-safe representation.
 * `Error` instances become tagged plain objects so adapters that round-trip
 * through `JSON.stringify` (Redis, DynamoDB, Firestore) can faithfully
 * reconstruct the error on read.
 */
export function serializeResponse(response: unknown): unknown {
  if (response instanceof Error) {
    const extras: Record<string, unknown> = {};
    for (const key of Object.keys(response)) {
      if (key !== "name" && key !== "message" && key !== "stack") {
        extras[key] = (response as unknown as Record<string, unknown>)[key];
      }
    }
    const serialized: SerializedError = {
      [ERROR_MARKER]: true,
      name: response.name,
      message: response.message,
      stack: response.stack,
    };
    if (Object.keys(extras).length > 0) {
      serialized.extras = extras;
    }
    return serialized;
  }
  return response;
}

/**
 * Reverse of `serializeResponse`. If the value is a tagged serialized error,
 * reconstruct an `Error` instance with the original message, stack, and
 * any custom enumerable properties. Otherwise return the value unchanged.
 */
export function deserializeResponse(response: unknown): unknown {
  if (
    response !== null &&
    typeof response === "object" &&
    (response as { [k: string]: unknown })[ERROR_MARKER] === true
  ) {
    const obj = response as unknown as SerializedError;
    const err = new Error(obj.message);
    err.name = obj.name;
    if (obj.stack) {
      err.stack = obj.stack;
    }
    if (obj.extras) {
      Object.assign(err, obj.extras);
    }
    return err;
  }
  return response;
}
