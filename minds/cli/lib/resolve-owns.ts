/**
 * resolve-owns.ts — Pure functions for resolving ownsFiles precedence
 * and requireBoundary flag in the implement dispatcher.
 *
 * Extracted from implement.ts (T011/T012) so the logic is testable
 * without pulling in filesystem, tmux, bus, or git dependencies.
 */

export interface RegistryEntry {
  name: string;
  owns_files?: string[];
}

export interface OwnsResolution {
  /** Resolved owns_files globs (task annotation > registry > undefined). */
  ownsFiles: string[] | undefined;
  /** True when the mind is unregistered and must have boundary enforcement. */
  requireBoundary: boolean;
}

/**
 * Resolve ownsFiles and requireBoundary for a mind being dispatched.
 *
 * Precedence (T011):
 *   1. Task group's `ownsFiles` (from `owns:` section annotation)
 *   2. Registry entry's `owns_files` (existing minds.json)
 *   3. undefined (no boundary — supervisor handles downstream)
 *
 * requireBoundary (T012):
 *   - true when the mind is NOT in the registry (unregistered)
 *   - false when the mind IS in the registry
 */
export function resolveOwnsAndBoundary(
  groupOwnsFiles: string[] | undefined,
  registry: RegistryEntry[],
  mindName: string,
): OwnsResolution {
  const registeredNames = new Set(registry.map((m) => m.name));
  const isRegistered = registeredNames.has(mindName);
  const mindEntry = registry.find((m) => m.name === mindName);

  // T011: owns: precedence — task annotation > registry > undefined
  const ownsFiles = groupOwnsFiles ?? mindEntry?.owns_files;

  // T012: unregistered minds must have boundary enforcement
  const requireBoundary = !isRegistered;

  return { ownsFiles, requireBoundary };
}
