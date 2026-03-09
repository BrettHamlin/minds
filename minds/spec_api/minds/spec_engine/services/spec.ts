/**
 * Spec service - manages specification creation and lifecycle
 */

import { db } from '../db/index.js';
import { specs } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export async function createSpec(
  title: string,
  description: string,
  pmUserId: string,
  pmDisplayName?: string
) {
  const [spec] = await db
    .insert(specs)
    .values({
      title,
      description,
      pmUserId,
      pmDisplayName,
      state: 'drafting',
    })
    .returning();
  
  return spec;
}

export async function updateSpecAnalysis(
  specId: string,
  complexityScore: number,
  totalQuestions: number,
  title: string
) {
  const [spec] = await db
    .update(specs)
    .set({
      complexityScore,
      totalQuestions,
      title,
      updatedAt: new Date(),
    })
    .where(eq(specs.id, specId))
    .returning();
  
  return spec;
}

export async function getSpec(specId: string) {
  const spec = await db.query.specs.findFirst({
    where: eq(specs.id, specId),
    with: {
      channel: true,
      roles: {
        with: { members: true },
        orderBy: (roles, { asc }) => [asc(roles.sortOrder)],
      },
      questions: {
        with: { answer: true },
        orderBy: (questions, { asc }) => [asc(questions.sequenceOrder)],
      },
    },
  });
  
  return spec;
}

export async function transitionSpecState(
  specId: string,
  fromState: typeof specs.$inferSelect.state,
  toState: typeof specs.$inferSelect.state
) {
  const [spec] = await db
    .update(specs)
    .set({
      state: toState,
      updatedAt: new Date(),
    })
    .where(and(
      eq(specs.id, specId),
      eq(specs.state, fromState)
    ))
    .returning();

  if (!spec) {
    throw new Error(`Invalid state transition from ${fromState} to ${toState}`);
  }

  return spec;
}
