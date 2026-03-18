/**
 * wave-planner.ts -- Topological sort to compute execution waves from
 * a dependency graph.
 *
 * Wave 1 = minds with no dependencies
 * Wave 2 = minds whose deps are all in Wave 1
 * Wave N = minds whose deps are all in Waves 1..N-1
 */

import type { ExecutionWave, MindTaskGroup } from "./implement-types.ts";
import { buildDependencyGraph } from "./task-parser.ts";
import { topoSort } from "../../shared/topo-sort.ts";

/**
 * Compute execution waves from task groups.
 *
 * Uses Kahn's algorithm (BFS topological sort) to produce waves of minds
 * that can execute concurrently. Minds within a wave have no inter-
 * dependencies -- all their deps are satisfied by earlier waves.
 *
 * Throws if a cycle is detected (deadlock).
 */
export function computeWaves(groups: MindTaskGroup[]): ExecutionWave[] {
  const deps = buildDependencyGraph(groups);
  const allMinds = new Set(groups.map((g) => g.mind));
  const rawWaves = topoSort(allMinds, deps, "throw");

  const waves = rawWaves.map((minds, i) => ({
    id: `wave-${i + 1}`,
    minds,
  }));

  // Pre-flight validation: verify no consumer is in same/earlier wave than its producer
  const violations = validateWaveOrdering(waves, groups);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`  Wave ordering violation: ${v}`);
    }
  }

  return waves;
}

/**
 * Validate that every consumes annotation is satisfied by a producer
 * in an earlier wave. Returns violation messages (empty = valid).
 */
export function validateWaveOrdering(
  waves: ExecutionWave[],
  groups: MindTaskGroup[],
): string[] {
  // Build mind → wave index lookup
  const mindWaveIdx = new Map<string, number>();
  for (let i = 0; i < waves.length; i++) {
    for (const mind of waves[i].minds) {
      mindWaveIdx.set(mind, i);
    }
  }

  // Build producer lookups
  const producerByPath = new Map<string, string>();
  const producerByIface = new Map<string, string>();
  for (const g of groups) {
    for (const t of g.tasks) {
      if (t.produces) {
        if (t.produces.path) producerByPath.set(t.produces.path, g.mind);
        producerByIface.set(t.produces.interface, g.mind);
      }
    }
  }

  const violations: string[] = [];
  for (const g of groups) {
    for (const t of g.tasks) {
      if (!t.consumes) continue;
      const producerMind =
        (t.consumes.path && producerByPath.get(t.consumes.path)) ||
        producerByIface.get(t.consumes.interface);
      if (!producerMind || producerMind === g.mind) continue;

      const consumerWave = mindWaveIdx.get(g.mind) ?? -1;
      const producerWave = mindWaveIdx.get(producerMind) ?? -1;

      if (consumerWave <= producerWave) {
        violations.push(
          `Task ${t.id} (@${g.mind}, ${waves[consumerWave]?.id}) consumes ` +
          `${t.consumes.interface} from @${producerMind} (${waves[producerWave]?.id}). ` +
          `@${g.mind} must be in a later wave than @${producerMind}.`,
        );
      }
    }
  }

  return violations;
}

/**
 * Format waves as a human-readable plan string.
 */
export function formatWavePlan(
  waves: ExecutionWave[],
  groups: MindTaskGroup[],
): string {
  const groupMap = new Map(groups.map((g) => [g.mind, g]));
  const lines: string[] = [];

  for (const wave of waves) {
    lines.push(`  ${wave.id}: [${wave.minds.map((m) => `@${m}`).join(", ")}]`);
    for (const mind of wave.minds) {
      const group = groupMap.get(mind);
      if (group) {
        lines.push(`    @${mind}: ${group.tasks.length} task(s)`);
        for (const t of group.tasks) {
          const pTag = t.parallel ? " [P]" : "";
          lines.push(`      ${t.id}${pTag} ${t.description.slice(0, 60)}`);
        }
      }
    }
  }

  return lines.join("\n");
}
