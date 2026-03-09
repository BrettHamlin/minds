/**
 * SpecEngine validation — SpecEngine-specific validators.
 *
 * validateOptionIndex is SpecEngine-owned (Q&A answer validation).
 * HTTP-boundary validators (validateUUID, validateDescriptionLength,
 * validateSlackChannelName) live in minds/shared/validation.ts.
 */

import { ValidationError } from '../../../shared/errors.js';

/**
 * Validates an option index is within the valid range for a question's options array.
 * SpecEngine-specific: only used in answer submission logic.
 * @throws ValidationError if out of range
 */
export function validateOptionIndex(index: number, optionsLength: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= optionsLength) {
    throw new ValidationError(
      'INVALID_OPTION_INDEX',
      `Option index must be between 0 and ${optionsLength - 1}.`,
      { providedIndex: index, maxIndex: optionsLength - 1 }
    );
  }
}
