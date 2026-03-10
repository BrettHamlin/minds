/**
 * task-parser.ts -- Parse tasks.md content and group tasks by @mind tag.
 *
 * Reuses parseTasks() from minds/lib/contracts.ts for the low-level line
 * parsing, then groups tasks by mind and extracts dependency info from
 * section headers.
 */

import { parseTasks, type ParsedTask } from "../../lib/contracts.ts";
import type { MindTask, MindTaskGroup } from "./implement-types.ts";

/**
 * Parse tasks.md content into MindTaskGroups, one per mind.
 *
 * Each group carries the tasks assigned to that mind and the dependency
 * list extracted from the section header's `(depends on: ...)` annotation.
 */
export function parseAndGroupTasks(content: string): MindTaskGroup[] {
  const parsed: ParsedTask[] = parseTasks(content);

  // Group by mind, preserving encounter order
  const groupMap = new Map<string, { tasks: MindTask[]; deps: string[] }>();

  for (const t of parsed) {
    if (!groupMap.has(t.mind)) {
      groupMap.set(t.mind, {
        tasks: [],
        deps: [...t.sectionDeclaredDeps],
      });
    }

    const task: MindTask = {
      id: t.id,
      mind: t.mind,
      description: t.description,
      parallel: t.parallel,
    };
    if (t.produces) task.produces = t.produces;
    if (t.consumes) task.consumes = t.consumes;

    groupMap.get(t.mind)!.tasks.push(task);
  }

  const groups: MindTaskGroup[] = [];
  for (const [mind, data] of groupMap) {
    groups.push({
      mind,
      tasks: data.tasks,
      dependencies: data.deps,
    });
  }

  return groups;
}

/**
 * Build a dependency graph from task groups.
 * Returns { mind_name: [dependency_mind_names] }.
 */
export function buildDependencyGraph(
  groups: MindTaskGroup[],
): Record<string, string[]> {
  const deps: Record<string, string[]> = {};
  for (const g of groups) {
    if (g.dependencies.length > 0) {
      deps[g.mind] = [...g.dependencies];
    }
  }
  return deps;
}
