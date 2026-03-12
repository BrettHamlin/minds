#!/usr/bin/env bun
/**
 * Deterministic contract generation and linting for Mind-aware tasks.
 *
 * CLI usage:
 *   bun minds/lib/contracts.ts lint <tasks.md-path> <minds.json-path>
 *   bun minds/lib/contracts.ts generate <tasks.md-path>
 */

// TODO(BRE-455): Emit CONTRACT_FULFILLED bus event when a producer's interface is verified as
// consumed successfully by its declared consumers. Deferred until contract verification becomes
// deterministic — requires a runtime check that the consumer's build/tests passed with the
// produced interface, not just static annotation matching.

import type { MindDescription } from "../mind.ts";
import { matchesOwnership, stripGlob } from "../shared/paths.ts";
import { readFileSync } from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContractEntry {
  producer: string; // @mind_name that produces
  interface: string; // what's produced (e.g., "resolveSignalName()")
  path: string; // import path (e.g., "minds/signals/resolve-signal.ts")
  consumers: string[]; // @mind_names that consume this
}

export interface ParsedTask {
  id: string; // e.g., "T001"
  mind: string; // e.g., "pipeline_core"
  description: string; // full task description (excluding the @mind_name tag)
  produces?: { interface: string; path: string };
  consumes?: { interface: string; path: string };
  parallel: boolean; // has [P] marker
  // Internal fields for lint checks:
  sectionHasDepsHeader: boolean; // section header has (depends on: ...) annotation
  sectionDeclaredDeps: string[]; // minds declared in (depends on: ...) — without @
  sectionOwnsFiles: string[]; // globs declared in (owns: ...) — file ownership for new minds
  sectionRepo?: string; // repo alias declared in (repo: ...) — for multi-repo workspaces
}

export interface ContractReport {
  contracts: ContractEntry[];
  waves: string[][]; // topological sort: [["pipeline_core", "signals"], ["execution"]]
  dependencies: Record<string, string[]>; // { execution: ["pipeline_core", "signals"] }
}

export interface LintResult {
  valid: boolean;
  errors: LintError[];
  warnings: LintWarning[];
}

export interface LintError {
  type:
    | "dangling_consume"
    | "boundary_violation"
    | "cross_mind_leakage"
    | "missing_dependency_header"
    | "ownership_overlap"
    | "unregistered_no_owns"
    | "path_traversal"
    | "owns_conflict";
  task: string;
  message: string;
}

export interface LintWarning {
  type: "unused_produce" | "extra_dependency_header" | "overly_broad_owns" | "no_owner";
  task: string;
  message: string;
}

// ─── parseTasks ───────────────────────────────────────────────────────────────

/**
 * Parse a tasks.md file content into structured tasks.
 */
