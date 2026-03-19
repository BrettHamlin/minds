/**
 * Blind QA orchestrator - manages question generation and completion
 */

import { getQuestionCount } from './question.js';
import { getSpec, transitionSpecState } from './spec.js';
import { generateSpecContent } from './spec-generator.js';

export async function startBlindQA(specId: string) {
  const spec = await getSpec(specId);

  if (!spec) {
    throw new Error('Spec not found');
  }

  throw new Error('LLM service removed — blind QA question generation not available');
}

export async function generateNextQuestion(specId: string, previousAnswers: Array<{ question: string; answer: string }>) {
  const spec = await getSpec(specId);

  if (!spec) {
    throw new Error('Spec not found');
  }

  throw new Error('LLM service removed — blind QA question generation not available');
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
