/**
 * Answer service - manages Blind QA answer submissions
 */

import { db } from '../db/index.js';
import { answers, questions, specs } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { validateOptionIndex } from '../lib/validation.js';

export async function submitAnswer(
  questionId: string,
  specId: string,
  selectedOptionIndex?: number,
  customText?: string
) {
  // Verify question exists
  const question = await db.query.questions.findFirst({
    where: eq(questions.id, questionId),
  });

  if (!question) {
    throw new NotFoundError('Question not found');
  }

  // Check if already answered
  const existingAnswer = await db.query.answers.findFirst({
    where: eq(answers.questionId, questionId),
  });

  if (existingAnswer) {
    throw new ConflictError('ANSWER_ALREADY_EXISTS', 'This question has already been answered');
  }

  // Validate answer
  const isCustom = customText !== undefined && customText !== null && customText.trim() !== '';
  
  if (!isCustom && selectedOptionIndex === undefined) {
    throw new ValidationError('INVALID_ANSWER', 'Either selectedOptionIndex or customText must be provided');
  }

  if (!isCustom) {
    validateOptionIndex(selectedOptionIndex!, question.options.length);
  }

  if (isCustom && !customText?.trim()) {
    throw new ValidationError('INVALID_ANSWER', 'Custom text cannot be empty');
  }

  // Get selected option text if not custom
  const selectedOptionText = !isCustom && selectedOptionIndex !== undefined
    ? question.options[selectedOptionIndex]
    : customText;

  // Insert answer
  const [answer] = await db
    .insert(answers)
    .values({
      questionId,
      specId,
      selectedOptionIndex: !isCustom ? selectedOptionIndex : null,
      selectedOptionText,
      customText: isCustom ? customText : null,
      isCustom,
    })
    .returning();

  // Increment answered questions count
  await db
    .update(specs)
    .set({
      answeredQuestions: sql`${specs.answeredQuestions} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(specs.id, specId));

  // Get updated spec for progress
  const spec = await db.query.specs.findFirst({
    where: eq(specs.id, specId),
  });

  return {
    answer,
    progress: {
      answered: spec?.answeredQuestions || 0,
      total: spec?.totalQuestions || 0,
    },
  };
}
