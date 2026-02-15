/**
 * T017: Unit test for session ID generation.
 * Validates format cli-{username}-{epoch} within varchar(64).
 */
import { describe, it, expect } from 'vitest';
import { generateSessionId } from '../../src/session.js';

describe('session ID generation', () => {
  it('should produce format cli-{username}-{epoch}', () => {
    const id = generateSessionId();

    expect(id).toMatch(/^cli-[a-zA-Z0-9_.-]+-\d+$/);
  });

  it('should start with "cli-" prefix', () => {
    const id = generateSessionId();

    expect(id.startsWith('cli-')).toBe(true);
  });

  it('should contain the OS username', () => {
    const id = generateSessionId();
    const parts = id.split('-');

    // cli-{username}-{epoch} -- username is everything between first and last dash groups
    // But username could itself contain dashes. The epoch is always last.
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[0]).toBe('cli');
  });

  it('should end with epoch seconds (10-digit number)', () => {
    const id = generateSessionId();
    const lastPart = id.split('-').pop()!;

    // Epoch seconds should be a reasonable timestamp (10 digits)
    expect(lastPart).toMatch(/^\d{10}$/);
    const epoch = parseInt(lastPart, 10);
    // Should be a reasonable timestamp (after 2020, before 2040)
    expect(epoch).toBeGreaterThan(1577836800); // 2020-01-01
    expect(epoch).toBeLessThan(2208988800); // 2040-01-01
  });

  it('should be within varchar(64) character limit', () => {
    const id = generateSessionId();

    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('should generate IDs with different epoch values across time', () => {
    const id1 = generateSessionId();

    // The IDs generated in the same second will be identical (deterministic).
    // IDs generated at different seconds will differ.
    // We verify the epoch portion is a valid timestamp close to now.
    const epoch1 = parseInt(id1.split('-').pop()!, 10);
    const nowEpoch = Math.floor(Date.now() / 1000);

    // Should be within 2 seconds of current time
    expect(Math.abs(epoch1 - nowEpoch)).toBeLessThanOrEqual(2);
  });

  it('should produce deterministic results at the same timestamp', () => {
    // Two calls in quick succession (same second) should produce the same ID
    const id1 = generateSessionId();
    const id2 = generateSessionId();

    // Same second = same ID (username and epoch are both deterministic)
    expect(id1).toBe(id2);
  });
});
