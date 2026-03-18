/**
 * diagnosis.ts — Classifies failures from captured output into actionable categories.
 */

import type { Diagnosis } from "./fix-tracker.ts";

// ── Category Detection Rules ───────────────────────────────────────────

interface CategoryRule {
  category: Diagnosis["category"];
  patterns: RegExp[];
  suggestedFiles: string[];
}

const RULES: CategoryRule[] = [
  {
    category: "bus_failure",
    patterns: [
      /Error starting bus/i,
      /bus server startup timeout/i,
      /bus server exited unexpectedly/i,
      /bus server spawn error/i,
      /ECONNREFUSED.*minds-bus/i,
      /BUS_READY.*timeout/i,
    ],
    suggestedFiles: [
      "minds/transport/minds-bus-lifecycle.ts",
      "minds/transport/minds-bus-server.ts",
    ],
  },
  {
    category: "merge_conflict",
    patterns: [
      /Merge failed/i,
      /CONFLICT/,
      /merge --abort/i,
      /could not merge/i,
    ],
    suggestedFiles: [
      "minds/lib/merge-drone.ts",
    ],
  },
  {
    category: "boundary_violation",
    patterns: [
      /boundary violation/i,
      /outside your boundary/i,
      /protected infrastructure file/i,
      /BOUNDARY_VIOLATION/,
    ],
    suggestedFiles: [
      "minds/lib/supervisor/boundary-check.ts",
      "minds/lib/supervisor/supervisor-checks.ts",
    ],
  },
  {
    category: "contract_error",
    patterns: [
      /contract.*error/i,
      /dangling_consume/i,
      /ownership_overlap/i,
      /cross_mind_leakage/i,
      /missing_dependency_header/i,
    ],
    suggestedFiles: [
      "minds/lib/contracts.ts",
      "minds/lib/check-contracts-core.ts",
    ],
  },
  {
    category: "task_lint",
    patterns: [
      /valid.*false/i,
      /lint.*fail/i,
      /still failing after/i,
      /task.*validation.*failed/i,
    ],
    suggestedFiles: [
      "minds/lib/contracts.ts",
      "minds/cli/lib/task-parser.ts",
    ],
  },
  {
    category: "task_generation",
    patterns: [
      /failed to generate tasks/i,
      /tasks\.md.*not found/i,
      /no tasks generated/i,
    ],
    suggestedFiles: [
      "minds/commands/tasks.md",
      "minds/cli/lib/task-parser.ts",
    ],
  },
  {
    category: "drone_crash",
    patterns: [
      /drone.*crash/i,
      /drone.*exited unexpectedly/i,
      /pane.*dead/i,
      /pane.*not found/i,
    ],
    suggestedFiles: [
      "minds/lib/drone-pane.ts",
      "minds/lib/supervisor/supervisor-drone.ts",
    ],
  },
  {
    category: "drone_stall",
    patterns: [
      /drone.*timeout/i,
      /drone.*stall/i,
      /Wave \d+ did not complete/i,
      /waiting for drone/i,
    ],
    suggestedFiles: [
      "minds/lib/drone-pane.ts",
      "minds/lib/supervisor/mind-supervisor.ts",
      "minds/lib/supervisor/supervisor-drone.ts",
    ],
  },
  {
    category: "timeout",
    patterns: [
      /timeout/i,
      /timed out/i,
    ],
    suggestedFiles: [
      "minds/lib/supervisor/mind-supervisor.ts",
    ],
  },
];

// ── Main Function ──────────────────────────────────────────────────────

export function diagnoseFailure(
  rawOutput: string,
  allPaneOutputs: Record<string, string> = {},
): Diagnosis {
  // Combine all outputs for pattern matching
  const combinedOutput = [rawOutput, ...Object.values(allPaneOutputs)].join("\n");

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(combinedOutput)) {
        // Extract a summary line near the match
        const summary = extractSummaryNearMatch(combinedOutput, pattern);
        return {
          category: rule.category,
          summary,
          rawOutput,
          allPaneOutputs,
          suggestedFiles: rule.suggestedFiles,
        };
      }
    }
  }

  // Fallback: unknown
  const lastLines = rawOutput.split("\n").filter(Boolean).slice(-5).join("\n");
  return {
    category: "unknown",
    summary: `Unclassified failure. Last output:\n${lastLines}`,
    rawOutput,
    allPaneOutputs,
    suggestedFiles: [
      "minds/cli/commands/implement.ts",
      "minds/lib/supervisor/mind-supervisor.ts",
    ],
  };
}

function extractSummaryNearMatch(text: string, pattern: RegExp): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      // Return the matching line plus up to 2 lines of context
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 3);
      return lines.slice(start, end).join("\n");
    }
  }
  return lines.filter(Boolean).slice(-3).join("\n");
}
