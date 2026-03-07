/**
 * task-phases.ts — Shared parsing for ## Phase N: sections in tasks.md files.
 *
 * Single source of truth for phase structure extraction.
 * Used by verify-and-complete.ts (scope filtering) and analyze-task-phases.ts (summary).
 *
 * Install path: .collab/lib/pipeline/task-phases.ts
 */

export interface TaskPhase {
  number: number;
  title: string;
  total: number;
  complete: number;
  incomplete: number;
}

/**
 * Parse ## Phase N: sections from tasks.md content.
 *
 * For each phase section, counts:
 * - total: all task lines (- [ ], - [x], - [X])
 * - complete: lines starting with - [x] or - [X]
 * - incomplete: lines starting with - [ ]
 *
 * Lines outside any Phase section are ignored.
 * A non-Phase ## heading ends the current phase section.
 */
export function parseTaskPhases(content: string): TaskPhase[] {
  const lines = content.split("\n");
  const phases: TaskPhase[] = [];
  let currentPhase: TaskPhase | null = null;

  for (const line of lines) {
    const phaseMatch = line.match(/^## Phase ([0-9]+):\s*(.*)/);
    if (phaseMatch) {
      if (currentPhase) phases.push(currentPhase);
      currentPhase = {
        number: parseInt(phaseMatch[1], 10),
        title: phaseMatch[2].trim(),
        total: 0,
        complete: 0,
        incomplete: 0,
      };
      continue;
    }

    // Non-phase ## heading ends the current phase section
    if (/^## /.test(line)) {
      if (currentPhase) {
        phases.push(currentPhase);
        currentPhase = null;
      }
      continue;
    }

    if (currentPhase) {
      if (line.startsWith("- [x]") || line.startsWith("- [X]")) {
        currentPhase.total++;
        currentPhase.complete++;
      } else if (line.startsWith("- [ ]")) {
        currentPhase.total++;
        currentPhase.incomplete++;
      }
    }
  }

  if (currentPhase) phases.push(currentPhase);
  return phases;
}

// ---------------------------------------------------------------------------
// Task-line parsing (individual task items with @mind / [P] / [US#] tags)
// ---------------------------------------------------------------------------

export interface ParsedTask {
  id: string;
  mind: string | null;
  parallelizable: boolean;
  story: string | null;
  description: string;
  complete: boolean;
}

/**
 * Regex for a single task line.
 * Group 1: checkbox content (' ', 'x', or 'X')
 * Group 2: task ID (T followed by digits)
 * Group 3: the block of recognized tags ([P], [US\w+], @mindname) in any order
 * Group 4: remaining description text
 */
const TASK_LINE_RE = /^- \[([ xX])\]\s+(T\d+)((?:\s+(?:\[P\]|\[US\w+\]|@[\w-]+))*)\s*(.*?)\s*$/;

/**
 * Parses a single task line into a ParsedTask.
 * Returns null if the line is not a valid task line.
 */
export function parseTaskLine(line: string): ParsedTask | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;

  const [, checkbox, id, tags, description] = m;
  return {
    id,
    complete: checkbox === "x" || checkbox === "X",
    parallelizable: /\[P\]/.test(tags),
    story: tags.match(/\[(US\w+)\]/)?.[1] ?? null,
    mind: tags.match(/@([\w-]+)/)?.[1] ?? null,
    description,
  };
}

/**
 * Parses all task lines from a tasks.md content string.
 * Non-task lines are silently skipped.
 */
export function parseTasks(content: string): ParsedTask[] {
  return content.split("\n").flatMap((line) => {
    const task = parseTaskLine(line);
    return task ? [task] : [];
  });
}
