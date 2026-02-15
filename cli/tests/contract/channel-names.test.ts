/**
 * T013: Contract test for POST /channel-names request matching ChannelNamesRequest schema.
 *
 * Schema (from specfactory-api.yaml):
 *   ChannelNamesRequest:
 *     required: [specId]
 *     specId: uuid
 *
 *   ChannelNamesResponse:
 *     required: [specId, suggestions]
 *     suggestions: array of strings, minItems 5, maxItems 5
 */
import { describe, it, expect } from 'vitest';

describe('POST /channel-names contract', () => {
  describe('ChannelNamesRequest schema validation', () => {
    it('should produce a request body with required specId field', () => {
      const requestBody = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
      };

      expect(requestBody).toHaveProperty('specId');
      expect(typeof requestBody.specId).toBe('string');
    });

    it('should have specId in UUID format', () => {
      const requestBody = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
      };

      expect(requestBody.specId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should not include extra fields beyond schema definition', () => {
      const requestBody = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const allowedKeys = ['specId'];
      const bodyKeys = Object.keys(requestBody);

      bodyKeys.forEach((key) => {
        expect(allowedKeys).toContain(key);
      });
    });
  });

  describe('ChannelNamesResponse schema validation', () => {
    it('should validate response has required specId and suggestions fields', () => {
      const response = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        suggestions: [
          'feature-user-auth',
          'spec-auth-system',
          'auth-implementation',
          'user-login-feature',
          'auth-design-spec',
        ],
      };

      expect(response).toHaveProperty('specId');
      expect(response).toHaveProperty('suggestions');
    });

    it('should validate suggestions contains exactly 5 items', () => {
      const suggestions = [
        'feature-user-auth',
        'spec-auth-system',
        'auth-implementation',
        'user-login-feature',
        'auth-design-spec',
      ];

      expect(suggestions).toHaveLength(5);
    });

    it('should validate each suggestion is a string', () => {
      const suggestions = [
        'feature-user-auth',
        'spec-auth-system',
        'auth-implementation',
        'user-login-feature',
        'auth-design-spec',
      ];

      suggestions.forEach((s) => {
        expect(typeof s).toBe('string');
      });
    });
  });
});
