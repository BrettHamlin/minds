/**
 * Custom error classes for the Relay application.
 * Error codes match the ErrorResponse schema in the API contracts.
 */

export class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('SPEC_NOT_FOUND', 404, message, details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 409, message, details);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 400, message, details);
    this.name = 'ValidationError';
  }
}

export class LLMError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('LLM_ERROR', 500, message, details);
    this.name = 'LLMError';
  }
}

// Specific error codes from API contracts
export const ERROR_CODES = {
  SPEC_NOT_FOUND: 'SPEC_NOT_FOUND',
  ACTIVE_SESSION_EXISTS: 'ACTIVE_SESSION_EXISTS',
  CHANNEL_NAME_TAKEN: 'CHANNEL_NAME_TAKEN',
  DESCRIPTION_TOO_SHORT: 'DESCRIPTION_TOO_SHORT',
} as const;
