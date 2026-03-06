/**
 * SpecEngine errors — re-exports shared error hierarchy + SpecEngine-specific errors.
 *
 * AppError, NotFoundError, ConflictError, ValidationError, ERROR_CODES live in
 * minds/shared/errors.ts (shared kernel). LLMError is SpecEngine-specific.
 */

import { AppError } from '../../../shared/errors.js';

export {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  ERROR_CODES,
} from '../../../shared/errors.js';

/** SpecEngine-specific: thrown when an LLM call fails. */
export class LLMError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('LLM_ERROR', 500, message, details);
    this.name = 'LLMError';
  }
}
