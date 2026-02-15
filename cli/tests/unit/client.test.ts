/**
 * T055-T056: Unit tests for verbose logging and error message formatting.
 *
 * T055: Verbose logger formats request/response details (method, URL, status, body truncation)
 * T056: Error messages map all ErrorResponse codes to human-readable messages
 */
import { describe, it, expect } from 'vitest';
import {
  formatVerboseRequest,
  formatVerboseResponse,
  getHumanReadableError,
  resolveBackendUrl,
} from '../../src/client.js';

describe('verbose logging and error formatting', () => {
  // ----- T055: Verbose logger formatting -----

  describe('T055: verbose request formatting', () => {
    it('should format GET request with method and URL', () => {
      const output = formatVerboseRequest('GET', '/health');

      expect(output).toContain('GET');
      expect(output).toContain('/health');
    });

    it('should format POST request with method, URL, and body', () => {
      const output = formatVerboseRequest('POST', '/api/specfactory/start', {
        pmUserId: 'cli-atlas-123',
        slackChannelId: 'cli-local',
      });

      expect(output).toContain('POST');
      expect(output).toContain('/api/specfactory/start');
      expect(output).toContain('pmUserId');
    });

    it('should truncate request body at 500 characters', () => {
      const longBody = { data: 'x'.repeat(600) };
      const output = formatVerboseRequest('POST', '/api/test', longBody);

      expect(output.length).toBeLessThan(700);
    });

    it('should handle undefined body gracefully', () => {
      const output = formatVerboseRequest('GET', '/health');

      expect(output).toBeDefined();
      expect(typeof output).toBe('string');
    });
  });

  describe('T055: verbose response formatting', () => {
    it('should format response with status code and timing', () => {
      const output = formatVerboseResponse(200, { specId: 'abc' }, 150);

      expect(output).toContain('200');
      expect(output).toContain('150');
    });

    it('should truncate response body at 500 characters', () => {
      const longBody = { data: 'y'.repeat(600) };
      const output = formatVerboseResponse(200, longBody, 100);

      expect(output.length).toBeLessThan(700);
    });

    it('should format error response with status code', () => {
      const output = formatVerboseResponse(
        500,
        { code: 'LLM_ERROR', message: 'LLM unavailable' },
        5000
      );

      expect(output).toContain('500');
      expect(output).toContain('LLM');
    });
  });

  // ----- T056: Error code to human-readable message mapping -----

  describe('T056: error message mapping', () => {
    it('should map MISSING_REQUIRED_FIELDS to clear message', () => {
      const msg = getHumanReadableError('MISSING_REQUIRED_FIELDS');
      expect(msg).toBeTruthy();
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(10);
    });

    it('should map INVALID_UUID to clear message', () => {
      const msg = getHumanReadableError('INVALID_UUID');
      expect(msg).toContain('UUID');
    });

    it('should map DESCRIPTION_TOO_SHORT to clear message', () => {
      const msg = getHumanReadableError('DESCRIPTION_TOO_SHORT');
      expect(msg.toLowerCase()).toContain('description');
    });

    it('should map ACTIVE_SESSION_EXISTS to clear message', () => {
      const msg = getHumanReadableError('ACTIVE_SESSION_EXISTS');
      expect(msg.toLowerCase()).toContain('session');
    });

    it('should map SPEC_NOT_FOUND to clear message', () => {
      const msg = getHumanReadableError('SPEC_NOT_FOUND');
      expect(msg.toLowerCase()).toContain('spec');
    });

    it('should map LLM_ERROR to clear message', () => {
      const msg = getHumanReadableError('LLM_ERROR');
      expect(msg.toLowerCase()).toContain('ai');
    });

    it('should map INVALID_CHANNEL_NAME to clear message', () => {
      const msg = getHumanReadableError('INVALID_CHANNEL_NAME');
      expect(msg.toLowerCase()).toContain('channel');
    });

    it('should map INVALID_OPTION_INDEX to clear message', () => {
      const msg = getHumanReadableError('INVALID_OPTION_INDEX');
      expect(msg.toLowerCase()).toContain('option');
    });

    it('should return a generic message for unknown codes', () => {
      const msg = getHumanReadableError('COMPLETELY_UNKNOWN_CODE');
      expect(msg).toBeTruthy();
      expect(typeof msg).toBe('string');
    });
  });

  // ----- Regression: resolveBackendUrl -----

  describe('resolveBackendUrl (regression)', () => {
    it('should use flag URL when provided', () => {
      expect(resolveBackendUrl('http://custom:3001')).toBe(
        'http://custom:3001'
      );
    });

    it('should strip trailing slash', () => {
      expect(resolveBackendUrl('http://custom:3001/')).toBe(
        'http://custom:3001'
      );
    });

    it('should default to localhost:3000', () => {
      const original = process.env.SPECFACTORY_BACKEND_URL;
      delete process.env.SPECFACTORY_BACKEND_URL;
      expect(resolveBackendUrl()).toBe('http://localhost:3000');
      if (original) process.env.SPECFACTORY_BACKEND_URL = original;
    });
  });
});
