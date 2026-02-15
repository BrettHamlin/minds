/**
 * Blind QA orchestrator - manages question generation and completion
 */

import { createQuestion, getQuestionCount } from './question.js';
import { getSpec, transitionSpecState, generateSpecContent } from './spec.js';
import { generateQuestion } from './llm.js';

export async function startBlindQA(specId: string) {
  const spec = await getSpec(specId);

  if (!spec) {
    throw new Error('Spec not found');
  }

  // Generate first question
  const firstQuestion = await generateQuestion(spec.description, [], 1, spec.totalQuestions || 10);

  const createdQuestion = await createQuestion(
    specId,
    firstQuestion.text,
    firstQuestion.options,
    1
  );

  return createdQuestion;
}

export async function generateNextQuestion(specId: string, previousAnswers: Array<{ question: string; answer: string }>) {
  const spec = await getSpec(specId);
  
  if (!spec) {
    throw new Error('Spec not found');
  }

  const { answered, total } = await getQuestionCount(specId);
  const nextSequence = answered + 1;

  if (nextSequence > total) {
    return null; // No more questions
  }

  const nextQuestion = await generateQuestion(
    spec.description,
    previousAnswers,
    nextSequence,
    total
  );

  await createQuestion(
    specId,
    nextQuestion.text,
    nextQuestion.options,
    nextSequence
  );

  return nextQuestion;
}

export async function isComplete(specId: string): Promise<boolean> {
  const { answered, total } = await getQuestionCount(specId);
  return answered >= total;
}

export async function completeBlindQA(specId: string) {
  // Transition to generating state
  await transitionSpecState(specId, 'questioning', 'generating');

  // Generate the specification content
  await generateSpecContent(specId);

  return true;
}