export function parseTasks(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = content.split("\n");

  let sectionHasDepsHeader = false;
  let sectionDeclaredDeps: string[] = [];
  let sectionOwnsFiles: string[] = [];
  let sectionRepo: string | undefined;

  for (const line of lines) {
    // Section header: ## @mind_name Tasks [(owns: glob1, glob2, depends on: @a, @b)]
    // The parenthetical may contain owns: and/or depends on: in any order.
    const sectionMatch = line.match(
      /^##\s+@([\w-]+)\s+Tasks(?:\s+\(([^)]+)\))?/
    );
    if (sectionMatch) {
      sectionHasDepsHeader = false;
      sectionDeclaredDeps = [];
      sectionOwnsFiles = [];
      sectionRepo = undefined;

      if (sectionMatch[2]) {
        const paren = sectionMatch[2];

        // Parse "depends on: ..." clause
        const depsMatch = paren.match(/depends\s+on:\s*([^,]*(?:,\s*@[\w-]+)*)/);
        if (depsMatch) {
          sectionHasDepsHeader = true;
          sectionDeclaredDeps = depsMatch[1]
            .split(",")
            .map((s) => s.trim().replace(/^@/, ""))
            .filter((s) => s.length > 0);
        }

        // Parse "owns: ..." clause
        const ownsMatch = paren.match(/owns:\s*([^,]*(?:,\s*(?!depends\s|repo\s*:)[\w./*\-:]+)*)/);
        if (ownsMatch) {
          sectionOwnsFiles = ownsMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }

        // Parse "repo: ..." clause
        const repoMatch = paren.match(/repo:\s*([\w-]+)/);
        if (repoMatch) sectionRepo = repoMatch[1];
      }
      continue;
    }

    // Task line: - [ ] T001 @mind_name [P]? description
    // Skip checked tasks: - [x] or - [X] means already complete
    if (/^\s*-\s+\[[xX]\]/.test(line)) continue;

    const taskMatch = line.match(
      /^\s*-\s+\[[ ]\]\s+(T\d+)\s+@([\w-]+)\s+(?:\[P\]\s+)?(.+)$/
    );
    if (!taskMatch) continue;

    const [, id, mind, rest] = taskMatch;
    const parallel = /^\s*-\s+\[ \]\s+T\d+\s+@[\w-]+\s+\[P\]/.test(line);

    // Parse produces annotation: produces: <interface> at <path>
    let produces: ParsedTask["produces"];
    const pm = rest.match(/produces:\s+(.+?)\s+at\s+(\S+)/);
    if (pm) {
      produces = { interface: pm[1].trim(), path: pm[2] };
    }

    // Parse consumes annotation: consumes: <interface> from <path>  OR  consumes: <token>
    let consumes: ParsedTask["consumes"];
    const cfm = rest.match(/consumes:\s+(.+?)\s+from\s+(\S+)/);
    if (cfm) {
      consumes = { interface: cfm[1].trim(), path: cfm[2] };
    } else {
      const csm = rest.match(/consumes:\s+(\S+)/);
      if (csm) {
        consumes = { interface: csm[1], path: "" };
      }
    }

    tasks.push({
      id,
      mind,
      description: rest.trim(),
      produces,
      consumes,
      parallel,
      sectionHasDepsHeader,
      sectionDeclaredDeps: [...sectionDeclaredDeps],
      sectionOwnsFiles: [...sectionOwnsFiles],
      sectionRepo,
    });
  }

  return tasks;
}

// ─── generateContracts ────────────────────────────────────────────────────────

/**
 * Build a ContractReport from parsed tasks: contracts table, dependency map,
 * and wave ordering via topological sort.
 */
export function generateContracts(tasks: ParsedTask[]): ContractReport {
  // Build producer lookup maps
  const byPath = new Map<string, { mind: string; iface: string }>();
  const byIface = new Map<string, { mind: string; path: string }>();

  for (const t of tasks) {
    if (t.produces) {
      if (t.produces.path) {
        byPath.set(t.produces.path, {
          mind: t.mind,
          iface: t.produces.interface,
        });
      }
      byIface.set(t.produces.interface, {
        mind: t.mind,
        path: t.produces.path,
      });
    }
  }

  // Build contracts and dependency graph
  const contractMap = new Map<string, ContractEntry>();
  const allMinds = new Set(tasks.map((t) => t.mind));
  const depSets: Record<string, Set<string>> = {};
  for (const m of allMinds) depSets[m] = new Set();

  for (const t of tasks) {
    if (!t.consumes) continue;

    const producer =
      (t.consumes.path && byPath.get(t.consumes.path)) ||
      byIface.get(t.consumes.interface);
    if (!producer) continue; // dangling — handled by lintTasks

    const key = `${producer.mind}:${t.consumes.interface}`;
    const existing = contractMap.get(key);
    if (existing) {
      if (!existing.consumers.includes(t.mind)) existing.consumers.push(t.mind);
    } else {
      contractMap.set(key, {
        producer: producer.mind,
        interface: t.consumes.interface,
        path: t.consumes.path || producer.path,
        consumers: [t.mind],
      });
    }

    if (producer.mind !== t.mind) {
      depSets[t.mind] ??= new Set();
      depSets[t.mind].add(producer.mind);
    }
  }

  const depsRecord: Record<string, string[]> = {};
  for (const [mind, set] of Object.entries(depSets)) {
    if (set.size > 0) depsRecord[mind] = [...set].sort();
  }

  return {
    contracts: [...contractMap.values()],
    waves: topoSort(allMinds, depsRecord),
    dependencies: depsRecord,
  };
}

// ─── lintTasks ────────────────────────────────────────────────────────────────

/**
 * Validate parsed tasks against the Minds registry.
 * Returns errors (must fix) and warnings (should fix).
 */
export function lintTasks(
  tasks: ParsedTask[],
  mindsRegistry: MindDescription[]
): LintResult {
  const errors: LintError[] = [];
  const warnings: LintWarning[] = [];

  // Build mind → owns_files map from registry
  const mindOwns = new Map<string, string[]>();
  for (const m of mindsRegistry) mindOwns.set(m.name, m.owns_files);

  // Build producer lookup maps (path → tasks, interface → tasks)
  const byPath = new Map<string, ParsedTask[]>();
  const byIface = new Map<string, ParsedTask[]>();
  for (const t of tasks) {
    if (!t.produces) continue;
    if (t.produces.path) {
      if (!byPath.has(t.produces.path)) byPath.set(t.produces.path, []);
      byPath.get(t.produces.path)!.push(t);
    }
    if (!byIface.has(t.produces.interface)) byIface.set(t.produces.interface, []);
    byIface.get(t.produces.interface)!.push(t);
  }

  // Track consumed interfaces/paths for unused_produce check
  const consumedIfaces = new Set<string>();
  const consumedPaths = new Set<string>();

  for (const t of tasks) {
    // ── 1. dangling_consume ─────────────────────────────────────────────────
    if (t.consumes) {
      const hasProducer =
        (t.consumes.path && byPath.has(t.consumes.path)) ||
        byIface.has(t.consumes.interface);

      if (!hasProducer) {
        errors.push({
          type: "dangling_consume",
          task: t.id,
          message: `Task ${t.id} consumes "${t.consumes.interface}" but no task produces it`,
        });
      } else {
        consumedIfaces.add(t.consumes.interface);
        if (t.consumes.path) consumedPaths.add(t.consumes.path);
      }
    }

    // ── 2. boundary_violation ───────────────────────────────────────────────
    const ownsFiles = mindOwns.get(t.mind);
    if (ownsFiles) {
      const pathsToCheck = extractPathsForBoundaryCheck(t.description);
      for (const p of pathsToCheck) {
        if (!matchesOwnership(p, ownsFiles)) {
          errors.push({
            type: "boundary_violation",
            task: t.id,
            message: `Task ${t.id} references path "${p}" outside @${t.mind}'s owns_files`,
          });
        }
      }
    }

    // ── 3. cross_mind_leakage ───────────────────────────────────────────────
    // Strip produces:/consumes: annotations, then look for @mind_name refs
    const cleaned = stripAnnotationsForLeakage(t.description);
    for (const ref of extractMindRefs(cleaned)) {
      if (ref !== t.mind) {
        errors.push({
          type: "cross_mind_leakage",
          task: t.id,
          message: `Task ${t.id} references @${ref} in description — only import paths in consumes: are allowed`,
        });
      }
    }

    // ── 4. missing_dependency_header ────────────────────────────────────────
    if (t.consumes && !t.sectionHasDepsHeader) {
      errors.push({
        type: "missing_dependency_header",
        task: t.id,
        message: `Task ${t.id} has consumes: annotation but its section header lacks (depends on: ...)`,
      });
    }
  }

  // ── 5. unused_produce ──────────────────────────────────────────────────────
  for (const t of tasks) {
    if (!t.produces) continue;
    const isConsumed =
      consumedIfaces.has(t.produces.interface) ||
      (t.produces.path ? consumedPaths.has(t.produces.path) : false);
    if (!isConsumed) {
      warnings.push({
        type: "unused_produce",
        task: t.id,
        message: `Task ${t.id} produces "${t.produces.interface}" but no task consumes it`,
      });
    }
  }

  // ── 6. extra_dependency_header ─────────────────────────────────────────────
  // Group tasks by mind, then check each declared dep is actually consumed
  const mindGroups = new Map<string, ParsedTask[]>();
  for (const t of tasks) {
    if (!mindGroups.has(t.mind)) mindGroups.set(t.mind, []);
    mindGroups.get(t.mind)!.push(t);
  }

  for (const [mind, mTasks] of mindGroups) {
    const first = mTasks[0];
    if (!first.sectionHasDepsHeader || first.sectionDeclaredDeps.length === 0)
      continue;

    for (const declaredDep of first.sectionDeclaredDeps) {
      const actuallyConsumes = mTasks.some((t) => {
        if (!t.consumes) return false;
        const producers =
          (t.consumes.path && byPath.get(t.consumes.path)) ||
          byIface.get(t.consumes.interface) ||
          [];
        return producers.some((p) => p.mind === declaredDep);
      });

      if (!actuallyConsumes) {
        warnings.push({
          type: "extra_dependency_header",
          task: `@${mind}`,
          message: `Section @${mind} declares dependency on @${declaredDep} but no tasks consume from it`,
        });
      }
    }
  }

  // ── 7. ownership_overlap (T003) ─────────────────────────────────────────────
  // Pairwise check across all minds (task minds + registry minds).
  // Build a combined map of mind → owns_files (task annotation or registry).
  const allMindOwns = new Map<string, string[]>();
  for (const [name, files] of mindOwns) allMindOwns.set(name, files);
  for (const [mind, mTasks] of mindGroups) {
    const first = mTasks[0];
    if (first.sectionOwnsFiles.length > 0) {
      allMindOwns.set(mind, first.sectionOwnsFiles);
    }
  }

  const mindNames = [...allMindOwns.keys()];
  for (let i = 0; i < mindNames.length; i++) {
    for (let j = i + 1; j < mindNames.length; j++) {
      const mindA = mindNames[i];
      const mindB = mindNames[j];
      const ownsA = allMindOwns.get(mindA)!;
      const ownsB = allMindOwns.get(mindB)!;

      for (const a of ownsA) {
        const prefixA = stripGlob(a);
        for (const b of ownsB) {
          const prefixB = stripGlob(b);
          if (prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA)) {
            errors.push({
              type: "ownership_overlap",
              task: `@${mindA}/@${mindB}`,
              message: `Ownership overlap: @${mindA} owns "${a}" and @${mindB} owns "${b}" — prefixes overlap`,
            });
          }
        }
      }
    }
  }

  // ── 8. unregistered_no_owns (T004) ────────────────────────────────────────
  for (const [mind, mTasks] of mindGroups) {
    if (!mindOwns.has(mind) && mTasks[0].sectionOwnsFiles.length === 0) {
      errors.push({
        type: "unregistered_no_owns",
        task: `@${mind}`,
        message: `@${mind} is not in the minds registry and has no owns: annotation — new minds must declare ownership`,
      });
    }
  }

  // ── 9. overly_broad_owns (T005) ───────────────────────────────────────────
  for (const [mind, mTasks] of mindGroups) {
    for (const glob of mTasks[0].sectionOwnsFiles) {
      if (glob === "**" || glob === "*" || /^[^/]+\/$/.test(glob)) {
        warnings.push({
          type: "overly_broad_owns",
          task: `@${mind}`,
          message: `@${mind} owns: "${glob}" is overly broad — use a more specific path like "src/api/**"`,
        });
      }
    }
  }

  // ── 10. path_traversal (T006) ─────────────────────────────────────────────
  for (const [mind, mTasks] of mindGroups) {
    for (const glob of mTasks[0].sectionOwnsFiles) {
      if (/(^|\/)\.\.(\/|$)/.test(glob)) {
        errors.push({
          type: "path_traversal",
          task: `@${mind}`,
          message: `@${mind} owns: "${glob}" contains ".." path traversal — this is not allowed`,
        });
      }
    }
  }

  // ── 11. owns_conflict (T007) ──────────────────────────────────────────────
  for (const [mind, mTasks] of mindGroups) {
    const taskOwns = mTasks[0].sectionOwnsFiles;
    if (taskOwns.length === 0) continue;
    const registryOwns = mindOwns.get(mind);
    if (!registryOwns) continue;
    // Compare: if the annotation differs from registry, emit error
    const taskSorted = [...taskOwns].sort().join(",");
    const regSorted = [...registryOwns].sort().join(",");
    if (taskSorted !== regSorted) {
      errors.push({
        type: "owns_conflict",
        task: `@${mind}`,
        message: `@${mind} owns: annotation [${taskOwns.join(", ")}] differs from registry owns_files [${registryOwns.join(", ")}]`,
      });
    }
  }

  // ── 12. no_owner warning (T023) ────────────────────────────────────────────
  // Advisory: warn if a task references a path that no mind (registry or task annotation) owns.
  for (const t of tasks) {
    const pathsToCheck = extractPathsForBoundaryCheck(t.description);
    for (const p of pathsToCheck) {
      // Check if ANY mind owns this path (registry or task annotation)
      let owned = false;
      for (const [, files] of allMindOwns) {
        if (matchesOwnership(p, files)) {
          owned = true;
          break;
        }
      }
      if (!owned) {
        warnings.push({
          type: "no_owner",
          task: t.id,
          message: `Task ${t.id} references path "${p}" which no mind owns — consider adding an owns: annotation`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function topoSort(
  allMinds: Set<string>,
  deps: Record<string, string[]>
): string[][] {
  const inDegree = new Map<string, number>();
  const downstream = new Map<string, string[]>();

  for (const m of allMinds) {
    inDegree.set(m, 0);
    downstream.set(m, []);
  }

  for (const [mind, mindDeps] of Object.entries(deps)) {
    if (!allMinds.has(mind)) continue;
    for (const dep of mindDeps) {
      if (!allMinds.has(dep)) continue;
      inDegree.set(mind, (inDegree.get(mind) ?? 0) + 1);
      downstream.get(dep)!.push(mind);
    }
  }

  const waves: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < allMinds.size) {
    const wave = [...allMinds]
      .filter((m) => !processed.has(m) && inDegree.get(m) === 0)
      .sort();

    if (wave.length === 0) {
      // Cycle detected — add remaining as final wave
      waves.push([...allMinds].filter((m) => !processed.has(m)).sort());
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

/**
 * Extract file paths from a task description for boundary checking.
 * Strips consumes: annotations first (imports are expected to cross boundaries).
 */
function extractPathsForBoundaryCheck(description: string): string[] {
  // Remove consumes: annotations — cross-boundary imports are intentional
  const text = description.replace(/consumes:\s+\S+(?:\s+from\s+\S+)?/g, "");
  const paths: string[] = [];
  // Match path-like tokens: letter/underscore-started segments separated by /
  const re = /\b([a-zA-Z_][\w.\-]*(?:\/[a-zA-Z_][\w.\-]*)+)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

/**
 * Strip produces:/consumes: annotations from a description before leakage check.
 */
function stripAnnotationsForLeakage(description: string): string {
  return description
    .replace(/produces:\s+.+?\s+at\s+\S+/g, "")
    .replace(/consumes:\s+\S+(?:\s+from\s+\S+)?/g, "");
}

/**
 * Extract @mind_name references from text (returns the name without @).
 */
function extractMindRefs(text: string): string[] {
  const refs: string[] = [];
  const re = /@(\w+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "lint") {
    if (args.length < 3) {
      console.error(
        "Usage: bun minds/lib/contracts.ts lint <tasks.md> <minds.json>"
      );
      process.exit(1);
    }
    const tasksContent = readFileSync(args[1], "utf8");
    const mindsContent = readFileSync(args[2], "utf8");
    const tasks = parseTasks(tasksContent);
    const registry: MindDescription[] = JSON.parse(mindsContent);
    const result = lintTasks(tasks, registry);
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exit(1);
  } else if (command === "generate") {
    if (args.length < 2) {
      console.error(
        "Usage: bun minds/lib/contracts.ts generate <tasks.md>"
      );
      process.exit(1);
    }
    const tasksContent = readFileSync(args[1], "utf8");
    const tasks = parseTasks(tasksContent);
    const report = generateContracts(tasks);
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(
      "Usage: bun minds/lib/contracts.ts <lint|generate> [args...]"
    );
    process.exit(1);
  }
}
