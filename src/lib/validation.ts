/**
 * Input validation helper functions for the Relay application.
 */

import { ValidationError, ERROR_CODES } from './errors.js';

/**
 * Validates a string is a valid UUID v4 format.
 * @throws ValidationError if invalid
 */
export function validateUUID(id: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    throw new ValidationError(
      'INVALID_UUID',
      `Invalid UUID format: ${id}`,
      { providedId: id }
    );
  }
}

/**
 * Validates a description has at least the minimum required word count.
 * @throws ValidationError if too short
 */
export function validateDescriptionLength(text: string, minWords: number = 10): void {
  const words = text.trim().split(/\s+/);
  if (words.length < minWords) {
    throw new ValidationError(
      ERROR_CODES.DESCRIPTION_TOO_SHORT,
      `Feature description must be at least ${minWords} words. Please provide more detail.`,
      { providedWords: words.length, requiredWords: minWords }
    );
  }
}

/**
 * Validates a Slack channel name follows Slack's naming rules.
 * - Must start with a lowercase letter or number
 * - Can contain lowercase letters, numbers, and hyphens
 * - Must be 1-80 characters
 * @throws ValidationError if invalid
 */
export function validateSlackChannelName(name: string): void {
  const channelNameRegex = /^[a-z0-9][a-z0-9-]{0,79}$/;
  if (!channelNameRegex.test(name)) {
    throw new ValidationError(
      'INVALID_CHANNEL_NAME',
      'Channel name must be 1-80 characters, start with a letter or number, and contain only lowercase letters, numbers, and hyphens.',
      { providedName: name }
    );
  }
}

/**
 * Validates an option index is within the valid range for a question's options array.
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
