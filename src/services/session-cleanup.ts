/**
 * Session timeout handling - cleans up expired sessions
 */

import { db } from '../db/index.js';
import { sessions, specs } from '../db/schema.js';
import { and, eq, lt } from 'drizzle-orm';

export async function cleanupExpiredSessions() {
  const now = new Date();

  // Find expired active sessions
  const expiredSessions = await db.query.sessions.findMany({
    where: and(
      eq(sessions.isActive, true),
      lt(sessions.expiresAt, now)
    ),
    with: {
      spec: true,
    },
  });

  for (const session of expiredSessions) {
    // Deactivate session
    await db
      .update(sessions)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, session.id));

    // Transition spec to abandoned if still in drafting/questioning
    if (session.spec.state === 'drafting' || session.spec.state === 'questioning') {
      await db
        .update(specs)
        .set({
          state: 'abandoned',
          updatedAt: new Date(),
        })
        .where(eq(specs.id, session.specId));
    }

    // TODO: Send DM to PM about expiration
    console.log(`Session ${session.id} expired for user ${session.pmUserId}`);
  }

  return expiredSessions.length;
}

// Start cleanup interval (run every 5 minutes)
export function startSessionCleanup() {
  setInterval(async () => {
    const cleaned = await cleanupExpiredSessions();
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired sessions`);
    }
  }, 5 * 60 * 1000); // 5 minutes
}
