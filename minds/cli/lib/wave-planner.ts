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

  return rawWaves.map((minds, i) => ({
    id: `wave-${i + 1}`,
    minds,
  }));
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
