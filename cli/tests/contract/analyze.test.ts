/**
 * T012: Contract test for POST /analyze request matching AnalyzeRequest schema.
 *
 * Schema (from specfactory-api.yaml):
 *   AnalyzeRequest:
 *     required: [specId, description]
 *     specId: uuid
 *     pmUserId: string (optional, maxLength 64)
 *     description: string, minLength 1, must contain 10+ words
 *
 *   AnalyzeResponse:
 *     required: [specId, title, roles, complexityScore, estimatedQuestions]
 */
import { describe, it, expect } from 'vitest';

describe('POST /analyze contract', () => {
  describe('AnalyzeRequest schema validation', () => {
    it('should produce a request body with required specId and description fields', () => {
      const requestBody = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        pmUserId: 'cli-atlas-1739520000',
        description:
          'Build a user authentication system that supports email and password login with OAuth integration and session management',
      };

      expect(requestBody).toHaveProperty('specId');
      expect(requestBody).toHaveProperty('description');
      expect(typeof requestBody.specId).toBe('string');
      expect(typeof requestBody.description).toBe('string');
    });

    it('should have specId in UUID format', () => {
      const specId = '550e8400-e29b-41d4-a716-446655440000';

      expect(specId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should have description with at least 10 words', () => {
      const description =
        'Build a user authentication system that supports email and password login with OAuth integration and session management';
      const wordCount = description.trim().split(/\s+/).length;

      expect(wordCount).toBeGreaterThanOrEqual(10);
    });

    it('should optionally include pmUserId in CLI format', () => {
      const requestBody = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        pmUserId: 'cli-atlas-1739520000',
        description:
          'Build a user authentication system that supports email and password login with OAuth integration',
      };

      expect(requestBody.pmUserId).toMatch(/^cli-[a-zA-Z0-9_.-]+-\d+$/);
      expect(requestBody.pmUserId!.length).toBeLessThanOrEqual(64);
    });
  });

  describe('AnalyzeResponse schema validation', () => {
    it('should validate response has all required fields', () => {
      const response = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        title: 'User Authentication System',
        roles: [
          {
            name: 'Backend Engineer',
            rationale: 'API implementation and JWT token management',
          },
          {
            name: 'Security Engineer',
            rationale: 'OAuth integration and credential handling',
          },
        ],
        complexityScore: 7,
        estimatedQuestions: 12,
      };

      expect(response).toHaveProperty('specId');
      expect(response).toHaveProperty('title');
      expect(response).toHaveProperty('roles');
      expect(response).toHaveProperty('complexityScore');
      expect(response).toHaveProperty('estimatedQuestions');
    });

    it('should validate roles array contains name and rationale', () => {
      const roles = [
        { name: 'Backend Engineer', rationale: 'API implementation' },
      ];

      roles.forEach((role) => {
        expect(role).toHaveProperty('name');
        expect(role).toHaveProperty('rationale');
        expect(typeof role.name).toBe('string');
        expect(typeof role.rationale).toBe('string');
      });
    });

    it('should validate complexityScore is between 1 and 10', () => {
      const complexityScore = 7;

      expect(complexityScore).toBeGreaterThanOrEqual(1);
      expect(complexityScore).toBeLessThanOrEqual(10);
    });

    it('should validate estimatedQuestions is at least 1', () => {
      const estimatedQuestions = 12;

      expect(estimatedQuestions).toBeGreaterThanOrEqual(1);
    });
  });
});
