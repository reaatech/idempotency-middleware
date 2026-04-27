export enum IdempotencyErrorCode {
  /** Missing or empty idempotency key */
  KEY_REQUIRED = "KEY_REQUIRED",

  /** Lock acquisition or wait timeout */
  LOCK_TIMEOUT = "LOCK_TIMEOUT",

  /** Storage operation failed */
  STORAGE_ERROR = "STORAGE_ERROR",

  /** Response serialization failed */
  SERIALIZATION_ERROR = "SERIALIZATION_ERROR",

  /** Conflict with existing operation */
  CONFLICT = "CONFLICT",

  /** Invalid configuration */
  INVALID_CONFIG = "INVALID_CONFIG",

  /** Storage adapter not connected */
  NOT_CONNECTED = "NOT_CONNECTED",
}

export class IdempotencyError extends Error {
  public readonly code: IdempotencyErrorCode;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: IdempotencyErrorCode,
    message: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "IdempotencyError";
    this.code = code;
    this.context = options?.context;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IdempotencyError);
    }
  }

  /**
   * Check if error is recoverable
   */
  isRecoverable(): boolean {
    const recoverableCodes: IdempotencyErrorCode[] = [
      IdempotencyErrorCode.LOCK_TIMEOUT,
      IdempotencyErrorCode.STORAGE_ERROR,
    ];
    return recoverableCodes.includes(this.code);
  }

  /**
   * Get HTTP status code for this error
   */
  getStatusCode(): number {
    switch (this.code) {
      case IdempotencyErrorCode.KEY_REQUIRED:
        return 400;
      case IdempotencyErrorCode.LOCK_TIMEOUT:
        return 409;
      case IdempotencyErrorCode.CONFLICT:
        return 409;
      case IdempotencyErrorCode.STORAGE_ERROR:
        return 503;
      case IdempotencyErrorCode.SERIALIZATION_ERROR:
        return 500;
      default:
        return 500;
    }
  }
}
