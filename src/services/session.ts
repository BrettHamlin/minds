/**
 * Session service - manages workflow session state
 */

import { db } from '../db/index.js';
import { sessions, specs } from '../db/schema.js';
import { eq, and, gt } from 'drizzle-orm';

export async function createSession(
  specId: string,
  pmUserId: string,
  slackChannelId: string
) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
  
  const [session] = await db
    .insert(sessions)
    .values({
      specId,
      pmUserId,
      slackChannelId,
      expiresAt,
      currentStep: 'awaiting_description',
      isActive: true,
    })
    .returning();
  
  return session;
}

export async function getActiveSession(pmUserId: string) {
  const now = new Date();
  
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.pmUserId, pmUserId),
      eq(sessions.isActive, true),
      gt(sessions.expiresAt, now)
    ),
    with: {
      spec: true,
    },
  });
  
  return session;
}

export async function updateSessionStep(
  sessionId: string,
  step: typeof sessions.$inferSelect.currentStep,
  metadata?: Record<string, unknown>
) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // Refresh expiry
  
  const [session] = await db
    .update(sessions)
    .set({
      currentStep: step,
      expiresAt,
      updatedAt: new Date(),
      ...(metadata && { metadata }),
    })
    .where(eq(sessions.id, sessionId))
    .returning();
  
  return session;
}

export async function deactivateSession(sessionId: string) {
  const [session] = await db
    .update(sessions)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId))
    .returning();
  
  return session;
}
