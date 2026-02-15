/**
 * T020: Exponential backoff retry logic for transient HTTP errors.
 *
 * Strategy (from research.md):
 * - Max attempts: 3
 * - Base delay: 1000ms
 * - Backoff multiplier: 2x (delays: 1s, 2s, 4s)
 * - Max delay cap: 10000ms
 * - Transient errors (retry): 429, 500, 502, 503, 504, ECONNREFUSED
 * - Permanent errors (fail fast): 400, 401, 404, 409
 */

/** Set of HTTP status codes considered transient (recoverable). */
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Network error codes that indicate transient connectivity issues. */
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Calculate exponential backoff delay for a given attempt number.
 *
 * @param attempt - Zero-based attempt number (0 = first retry)
 * @param baseDelay - Base delay in milliseconds (default 1000)
 * @returns Delay in milliseconds, capped at 10000ms
 */
export function calculateDelay(attempt: number, baseDelay = 1000): number {
  const delay = baseDelay * Math.pow(2, attempt);
  return Math.min(delay, 10000);
}

/**
 * Determine if an HTTP status code represents a transient error worth retrying.
 *
 * @param statusCode - HTTP status code
 * @returns true if the error is transient and should be retried
 */
export function isTransientError(statusCode: number): boolean {
  return TRANSIENT_STATUS_CODES.has(statusCode);
}

/**
 * Determine if an error object represents a transient failure worth retrying.
 * Checks both HTTP status codes and network error codes.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const errWithStatus = error as Error & { status?: number; code?: string };

    // Check HTTP status code
    if (errWithStatus.status !== undefined) {
      return isTransientError(errWithStatus.status);
    }

    // Check network error codes (ECONNREFUSED, etc.)
    if (
      errWithStatus.code !== undefined &&
      TRANSIENT_ERROR_CODES.has(errWithStatus.code)
    ) {
      return true;
    }
  }

  return false;
}

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelay?: number;
  /** Called before each retry with attempt number and delay */
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

/**
 * Execute an async function with exponential backoff retry for transient errors.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Result of the function on success
 * @throws The last error if all attempts fail, or immediately for permanent errors
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Fail fast on permanent errors -- no point retrying
      if (!isRetryableError(error)) {
        throw lastError;
      }

      // If this was the last attempt, throw
      if (attempt === maxAttempts - 1) {
        throw lastError;
      }

      // Wait with exponential backoff before retrying
      const delay = calculateDelay(attempt, baseDelay);
      if (onRetry) {
        onRetry(attempt + 1, delay, lastError);
      }
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs the throw
  throw lastError ?? new Error('Retry failed');
}

/** Sleep for the specified number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
