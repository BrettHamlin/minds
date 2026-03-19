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
  const groupMap = new Map<string, { tasks: MindTask[]; deps: string[]; ownsFiles: string[]; repo?: string }>();

  for (const t of parsed) {
    if (!groupMap.has(t.mind)) {
      groupMap.set(t.mind, {
        tasks: [],
        deps: [...t.sectionDeclaredDeps],
        ownsFiles: [...t.sectionOwnsFiles],
        repo: t.sectionRepo,
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
    if (t.sectionRepo) task.repo = t.sectionRepo;

    groupMap.get(t.mind)!.tasks.push(task);
  }

  const groups: MindTaskGroup[] = [];
  for (const [mind, data] of groupMap) {
    const group: MindTaskGroup = {
      mind,
      tasks: data.tasks,
      dependencies: data.deps,
    };
    if (data.ownsFiles.length > 0) {
      group.ownsFiles = data.ownsFiles;
    }
    if (data.repo) {
      group.repo = data.repo;
    }
    groups.push(group);
  }

  return groups;
}

/**
 * Build a dependency graph from task groups.
 * Returns { mind_name: [dependency_mind_names] }.
 *
 * Merges two dependency sources:
 *   1. Explicit section-level `(depends on: @x)` annotations
 *   2. Implicit contract dependencies from `consumes:`/`produces:` annotations
 *
 * Source (2) catches cases where a mind consumes an interface produced by
 * another mind but the tasks.md author forgot the section-level annotation.
 * Without this, both minds land in the same wave and the consumer's tests
 * fail because the producer hasn't been implemented yet.
 */
export function buildDependencyGraph(
  groups: MindTaskGroup[],
): Record<string, string[]> {
  const allMinds = new Set(groups.map((g) => g.mind));
  const depSets: Record<string, Set<string>> = {};
  for (const m of allMinds) depSets[m] = new Set();

  // Source 1: explicit section-level (depends on: ...) annotations
  for (const g of groups) {
    for (const dep of g.dependencies) {
      if (!allMinds.has(dep)) {
        console.error(
          `  Warning: @${g.mind} declares dependency on @${dep}, ` +
          `but @${dep} is not in the task groups. Check for name mismatches in tasks.md.`,
        );
      }
      depSets[g.mind].add(dep);
    }
  }

  // Source 2: contract-inferred dependencies from consumes/produces
  // Build producer lookup: path → mind, interface → mind
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

  // For each consumer, find the producing mind and add a dependency edge
  for (const g of groups) {
    for (const t of g.tasks) {
      if (!t.consumes) continue;
      const producerMind =
        (t.consumes.path && producerByPath.get(t.consumes.path)) ||
        producerByIface.get(t.consumes.interface);
      if (producerMind && producerMind !== g.mind && allMinds.has(producerMind)) {
        depSets[g.mind].add(producerMind);
      }
    }
  }

  // Convert to the expected format, omitting empty entries
  const deps: Record<string, string[]> = {};
  for (const [mind, set] of Object.entries(depSets)) {
    if (set.size > 0) deps[mind] = [...set].sort();
  }
  return deps;
}
