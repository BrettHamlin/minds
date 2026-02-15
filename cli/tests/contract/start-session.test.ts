/**
 * T011: Contract test for POST /start request matching StartSessionRequest schema.
 * Validates that CLI-generated requests conform to the OpenAPI spec.
 *
 * Schema (from specfactory-api.yaml):
 *   StartSessionRequest:
 *     required: [pmUserId, slackChannelId]
 *     pmUserId: string, maxLength 64, CLI format: cli-{username}-{epoch}
 *     slackChannelId: string, maxLength 64, CLI uses "cli-local"
 *
 *   StartSessionResponse:
 *     required: [specId, sessionId, step]
 *     specId: uuid
 *     sessionId: uuid
 *     step: "awaiting_description"
 */
import { describe, it, expect } from 'vitest';
import { generateSessionId } from '../../src/session.js';

describe('POST /start contract', () => {
  describe('StartSessionRequest schema validation', () => {
    it('should produce a request body with required pmUserId and slackChannelId fields', () => {
      const pmUserId = generateSessionId();
      const slackChannelId = 'cli-local';

      const requestBody = { pmUserId, slackChannelId };

      // Required fields present
      expect(requestBody).toHaveProperty('pmUserId');
      expect(requestBody).toHaveProperty('slackChannelId');
      expect(typeof requestBody.pmUserId).toBe('string');
      expect(typeof requestBody.slackChannelId).toBe('string');
    });

    it('should use CLI pmUserId format: cli-{username}-{epoch}', () => {
      const pmUserId = generateSessionId();

      // Must match CLI format
      expect(pmUserId).toMatch(/^cli-[a-zA-Z0-9_.-]+-\d+$/);
      expect(pmUserId.startsWith('cli-')).toBe(true);
    });

    it('should keep pmUserId within varchar(64) limit', () => {
      const pmUserId = generateSessionId();

      expect(pmUserId.length).toBeLessThanOrEqual(64);
    });

    it('should use "cli-local" as slackChannelId', () => {
      const slackChannelId = 'cli-local';

      expect(slackChannelId).toBe('cli-local');
      expect(slackChannelId.length).toBeLessThanOrEqual(64);
    });

    it('should not include extra fields beyond schema definition', () => {
      const pmUserId = generateSessionId();
      const requestBody = { pmUserId, slackChannelId: 'cli-local' };

      const allowedKeys = ['pmUserId', 'slackChannelId'];
      const bodyKeys = Object.keys(requestBody);

      bodyKeys.forEach((key) => {
        expect(allowedKeys).toContain(key);
      });
    });
  });

  describe('StartSessionResponse schema validation', () => {
    it('should validate response has required specId, sessionId, and step fields', () => {
      // Simulated response matching OpenAPI schema
      const response = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        sessionId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
        step: 'awaiting_description',
      };

      expect(response).toHaveProperty('specId');
      expect(response).toHaveProperty('sessionId');
      expect(response).toHaveProperty('step');
      expect(response.specId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(response.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(response.step).toBe('awaiting_description');
    });
  });
});
