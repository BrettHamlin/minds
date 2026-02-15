/**
 * Spec generation service - creates formatted specification documents
 */

import { db } from '../db/index.js';
import { specs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSpec, transitionSpecState } from './spec.js';
import { getQuestionsWithAnswers } from './question.js';
import { generateSpec } from './llm.js';
import { markdownToHtml } from '../lib/markdown.js';

export async function generateSpecContent(specId: string) {
  const spec = await getSpec(specId);
  
  if (!spec) {
    throw new Error('Spec not found');
  }

  // Get all Q&A pairs
  const questionsData = await getQuestionsWithAnswers(specId);
  const qas = questionsData
    .filter(q => q.answer)
    .map(q => ({
      question: q.text,
      answer: q.answer!.isCustom ? q.answer!.customText! : q.answer!.selectedOptionText!,
    }));

  // Generate spec content with LLM
  const content = await generateSpec(
    spec.description,
    qas,
    spec.roles.map(r => ({ name: r.name, rationale: r.rationale || '' }))
  );

  // Convert to HTML
  const contentHtml = markdownToHtml(content);

  // Update spec with generated content
  await db
    .update(specs)
    .set({
      content,
      contentHtml,
      updatedAt: new Date(),
    })
    .where(eq(specs.id, specId));

  // Transition to completed state
  await transitionSpecState(specId, 'generating', 'completed');

  return { content, contentHtml };
}

export function getSpecUrl(specId: string): string {
  return `${process.env.SPEC_BASE_URL}/spec/${specId}`;
}
