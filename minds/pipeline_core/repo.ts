/**
 * repo.ts — Repository root detection.
 *
 * Re-exports getRepoRoot from the canonical shared/paths module.
 * Kept for backward compatibility — all new code should import from @minds/shared/paths.
 */

export { getRepoRoot } from "../shared/paths.js";
