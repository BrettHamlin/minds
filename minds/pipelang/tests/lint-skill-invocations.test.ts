// Lint check: no bare /collab.X skill invocations in src/commands/*.md
//
// Bare invocations (e.g. `/collab.specify $ARGUMENTS` in a code block) cause
// the model to use the Skill tool, which creates a response boundary and stops
// the orchestrator mid-flow. All /collab.X calls must use the inline execution
// pattern ("Read the file ... Do NOT invoke it as a skill").
//
// Exemptions: add `<!-- lint:ok -->` in the 8 lines preceding the code block.

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

const COMMANDS_DIR = resolve(import.meta.dir, "../../../src/commands");

const ALLOWED_PATTERNS = [
  "Read the file",
  "Do NOT invoke",
  "execute inline",
  "lint:ok",
];

export interface SkillViolation {
  file: string;
  line: number;
  text: string;
}

/**
 * Scan markdown content for bare /collab.X invocations inside code blocks.
 * Returns violations — lines that start with /collab.\w+ inside a ``` block
 * without any allowed-pattern context in the preceding 8 lines.
 */
export function findBareSkillInvocations(
  content: string,
  filePath: string
): SkillViolation[] {
  const violations: SkillViolation[] = [];
  const lines = content.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();

    if (stripped.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (!inCodeBlock) continue;
    if (!/^\/collab\.\w+/.test(stripped)) continue;

    // Check context: current line + 8 lines before it
    const context = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
    if (ALLOWED_PATTERNS.some((p) => context.includes(p))) continue;

    violations.push({ file: filePath, line: i + 1, text: stripped });
  }

  return violations;
}

describe("lint: no bare /collab.X skill invocations in command files", () => {
  const files = readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const file of files) {
    test(file, () => {
      const content = readFileSync(join(COMMANDS_DIR, file), "utf-8");
      const violations = findBareSkillInvocations(content, file);

      if (violations.length > 0) {
        const msg = violations
          .map(
            (v) =>
              `  ${v.file}:${v.line}: "${v.text}"\n` +
              `    → Replace with: Read the file \`.claude/commands/<cmd>.md\` and execute inline. Do NOT invoke it as a /collab.X skill.`
          )
          .join("\n");
        throw new Error(
          `ERROR: Bare /collab.X Skill invocation(s) found — these will trigger a Skill tool response boundary:\n${msg}`
        );
      }
    });
  }
});
