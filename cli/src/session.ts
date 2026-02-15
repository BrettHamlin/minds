/**
 * T019: Session ID generation for CLI plugin.
 *
 * Format: cli-{username}-{epoch_seconds}
 * Source: os.userInfo().username
 * Constraint: Must fit within varchar(64)
 *
 * Example: cli-atlas-1739520000
 */
import { userInfo } from 'node:os';

/**
 * Generate a unique session ID for CLI usage.
 * Format: cli-{os_username}-{epoch_seconds}
 *
 * The session ID serves as pmUserId in API calls and must be:
 * - Unique per user session (username + epoch ensures this)
 * - Distinguishable from Slack user IDs (cli- prefix)
 * - Within varchar(64) limit (~47 chars max)
 * - Human-readable for database debugging
 */
export function generateSessionId(): string {
  const username = userInfo().username;
  const epochSeconds = Math.floor(Date.now() / 1000);

  return `cli-${username}-${epochSeconds}`;
}
