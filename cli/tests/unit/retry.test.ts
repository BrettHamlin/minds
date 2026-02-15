/**
 * T018: Unit test for exponential backoff retry logic.
 * Validates correct delays (1s, 2s, 4s) and transient-only retry behavior.
 *
 * Transient errors (retry): 429, 500, 502, 503, 504, ECONNREFUSED
 * Permanent errors (no retry): 400, 404, 409
 */
import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  calculateDelay,
  isTransientError,
} from '../../src/retry.js';

describe('exponential backoff', () => {
  describe('calculateDelay', () => {
    it('should return 1000ms for attempt 0 (first retry)', () => {
      expect(calculateDelay(0)).toBe(1000);
    });

    it('should return 2000ms for attempt 1 (second retry)', () => {
      expect(calculateDelay(1)).toBe(2000);
    });

    it('should return 4000ms for attempt 2 (third retry)', () => {
      expect(calculateDelay(2)).toBe(4000);
    });

    it('should cap delay at 10000ms', () => {
      expect(calculateDelay(10)).toBeLessThanOrEqual(10000);
    });
  });

  describe('isTransientError', () => {
    it('should identify 429 (Too Many Requests) as transient', () => {
      expect(isTransientError(429)).toBe(true);
    });

    it('should identify 500 (Internal Server Error) as transient', () => {
      expect(isTransientError(500)).toBe(true);
    });

    it('should identify 502 (Bad Gateway) as transient', () => {
      expect(isTransientError(502)).toBe(true);
    });

    it('should identify 503 (Service Unavailable) as transient', () => {
      expect(isTransientError(503)).toBe(true);
    });

    it('should identify 504 (Gateway Timeout) as transient', () => {
      expect(isTransientError(504)).toBe(true);
    });

    it('should NOT identify 400 (Bad Request) as transient', () => {
      expect(isTransientError(400)).toBe(false);
    });

    it('should NOT identify 404 (Not Found) as transient', () => {
      expect(isTransientError(404)).toBe(false);
    });

    it('should NOT identify 409 (Conflict) as transient', () => {
      expect(isTransientError(409)).toBe(false);
    });

    it('should NOT identify 401 (Unauthorized) as transient', () => {
      expect(isTransientError(401)).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('should return result on first success without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn, { maxAttempts: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry transient errors up to maxAttempts', async () => {
      const error = Object.assign(new Error('Server Error'), { status: 500 });
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 1 })).rejects.toThrow(
        'Server Error'
      );

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should NOT retry permanent errors (400)', async () => {
      const error = Object.assign(new Error('Bad Request'), { status: 400 });
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 1 })).rejects.toThrow(
        'Bad Request'
      );

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry 404 errors', async () => {
      const error = Object.assign(new Error('Not Found'), { status: 404 });
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 1 })).rejects.toThrow(
        'Not Found'
      );

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry 409 errors', async () => {
      const error = Object.assign(new Error('Conflict'), { status: 409 });
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 1 })).rejects.toThrow(
        'Conflict'
      );

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should succeed after transient failures followed by success', async () => {
      const error = Object.assign(new Error('Server Error'), { status: 500 });
      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue('recovered');

      const result = await withRetry(fn, { maxAttempts: 3, baseDelay: 1 });

      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry ECONNREFUSED errors', async () => {
      const error = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 1 })).rejects.toThrow(
        'ECONNREFUSED'
      );

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should default to 3 max attempts', async () => {
      const error = Object.assign(new Error('Server Error'), { status: 500 });
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { baseDelay: 1 })).rejects.toThrow();

      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});
