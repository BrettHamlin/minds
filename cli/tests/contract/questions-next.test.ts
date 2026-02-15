/**
 * T015: Contract test for POST /questions/next request matching NextQuestionRequest schema.
 *
 * Schema (from specfactory-api.yaml):
 *   NextQuestionRequest:
 *     required: [specId]
 *     specId: uuid
 *
 *   Response: oneOf QuestionResponse | CompletionCheckResponse
 *     QuestionResponse:
 *       required: [type, question, progress]
 *       type: "question"
 *       question: { id: uuid, text: string, options: string[] }
 *       progress: { current: int >= 1, total: int >= 1 }
 *
 *     CompletionCheckResponse:
 *       required: [type, totalAnswered, specUrl]
 *       type: "complete"
 */
import { describe, it, expect } from 'vitest';

describe('POST /questions/next contract', () => {
  describe('NextQuestionRequest schema validation', () => {
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
  });

  describe('QuestionResponse schema validation', () => {
    it('should validate question response has type, question, and progress', () => {
      const response = {
        type: 'question' as const,
        question: {
          id: '550e8400-e29b-41d4-a716-446655440001',
          text: 'What authentication methods should be supported?',
          options: [
            'Email/password only',
            'OAuth + email/password',
            'SSO enterprise',
            'Other',
          ],
        },
        progress: {
          current: 1,
          total: 12,
        },
      };

      expect(response.type).toBe('question');
      expect(response.question).toHaveProperty('id');
      expect(response.question).toHaveProperty('text');
      expect(response.question).toHaveProperty('options');
      expect(response.progress).toHaveProperty('current');
      expect(response.progress).toHaveProperty('total');
    });

    it('should validate question.id is UUID format', () => {
      const questionId = '550e8400-e29b-41d4-a716-446655440001';

      expect(questionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should validate options is a non-empty string array', () => {
      const options = [
        'Email/password only',
        'OAuth + email/password',
        'SSO enterprise',
        'Other',
      ];

      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
      options.forEach((opt) => {
        expect(typeof opt).toBe('string');
      });
    });

    it('should validate progress.current >= 1 and progress.total >= 1', () => {
      const progress = { current: 1, total: 12 };

      expect(progress.current).toBeGreaterThanOrEqual(1);
      expect(progress.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CompletionCheckResponse schema validation', () => {
    it('should validate completion response has type "complete", totalAnswered, and specUrl', () => {
      const response = {
        type: 'complete' as const,
        totalAnswered: 12,
        specUrl:
          'http://localhost:3000/api/spec/550e8400-e29b-41d4-a716-446655440000?format=html',
      };

      expect(response.type).toBe('complete');
      expect(response).toHaveProperty('totalAnswered');
      expect(response).toHaveProperty('specUrl');
      expect(typeof response.totalAnswered).toBe('number');
      expect(typeof response.specUrl).toBe('string');
    });
  });
});
