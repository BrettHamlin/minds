/**
 * T049-T050: Unit tests for QA prompt enhancements.
 *
 * T049: "Other" option detection identifies last option as custom text trigger
 * T050: QA loop correctly handles type:"complete" response and exits loop
 */
import { describe, it, expect } from 'vitest';
import {
  isOtherOption,
  isQAComplete,
  countWords,
  validateDescription,
  validateOptionIndex,
  validateChannelName,
} from '../../src/prompts.js';

describe('QA prompt enhancements', () => {
  // ----- T049: "Other" option detection -----

  describe('T049: "Other" option detection', () => {
    it('should identify last option containing "Other" as custom text trigger', () => {
      const options = [
        'Use JWT tokens',
        'Use session cookies',
        'Use OAuth2',
        'Other (please specify)',
      ];

      expect(isOtherOption(options.length - 1, options)).toBe(true);
    });

    it('should identify "Other" option case-insensitively', () => {
      const options = ['Option A', 'Option B', 'other'];

      expect(isOtherOption(2, options)).toBe(true);
    });

    it('should not identify non-last option as "Other"', () => {
      const options = ['Other', 'Option B', 'Option C'];

      // Only the last option triggers custom text
      expect(isOtherOption(0, options)).toBe(false);
    });

    it('should not identify regular last option as "Other"', () => {
      const options = ['Option A', 'Option B', 'Use microservices'];

      expect(isOtherOption(2, options)).toBe(false);
    });

    it('should handle "Other (please specify)" text', () => {
      const options = ['A', 'B', 'Other (please specify)'];

      expect(isOtherOption(2, options)).toBe(true);
    });

    it('should handle "Other..." text', () => {
      const options = ['A', 'B', 'Other...'];

      expect(isOtherOption(2, options)).toBe(true);
    });
  });

  // ----- T050: QA loop completion detection -----

  describe('T050: QA loop completion detection', () => {
    it('should detect type:"complete" as QA complete', () => {
      const response = {
        type: 'complete' as const,
        totalAnswered: 12,
        specUrl: 'http://localhost:3000/api/spec/abc-123?format=html',
      };

      expect(isQAComplete(response)).toBe(true);
    });

    it('should detect type:"question" as QA not complete', () => {
      const response = {
        type: 'question' as const,
        question: {
          id: 'q-1',
          text: 'How should auth work?',
          options: ['JWT', 'Sessions', 'OAuth'],
        },
        progress: { current: 1, total: 10 },
      };

      expect(isQAComplete(response)).toBe(false);
    });

    it('should detect isComplete:true from answer response as complete', () => {
      const answerResponse = {
        specId: 'abc',
        questionId: 'q-1',
        answerId: 'a-1',
        progress: { answered: 10, total: 10 },
        isComplete: true,
      };

      expect(isQAComplete(answerResponse)).toBe(true);
    });

    it('should detect isComplete:false from answer response as not complete', () => {
      const answerResponse = {
        specId: 'abc',
        questionId: 'q-1',
        answerId: 'a-1',
        progress: { answered: 5, total: 10 },
        isComplete: false,
      };

      expect(isQAComplete(answerResponse)).toBe(false);
    });
  });

  // ----- Existing validation tests remain passing -----

  describe('validation functions (regression)', () => {
    it('countWords counts correctly', () => {
      expect(countWords('one two three')).toBe(3);
      expect(countWords('  spaced  out  ')).toBe(2);
    });

    it('validateDescription rejects short descriptions', () => {
      expect(validateDescription('too short')).toBeDefined();
    });

    it('validateDescription accepts valid descriptions', () => {
      expect(
        validateDescription(
          'Build a user authentication system with email login and password reset and OAuth support'
        )
      ).toBeUndefined();
    });

    it('validateOptionIndex validates range', () => {
      expect(validateOptionIndex(0, 3)).toBeUndefined();
      expect(validateOptionIndex(3, 3)).toBeUndefined();
      expect(validateOptionIndex(4, 3)).toBeDefined();
      expect(validateOptionIndex(-1, 3)).toBeDefined();
    });

    it('validateChannelName validates format', () => {
      expect(validateChannelName('spec-auth-feature')).toBeUndefined();
      expect(validateChannelName('INVALID')).toBeDefined();
    });
  });
});
