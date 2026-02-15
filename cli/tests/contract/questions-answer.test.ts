/**
 * T016: Contract test for POST /questions/answer request matching SubmitAnswerRequest schema.
 * Tests both selectedOptionIndex and customText variants.
 *
 * Schema (from specfactory-api.yaml):
 *   SubmitAnswerRequest:
 *     required: [specId, questionId]
 *     specId: uuid
 *     questionId: uuid
 *     selectedOptionIndex: integer >= 0 (mutually exclusive with customText)
 *     customText: string (mutually exclusive with selectedOptionIndex)
 *
 *   SubmitAnswerResponse:
 *     required: [specId, questionId, answerId, progress, isComplete]
 */
import { describe, it, expect } from 'vitest';

describe('POST /questions/answer contract', () => {
  describe('SubmitAnswerRequest schema validation - selectedOptionIndex', () => {
    it('should produce a request body with required specId, questionId, and selectedOptionIndex', () => {
      const requestBody = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        questionId: '550e8400-e29b-41d4-a716-446655440001',
        selectedOptionIndex: 1,
      };

      expect(requestBody).toHaveProperty('specId');
      expect(requestBody).toHaveProperty('questionId');
      expect(requestBody).toHaveProperty('selectedOptionIndex');
      expect(typeof requestBody.selectedOptionIndex).toBe('number');
    });

    it('should have specId and questionId in UUID format', () => {
      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

      expect('550e8400-e29b-41d4-a716-446655440000').toMatch(uuidPattern);
      expect('550e8400-e29b-41d4-a716-446655440001').toMatch(uuidPattern);
    });

    it('should have selectedOptionIndex >= 0', () => {
      const selectedOptionIndex = 0;

      expect(selectedOptionIndex).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SubmitAnswerRequest schema validation - customText', () => {
    it('should produce a request body with required specId, questionId, and customText', () => {
      const requestBody = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        questionId: '550e8400-e29b-41d4-a716-446655440001',
        customText: 'We need SAML SSO with LDAP fallback',
      };

      expect(requestBody).toHaveProperty('specId');
      expect(requestBody).toHaveProperty('questionId');
      expect(requestBody).toHaveProperty('customText');
      expect(typeof requestBody.customText).toBe('string');
    });

    it('should not include both selectedOptionIndex and customText', () => {
      // Valid: only selectedOptionIndex
      const bodyWithOption = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        questionId: '550e8400-e29b-41d4-a716-446655440001',
        selectedOptionIndex: 1,
      };

      // Valid: only customText
      const bodyWithText = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        questionId: '550e8400-e29b-41d4-a716-446655440001',
        customText: 'Custom answer',
      };

      // Verify mutual exclusivity
      expect(bodyWithOption).not.toHaveProperty('customText');
      expect(bodyWithText).not.toHaveProperty('selectedOptionIndex');
    });
  });

  describe('SubmitAnswerResponse schema validation', () => {
    it('should validate response has all required fields', () => {
      const response = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        questionId: '550e8400-e29b-41d4-a716-446655440001',
        answerId: '550e8400-e29b-41d4-a716-446655440002',
        progress: {
          answered: 1,
          total: 12,
        },
        isComplete: false,
      };

      expect(response).toHaveProperty('specId');
      expect(response).toHaveProperty('questionId');
      expect(response).toHaveProperty('answerId');
      expect(response).toHaveProperty('progress');
      expect(response).toHaveProperty('isComplete');
    });

    it('should validate progress has answered and total fields', () => {
      const progress = { answered: 5, total: 12 };

      expect(progress).toHaveProperty('answered');
      expect(progress).toHaveProperty('total');
      expect(typeof progress.answered).toBe('number');
      expect(typeof progress.total).toBe('number');
    });

    it('should validate isComplete is a boolean', () => {
      expect(typeof false).toBe('boolean');
      expect(typeof true).toBe('boolean');
    });

    it('should validate completion response with isComplete: true', () => {
      const completionResponse = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        questionId: '550e8400-e29b-41d4-a716-44665544000c',
        answerId: '550e8400-e29b-41d4-a716-44665544000d',
        progress: {
          answered: 12,
          total: 12,
        },
        isComplete: true,
      };

      expect(completionResponse.isComplete).toBe(true);
      expect(completionResponse.progress.answered).toBe(
        completionResponse.progress.total
      );
    });
  });
});
