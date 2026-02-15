/**
 * T038-T040: Unit tests for JSON envelope output formatting.
 *
 * T038: JSON envelope produces correct schema with status/data/error/meta fields
 * T039: JSON envelope includes retryable flag and duration_ms in meta
 * T040: Exit code returns 0 for success and non-zero for failures
 */
import { describe, it, expect } from 'vitest';
import {
  createSuccessEnvelope,
  createErrorEnvelope,
  getExitCode,
  ExitCode,
  type JSONEnvelope,
} from '../../src/output.js';

describe('JSON envelope formatter', () => {
  // ----- T038: JSON envelope schema -----

  describe('T038: success envelope schema', () => {
    it('should produce status "success" with data field', () => {
      const envelope = createSuccessEnvelope(
        { specId: 'abc-123' },
        'http://localhost:3000'
      );

      expect(envelope.status).toBe('success');
      expect(envelope.data).toEqual({ specId: 'abc-123' });
      expect(envelope.error).toBeUndefined();
    });

    it('should include meta with timestamp, duration_ms, and backend_url', () => {
      const envelope = createSuccessEnvelope(
        { specId: 'abc-123' },
        'http://localhost:3000',
        1500
      );

      expect(envelope.meta).toBeDefined();
      expect(envelope.meta.timestamp).toBeDefined();
      expect(typeof envelope.meta.timestamp).toBe('string');
      // ISO-8601 timestamp format
      expect(envelope.meta.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
      expect(envelope.meta.duration_ms).toBe(1500);
      expect(envelope.meta.backend_url).toBe('http://localhost:3000');
    });

    it('should not include error field on success', () => {
      const envelope = createSuccessEnvelope({}, 'http://localhost:3000');

      expect(envelope).not.toHaveProperty('error');
    });
  });

  describe('T038: error envelope schema', () => {
    it('should produce status "error" with error field', () => {
      const envelope = createErrorEnvelope(
        'SPEC_NOT_FOUND',
        'Spec not found',
        'http://localhost:3000'
      );

      expect(envelope.status).toBe('error');
      expect(envelope.error).toBeDefined();
      expect(envelope.error!.code).toBe('SPEC_NOT_FOUND');
      expect(envelope.error!.message).toBe('Spec not found');
    });

    it('should not include data field on error', () => {
      const envelope = createErrorEnvelope(
        'UNKNOWN',
        'fail',
        'http://localhost:3000'
      );

      expect(envelope.data).toBeUndefined();
    });

    it('should include meta on error envelope', () => {
      const envelope = createErrorEnvelope(
        'UNKNOWN',
        'fail',
        'http://localhost:3000',
        { retryable: false }
      );

      expect(envelope.meta).toBeDefined();
      expect(envelope.meta.backend_url).toBe('http://localhost:3000');
    });
  });

  // ----- T039: retryable flag and duration_ms -----

  describe('T039: retryable and duration_ms in meta', () => {
    it('should include retryable flag in error envelope', () => {
      const envelope = createErrorEnvelope(
        'LLM_ERROR',
        'LLM service unavailable',
        'http://localhost:3000',
        { retryable: true }
      );

      expect(envelope.error!.retryable).toBe(true);
    });

    it('should set retryable false for client errors', () => {
      const envelope = createErrorEnvelope(
        'MISSING_REQUIRED_FIELDS',
        'specId is required',
        'http://localhost:3000',
        { retryable: false }
      );

      expect(envelope.error!.retryable).toBe(false);
    });

    it('should include duration_ms in success envelope meta', () => {
      const envelope = createSuccessEnvelope(
        { result: 'ok' },
        'http://localhost:3000',
        2345
      );

      expect(envelope.meta.duration_ms).toBe(2345);
    });

    it('should include duration_ms in error envelope meta', () => {
      const envelope = createErrorEnvelope(
        'TIMEOUT',
        'Request timed out',
        'http://localhost:3000',
        { retryable: true, duration_ms: 60001 }
      );

      expect(envelope.meta.duration_ms).toBe(60001);
    });

    it('should default duration_ms to 0 when not provided', () => {
      const envelope = createSuccessEnvelope({ ok: true }, 'http://localhost:3000');

      expect(envelope.meta.duration_ms).toBe(0);
    });
  });

  // ----- T040: Exit codes -----

  describe('T040: exit codes', () => {
    it('should return 0 for success', () => {
      expect(getExitCode('success')).toBe(ExitCode.SUCCESS);
      expect(ExitCode.SUCCESS).toBe(0);
    });

    it('should return 1 for user error', () => {
      expect(getExitCode('user_error')).toBe(ExitCode.USER_ERROR);
      expect(ExitCode.USER_ERROR).toBe(1);
    });

    it('should return 2 for backend error', () => {
      expect(getExitCode('backend_error')).toBe(ExitCode.BACKEND_ERROR);
      expect(ExitCode.BACKEND_ERROR).toBe(2);
    });

    it('should return 3 for network error', () => {
      expect(getExitCode('network_error')).toBe(ExitCode.NETWORK_ERROR);
      expect(ExitCode.NETWORK_ERROR).toBe(3);
    });

    it('should return 1 for unknown error types', () => {
      expect(getExitCode('unknown' as any)).toBe(ExitCode.USER_ERROR);
    });
  });
});
