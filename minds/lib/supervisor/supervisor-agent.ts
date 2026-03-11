/**
 * supervisor-agent.ts — Mind Agent file generation for the supervisor review.
 *
 * Generates a `.claude/agents/Mind.md` file dynamically in the worktree
 * before each review call. The agent file carries domain context (MIND.md),
 * engineering standards, boundary ownership, and review instructions so
 * the review prompt itself can remain lean (just diff + tests + tasks).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { resolveMindsDir } from "../../shared/paths.ts";
import { formatReviewChecklist, REVIEW_RESPONSE_FORMAT } from "./supervisor-review.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MindAgentParams {
  mindName: string;
  worktreePath: string;
  repoRoot: string;
  standards: string;
  ownsFiles: string[];
  previousFeedback?: string;
  iteration: number;
  mindMdContent?: string;
}

// ---------------------------------------------------------------------------
// buildMindAgentContent — pure function, no side effects
// ---------------------------------------------------------------------------

export function buildMindAgentContent(params: MindAgentParams): string {
  const { mindName, standards, ownsFiles, previousFeedback, iteration, mindMdContent } = params;

  // Build frontmatter
  const frontmatter = `---
name: Mind
model: opus
permissions:
  allow:
    - "Bash(git:*)"
    - "Read(*)"
    - "Grep(*)"
    - "Glob(*)"
---`;

  // Build body sections
  const sections: string[] = [];

  // Identity
  sections.push(`# Code Reviewer: @${mindName}

You are reviewing code changes produced by a drone implementation cycle (iteration ${iteration}).
Your role is to evaluate the diff against the assigned tasks and engineering standards.
You may use your tools (git, Read, Grep, Glob) to inspect the codebase for deeper context.`);

  // MIND.md domain expertise (passed in by caller)
  if (mindMdContent) {
    sections.push(`## Domain Expertise (MIND.md)

${mindMdContent}`);
  }

  // Engineering standards
  if (standards) {
    sections.push(`## Engineering Standards

${standards}`);
  }

  // Boundary ownership
  if (ownsFiles.length > 0) {
    const fileList = ownsFiles.map((f) => `- \`${f}\``).join("\n");
    sections.push(`## Boundary (owns_files)

This mind owns the following file paths. Changes outside these paths are boundary violations.

${fileList}`);
  }

  // Previous feedback (for re-review iterations)
  if (previousFeedback) {
    sections.push(`## Previous Feedback

The following feedback was given in earlier review iterations. Verify these issues have been addressed.

${previousFeedback}`);
  }

  // Review checklist
  const checklist = formatReviewChecklist();
  sections.push(`## Review Checklist

Evaluate the diff against each item:

${checklist}`);

  // Response format
  sections.push(`## Response Format

${REVIEW_RESPONSE_FORMAT}`);

  return frontmatter + "\n\n" + sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// writeMindAgentFile — writes the agent file to the worktree
// ---------------------------------------------------------------------------

export function writeMindAgentFile(params: MindAgentParams): string {
  const agentDir = join(params.worktreePath, ".claude", "agents");
  mkdirSync(agentDir, { recursive: true });

  // Load MIND.md from disk if not already provided
  let enrichedParams = params;
  if (params.mindMdContent === undefined) {
    let mindMdContent: string | undefined;
    try {
      const mindsDir = resolveMindsDir(params.repoRoot);
      const mindMdPath = join(mindsDir, params.mindName, "MIND.md");
      if (existsSync(mindMdPath)) {
        mindMdContent = readFileSync(mindMdPath, "utf-8");
      }
    } catch {
      // Graceful — MIND.md is optional enrichment
    }
    enrichedParams = { ...params, mindMdContent };
  }

  const agentPath = join(agentDir, "Mind.md");
  const content = buildMindAgentContent(enrichedParams);
  writeFileSync(agentPath, content, "utf-8");

  return agentPath;
}

// ---------------------------------------------------------------------------
// cleanupMindAgentFile — removes the agent file (best-effort, safe if missing)
// ---------------------------------------------------------------------------

export function cleanupMindAgentFile(worktreePath: string): void {
  try {
    const agentPath = join(worktreePath, ".claude", "agents", "Mind.md");
    if (existsSync(agentPath)) {
      rmSync(agentPath);
    }
  } catch {
    // Best-effort cleanup — don't fail the supervisor if removal fails
  }
}
