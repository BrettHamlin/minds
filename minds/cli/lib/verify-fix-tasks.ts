/**
 * verify-fix-tasks.ts — Generate fix tasks from visual verification findings.
 *
 * Reads VERIFICATION-FINDINGS.md, calls Opus to convert the findings into
 * tasks.md format with correct @mind routing. Reuses the same LLM call
 * infrastructure as the supervisor code review (callLlmReviewDefault).
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { callLlmReviewDefault } from "../../lib/supervisor/supervisor-llm.ts";
import type { MindDescription } from "../../mind.ts";

/**
 * Read VERIFICATION-FINDINGS.md and check if there are actual findings.
 * Returns the findings text, or null if no findings / file doesn't exist.
 */
export function readFindings(repoRoot: string): string | null {
  const findingsPath = join(repoRoot, "VERIFICATION-FINDINGS.md");
  if (!existsSync(findingsPath)) return null;

  const content = readFileSync(findingsPath, "utf-8").trim();
  if (!content || content.includes("NO_FINDINGS")) return null;

  return content;
}

/**
 * Generate fix tasks from verification findings using Opus.
 *
 * The prompt instructs Opus to read the findings, look at the mind registry,
 * and produce tasks in standard tasks.md format (@mind routing, file paths,
 * actionable descriptions).
 *
 * Returns the raw tasks.md content string (ready to be parsed by parseTasks).
 */
export async function generateFixTasks(
  findings: string,
  registry: MindDescription[],
  ticketId: string,
): Promise<string> {
  const registrySummary = registry
    .map((m) => `@${m.name}: owns ${m.owns_files.join(", ")}`)
    .join("\n");

  const prompt = `You are generating fix tasks for visual verification findings.

## Findings from Visual Verification

${findings}

## Mind Registry (file ownership)

${registrySummary}

## Instructions

Convert each finding into a fix task in tasks.md format. Rules:

1. Each task must be assigned to the @mind that owns the file that needs to change (check owns_files above)
2. Use the standard format: \`- [ ] T001 @mind-name Fix description at file/path.ts\`
3. Be specific — say exactly what to add, change, or remove
4. Reference the mockup's expected state in the task description
5. Group tasks by mind with section headers: \`## @mind-name Fix Tasks\`
6. Number tasks sequentially starting from T001

Output ONLY the tasks.md content. No explanation, no preamble.

## Example Output

\`\`\`
## @config-module Fix Tasks

- [ ] T001 @config-module Add section group headers (PLATFORM, MODULES, OUTPUT) to sidebar in packages/modules/config/templates/sidebar.ts
- [ ] T002 @config-module Add icon SVGs to each sidebar item in packages/modules/config/templates/sidebar.ts
- [ ] T003 @config-module Add description text below each sidebar item label in packages/modules/config/templates/sidebar.ts
\`\`\`
`;

  const output = await callLlmReviewDefault(prompt, 60_000);
  return output;
}
