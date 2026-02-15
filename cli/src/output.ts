/**
 * T041-T043: JSON envelope formatter for structured CLI output.
 *
 * - T041: JSON envelope formatter (status: success/error, data/error, meta)
 * - T042: Success envelope with phase-specific result shapes
 * - T043: Error envelope with retryable flag and structured details
 *
 * Envelope schema:
 *   {
 *     status: "success" | "error",
 *     data?: <phase-specific>,
 *     error?: { code, message, retryable },
 *     meta: { timestamp, duration_ms, backend_url }
 *   }
 */

// ----- Types -----

export interface JSONEnvelopeMeta {
  timestamp: string;
  duration_ms: number;
  backend_url: string;
}

export interface JSONEnvelopeError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface JSONEnvelope<T = unknown> {
  status: 'success' | 'error';
  data?: T;
  error?: JSONEnvelopeError;
  meta: JSONEnvelopeMeta;
}

// ----- T040: Exit codes -----

export enum ExitCode {
  SUCCESS = 0,
  USER_ERROR = 1,
  BACKEND_ERROR = 2,
  NETWORK_ERROR = 3,
}

export type ErrorType = 'success' | 'user_error' | 'backend_error' | 'network_error';

/**
 * Map error type to exit code.
 */
export function getExitCode(type: ErrorType): number {
  switch (type) {
    case 'success':
      return ExitCode.SUCCESS;
    case 'user_error':
      return ExitCode.USER_ERROR;
    case 'backend_error':
      return ExitCode.BACKEND_ERROR;
    case 'network_error':
      return ExitCode.NETWORK_ERROR;
    default:
      return ExitCode.USER_ERROR;
  }
}

// ----- T041-T042: Success envelope -----

/**
 * Create a success JSON envelope with phase-specific data.
 */
export function createSuccessEnvelope<T>(
  data: T,
  backendUrl: string,
  durationMs: number = 0
): JSONEnvelope<T> {
  return {
    status: 'success',
    data,
    meta: {
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      backend_url: backendUrl,
    },
  };
}

// ----- T043: Error envelope -----

export interface ErrorEnvelopeOptions {
  retryable: boolean;
  duration_ms?: number;
  details?: Record<string, unknown>;
}

/**
 * Create an error JSON envelope with retryable flag and structured details.
 */
export function createErrorEnvelope(
  code: string,
  message: string,
  backendUrl: string,
  options: ErrorEnvelopeOptions = { retryable: false }
): JSONEnvelope<never> {
  const envelope: JSONEnvelope<never> = {
    status: 'error',
    error: {
      code,
      message,
      retryable: options.retryable,
    },
    meta: {
      timestamp: new Date().toISOString(),
      duration_ms: options.duration_ms ?? 0,
      backend_url: backendUrl,
    },
  };

  if (options.details) {
    envelope.error!.details = options.details;
  }

  return envelope;
}

/**
 * Print a JSON envelope to stdout (for --json mode).
 */
export function printJSON(envelope: JSONEnvelope): void {
  console.log(JSON.stringify(envelope, null, 2));
}
