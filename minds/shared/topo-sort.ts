/**
 * topo-sort.ts -- Shared topological sort using Kahn's algorithm.
 *
 * Produces execution waves: Wave 1 = nodes with no dependencies,
 * Wave N = nodes whose deps are all in Waves 1..N-1.
 *
 * Cycle handling is configurable:
 *   - "throw": throws an error listing remaining nodes
 *   - "collect": silently adds remaining nodes as a final wave
 */

export type CycleStrategy = "throw" | "collect";

/**
 * Topologically sort `allNodes` given a dependency map, returning
 * ordered waves of node names that can execute concurrently within
 * each wave.
 */
export function topoSort(
  allNodes: Set<string>,
  deps: Record<string, string[]>,
  onCycle: CycleStrategy = "throw",
): string[][] {
  const inDegree = new Map<string, number>();
  const downstream = new Map<string, string[]>();

  for (const m of allNodes) {
    inDegree.set(m, 0);
    downstream.set(m, []);
  }

  for (const [node, nodeDeps] of Object.entries(deps)) {
    if (!allNodes.has(node)) continue;
    for (const dep of nodeDeps) {
      if (!allNodes.has(dep)) continue;
      inDegree.set(node, (inDegree.get(node) ?? 0) + 1);
      downstream.get(dep)!.push(node);
    }
  }

  const waves: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < allNodes.size) {
    const wave = [...allNodes]
      .filter((m) => !processed.has(m) && inDegree.get(m) === 0)
      .sort();

    if (wave.length === 0) {
      // Cycle detected
      const remaining = [...allNodes].filter((m) => !processed.has(m)).sort();
      if (onCycle === "throw") {
        throw new Error(
          `Cycle detected in dependency graph. Remaining minds: ${remaining.join(", ")}`,
        );
      }
      // "collect" — add remaining as final wave
      waves.push(remaining);
      break;
    }

    waves.push(wave);
    for (const m of wave) {
      processed.add(m);
      for (const down of downstream.get(m) ?? []) {
        inDegree.set(down, (inDegree.get(down) ?? 0) - 1);
      }
    }
  }

  return waves;
}
