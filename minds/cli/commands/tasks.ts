/**
 * tasks.ts — Deterministic task generation CLI.
 *
 * Replaces the LLM-driven minds.tasks.md slash command. TypeScript handles
 * all mechanical work (context building, E2E config, boundaries, dependencies,
 * linting). The LLM is called only for creative decisions:
 *   1. Fetch ticket from Linear
 *   2. Decide which minds are involved and what tasks each needs
 *
 * Usage: bun minds/cli/bin/minds.ts tasks <ticket-id>
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getRepoRoot, resolveMindsDir } from "../../shared/paths.js";
import { loadWorkspace } from "../../shared/workspace-loader.ts";
import { loadMultiRepoRegistries } from "../../shared/registry-loader.ts";
import { findFeatureDir } from "../../pipeline_core/feature.ts";
import { parseTasks, lintTasks } from "../../lib/contracts.ts";
import { parseAndGroupTasks } from "../lib/task-parser.ts";
import { callLlmReviewDefault } from "../../lib/supervisor/supervisor-llm.ts";
import { matchesOwnership } from "../../shared/paths.ts";
import type { MindDescription } from "../../mind.ts";
import type { LintError } from "../../lib/contracts.ts";
import {
  detectTestFramework,
  detectMockupPath,
  detectE2eInfra,
  buildE2eTaskDescription,
  buildE2eBoundaryExtension,
  type TasksContext,
} from "../lib/tasks-context.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Call claude -p with a prompt and return the response. */
async function callLlm(prompt: string, timeoutMs = 120_000): Promise<string> {
  return callLlmReviewDefault(prompt, timeoutMs);
}

/**
 * Extract JSON from LLM output that may be wrapped in prose, code fences, or both.
 * Handles: raw JSON, ```json fenced, prose + fenced, trailing explanation.
 */
export function extractJson(raw: string): string {
  // Try to find JSON within code fences first
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenced) return fenced[1].trim();
  // Try to find a raw JSON object
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }
  return raw.trim();
}

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Add a `depends on: @depName` annotation to a mind's section header in tasks.md content.
 * Handles three cases: existing depends on, existing parenthetical, bare header.
 */
export function addDependsOnToHeader(content: string, mindName: string, depName: string): string {
  const eMind = escapeRegExp(mindName);
  const headerRe = new RegExp(`(## @${eMind} Tasks[^\\n]*)`);
  const headerMatch = content.match(headerRe);
  if (!headerMatch) return content;

  const header = headerMatch[1];
  if (header.includes(depName)) return content; // already present

  if (header.includes("depends on:")) {
    return content.replace(header, header.replace(/depends on:([^)]+)/, `depends on:$1, @${depName}`));
  } else if (header.includes("(")) {
    return content.replace(header, header.replace(/\)\s*$/, `, depends on: @${depName})`));
  } else {
    return content.replace(header, `${header} (depends on: @${depName})`);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LlmTasksResult {
  minds: Array<{
    name: string;
    isNew: boolean;
    ownsFiles?: string[];
    dependsOn: string[];
    tasks: Array<{
      description: string;
      parallel: boolean;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runTasks(ticketId: string): Promise<void> {
  // Validate ticket ID format
  if (!/^[A-Z]+-\d+$/.test(ticketId)) {
    console.error(`Error: Invalid ticket ID format: ${ticketId}. Expected: ABC-123`);
    process.exit(1);
  }

  console.log(`\nMinds Tasks: ${ticketId}`);

  // ── Step 1: Load workspace and registry (deterministic) ─────────────────

  const repoRoot = getRepoRoot();
  const workspace = loadWorkspace(repoRoot);
  const orchestratorRoot = workspace.orchestratorRoot;
  const mindsDir = resolveMindsDir(orchestratorRoot);

  let registry: MindDescription[];
  if (workspace.isMultiRepo) {
    registry = loadMultiRepoRegistries(workspace.repoPaths);
  } else {
    const mindsJsonPath = join(mindsDir, "minds.json");
    if (!existsSync(mindsJsonPath)) {
      console.error(`Error: minds.json not found at ${mindsJsonPath}`);
      process.exit(1);
    }
    registry = JSON.parse(readFileSync(mindsJsonPath, "utf-8"));
  }
  console.log(`  Registry: ${registry.length} mind(s) loaded`);

  // ── Step 2: Resolve or create feature directory (deterministic) ─────────

  let featureDir = findFeatureDir(orchestratorRoot, ticketId, {});
  if (!featureDir) {
    featureDir = join(orchestratorRoot, "specs", ticketId);
    mkdirSync(featureDir, { recursive: true });
    console.log(`  Created feature dir: ${featureDir}`);
  } else {
    console.log(`  Feature dir: ${featureDir}`);
  }

  // ── Step 3: Load ticket data (from pre-fetched file) ─────────────────────

  const ticketPath = join(featureDir, "ticket.json");
  let ticket: { title: string; description: string; labels: string[]; project: string | null };
  if (existsSync(ticketPath)) {
    try {
      ticket = JSON.parse(readFileSync(ticketPath, "utf-8"));
      console.log(`  Ticket (cached): ${ticket.title}`);
    } catch (err) {
      console.error(`  Failed to parse ${ticketPath}: ${err}`);
      process.exit(1);
    }
  } else {
    console.error(`  Error: ticket.json not found at ${ticketPath}`);
    console.error(`  The slash command must fetch the ticket from Linear and write it before calling the CLI.`);
    console.error(`  Expected format: { "title": "...", "description": "...", "labels": [...], "project": "..." }`);
    process.exit(1);
  }

  // ── Step 4: Build deterministic context ─────────────────────────────────

  const e2eInfra = detectE2eInfra(orchestratorRoot);
  const ctx: TasksContext = {
    repoRoot: orchestratorRoot,
    mindsDir,
    registry,
    featureDir,
    ticketId,
    testFramework: detectTestFramework(orchestratorRoot),
    hasE2eInfra: e2eInfra.hasRegistry,
    e2eRegistrySchema: e2eInfra.schema
      ? { mind: e2eInfra.schema.mindKey, file: e2eInfra.schema.fileKey }
      : null,
    mockupPath: detectMockupPath(ticket.description),
  };

  console.log(`  Test framework: ${ctx.testFramework}`);
  console.log(`  E2E infrastructure: ${ctx.hasE2eInfra ? "yes" : "no"}`);
  if (ctx.mockupPath) console.log(`  Mockup: ${ctx.mockupPath}`);

  // ── Step 5: Generate tasks via LLM ──────────────────────────────────────

  console.log("  Generating tasks...");
  const taskPrompt = buildTaskGenerationPrompt(ctx, ticket);
  let llmResult: LlmTasksResult;
  try {
    const raw = await callLlm(taskPrompt, 180_000);
    llmResult = JSON.parse(extractJson(raw));
    console.log(`  LLM returned ${llmResult.minds.length} mind(s)`);
  } catch (err) {
    console.error(`  Failed to generate tasks: ${err}`);
    process.exit(1);
  }

  // ── Step 5b: Normalize and validate LLM mind names ──────────────────────

  for (const mind of llmResult.minds) {
    // Strip leading @ — the assembler adds it
    mind.name = mind.name.replace(/^@/, "");
    // Strip @ from dependsOn entries too
    mind.dependsOn = mind.dependsOn.map((d) => d.replace(/^@/, ""));

    if (!mind.isNew && !registry.some((r) => r.name === mind.name)) {
      console.error(`  Warning: LLM referenced non-existent mind @${mind.name} (isNew=false). Marking as new.`);
      mind.isNew = true;
    }
  }

  // ── Step 6: Assemble tasks.md (deterministic) ───────────────────────────

  let tasksContent = assembleTasksMd(ctx, llmResult);

  // ── Step 7: Auto-fix known issues (deterministic) ───────────────────────

  const e2eMindName = injectE2eTasks(ctx, tasksContent, llmResult);
  if (e2eMindName) {
    tasksContent = e2eMindName.content;
    tasksContent = extendE2eBoundaries(ctx, tasksContent, e2eMindName.mindName);
  }
  tasksContent = inferImplicitDependencies(ctx, tasksContent, llmResult);

  // ── Step 8: Lint and auto-fix (deterministic) ───────────────────────────

  let parsed = parseTasks(tasksContent);
  let lintResult = lintTasks(parsed, registry);

  if (!lintResult.valid) {
    console.log(`  Lint found ${lintResult.errors.length} error(s), attempting auto-fix...`);
    tasksContent = autoFixLintErrors(tasksContent, lintResult.errors);
    parsed = parseTasks(tasksContent);
    lintResult = lintTasks(parsed, registry);

    if (!lintResult.valid) {
      console.error("\n  Lint errors remain after auto-fix:");
      for (const err of lintResult.errors) {
        console.error(`    [${err.type}] ${err.task}: ${err.message}`);
      }
      const tasksPath = join(featureDir, "tasks.md");
      writeFileSync(tasksPath, tasksContent);
      console.error(`\n  Wrote tasks with errors to ${tasksPath}`);
      process.exit(1);
    }
    console.log("  Lint errors auto-fixed.");
  }

  if (lintResult.warnings.length > 0) {
    for (const warn of lintResult.warnings) {
      console.log(`  Warning [${warn.type}] ${warn.task}: ${warn.message}`);
    }
  }

  // ── Step 9: Write output (deterministic) ────────────────────────────────

  const tasksPath = join(featureDir, "tasks.md");
  writeFileSync(tasksPath, tasksContent);
  console.log(`\n  Wrote ${tasksPath}`);

  // ── Step 10: Report ─────────────────────────────────────────────────────

  const groups = parseAndGroupTasks(tasksContent);
  const totalTasks = groups.reduce((s, g) => s + g.tasks.length, 0);
  console.log(`\n  Summary:`);
  console.log(`    Total tasks: ${totalTasks}`);
  for (const g of groups) {
    console.log(`    @${g.mind}: ${g.tasks.length} task(s)`);
  }
  if (ctx.mockupPath) {
    console.log(`    E2E visual comparison task included`);
  }
}

// ---------------------------------------------------------------------------
// LLM Prompt — no task IDs (assembler generates them)
// ---------------------------------------------------------------------------

function buildTaskGenerationPrompt(
  ctx: TasksContext,
  ticket: { title: string; description: string },
): string {
  const registrySummary = ctx.registry
    .map((m) => `  @${m.name}: domain="${m.domain}", owns=[${m.owns_files.join(", ")}]`)
    .join("\n");

  return `You are generating implementation tasks for ticket ${ctx.ticketId}: ${ticket.title}.

## Ticket Description

${ticket.description}

## Available Minds (from minds.json)

${registrySummary}

## Pre-computed Context (DO NOT override — these are handled by deterministic code)

- Test framework: ${ctx.testFramework} (detected from package.json)
- E2E infrastructure: ${ctx.hasE2eInfra ? "yes (tests/e2e/registry.json exists)" : "no"}
- Mockup: ${ctx.mockupPath ?? "none"}
- E2E tests, test framework, registry schema, and boundary declarations are handled automatically. Do NOT generate tasks for E2E tests.

## Your Job

Return a JSON object. Each mind gets high-level implementation tasks. Do NOT include:
- E2E test tasks (auto-generated)
- File path specifications for tests
- Test framework instructions
- Registry schema details

DO include:
- Which minds are involved (existing or new)
- What implementation work each mind needs (code, not tests)
- Unit test tasks (the drone handles test file placement)
- Dependencies between minds (dependsOn)
- For new minds: ownsFiles declaring what directories they own

Return ONLY this JSON structure:
{
  "minds": [
    {
      "name": "mind-name",
      "isNew": true,
      "ownsFiles": ["packages/modules/config/**"],
      "dependsOn": [],
      "tasks": [
        { "description": "High-level task description", "parallel": false },
        { "description": "Another task", "parallel": true }
      ]
    }
  ]
}

Rules:
- Each task stays within ONE mind's owns_files boundary
- Do NOT put specific file paths in task descriptions — the drone decides which files to create/modify
- Task descriptions should be high-level: WHAT to build, not WHERE to put files
- dependsOn lists minds whose work this mind depends on
- Return ONLY the JSON. No explanation, no markdown.`;
}

// ---------------------------------------------------------------------------
// Assembly — convert LLM JSON → tasks.md format
// ---------------------------------------------------------------------------

export function assembleTasksMd(ctx: TasksContext, result: LlmTasksResult): string {
  const lines: string[] = [];
  lines.push(`# ${ctx.ticketId} Tasks\n`);

  let taskCounter = 0;

  for (const mind of result.minds) {
    const headerParts: string[] = [];
    if (mind.isNew && mind.ownsFiles?.length) {
      headerParts.push(`owns: ${mind.ownsFiles.join(", ")}`);
    }
    if (mind.dependsOn.length > 0) {
      headerParts.push(`depends on: ${mind.dependsOn.map((d) => `@${d}`).join(", ")}`);
    }
    const headerSuffix = headerParts.length > 0 ? ` (${headerParts.join(", ")})` : "";
    lines.push(`## @${mind.name} Tasks${headerSuffix}\n`);

    for (const task of mind.tasks) {
      taskCounter++;
      const id = `T${String(taskCounter).padStart(3, "0")}`;
      const pTag = task.parallel ? " [P]" : "";
      lines.push(`- [ ] ${id} @${mind.name}${pTag} ${task.description}`);
    }

    lines.push("");
  }

  // Cross-mind contracts table
  if (result.minds.some((m) => m.dependsOn.length > 0)) {
    lines.push("## Cross-Mind Contracts\n");
    lines.push("| Producer | Interface | Consumer |");
    lines.push("|----------|-----------|----------|");
    for (const mind of result.minds) {
      for (const dep of mind.dependsOn) {
        lines.push(`| @${dep} | (dependency) | @${mind.name} |`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Auto-fix — three separate, focused passes
// ---------------------------------------------------------------------------

/** Inject E2E task for UI minds when mockup + E2E infra exist. Returns the modified content + mind name, or null. */
export function injectE2eTasks(
  ctx: TasksContext, content: string, result: LlmTasksResult,
): { content: string; mindName: string } | null {
  if (!ctx.mockupPath || !ctx.hasE2eInfra) return null;

  const uiMind = result.minds.find((m) => m.isNew) ?? result.minds[0];
  if (!uiMind) return null;

  const e2eDesc = buildE2eTaskDescription(ctx, uiMind.name);
  const taskCount = (content.match(/^- \[ \] T\d+/gm) ?? []).length;
  const nextId = `T${String(taskCount + 1).padStart(3, "0")}`;
  const e2eTask = `- [ ] ${nextId} @${uiMind.name} ${e2eDesc}`;

  // Insert at the end of the uiMind's section (before the next ## or end of content)
  const eMind = escapeRegExp(uiMind.name);
  const sectionStartRe = new RegExp(`## @${eMind} Tasks[^\\n]*\\n`);
  const sectionStart = content.match(sectionStartRe);

  if (sectionStart && sectionStart.index !== undefined) {
    // Find the next ## header after this section
    const afterSection = content.indexOf("\n## ", sectionStart.index + sectionStart[0].length);
    if (afterSection !== -1) {
      return {
        content: content.slice(0, afterSection) + "\n" + e2eTask + "\n" + content.slice(afterSection),
        mindName: uiMind.name,
      };
    }
    // No next section — append before contracts or at end
    const contractsIdx = content.indexOf("## Cross-Mind Contracts");
    if (contractsIdx !== -1) {
      return {
        content: content.slice(0, contractsIdx) + e2eTask + "\n\n" + content.slice(contractsIdx),
        mindName: uiMind.name,
      };
    }
    return { content: content + "\n" + e2eTask + "\n", mindName: uiMind.name };
  }

  // Fallback — append at end
  return { content: content + "\n" + e2eTask + "\n", mindName: uiMind.name };
}

/** Extend owns: boundary for the specific mind that has E2E tasks. */
export function extendE2eBoundaries(ctx: TasksContext, content: string, mindName: string): string {
  if (!ctx.hasE2eInfra) return content;

  const eMind = escapeRegExp(mindName);
  const e2eBoundary = buildE2eBoundaryExtension(mindName);

  // Match header with any parenthetical
  const headerRe = new RegExp(`(## @${eMind} Tasks\\s*\\([^)]*)(\\))`);
  const match = content.match(headerRe);
  if (match && !match[1].includes("tests/e2e/")) {
    if (match[1].includes("owns:")) {
      return content.replace(headerRe, `$1, ${e2eBoundary}$2`);
    }
    // Has parenthetical but no owns:
    return content.replace(headerRe, `$1, owns: ${e2eBoundary}$2`);
  }

  if (!match) {
    // No parenthetical — check for bare header
    const bareRe = new RegExp(`(## @${eMind} Tasks)(\\s*\\n)`);
    if (content.match(bareRe)) {
      return content.replace(bareRe, `$1 (owns: ${e2eBoundary})$2`);
    }
  }

  return content;
}

/** Compute implicit dependencies from file paths in task descriptions. */
export function inferImplicitDependencies(ctx: TasksContext, content: string, result: LlmTasksResult): string {
  let fixed = content;

  for (const mind of result.minds) {
    const allDescs = mind.tasks.map((t) => t.description).join(" ");
    const pathRe = /\b([a-zA-Z_.][\w.\-]*(?:\/[a-zA-Z_][\w.\-]*)+)\b/g;
    let pathMatch;
    const implicitDeps = new Set<string>();

    while ((pathMatch = pathRe.exec(allDescs)) !== null) {
      const path = pathMatch[1];
      for (const regMind of ctx.registry) {
        if (regMind.name === mind.name) continue;
        if (regMind.owns_files.some((op) => matchesOwnership(path, [op]))) {
          implicitDeps.add(regMind.name);
          break;
        }
      }
    }

    for (const dep of implicitDeps) {
      if (!mind.dependsOn.includes(dep)) {
        fixed = addDependsOnToHeader(fixed, mind.name, dep);
      }
    }
  }

  return fixed;
}

// ---------------------------------------------------------------------------
// Lint auto-fix — deterministic corrections for known lint error types
// ---------------------------------------------------------------------------

export function autoFixLintErrors(content: string, errors: LintError[]): string {
  let fixed = content;

  for (const err of errors) {
    if (err.type === "implicit_cross_mind_dep") {
      const depMatch = err.message.match(/@(\w[\w-]*)\) references.*owned by @(\w[\w-]*)/);
      if (depMatch) {
        fixed = addDependsOnToHeader(fixed, depMatch[1], depMatch[2]);
      }
    }

    if (err.type === "cross_mind_leakage") {
      const taskMatch = err.message.match(/Task (T\d+) references @(\w[\w-]*)/);
      if (taskMatch) {
        const [, taskId, mindRef] = taskMatch;
        const taskLineRe = new RegExp(`(- \\[ \\] ${taskId}[^\\n]*)`);
        const taskLine = fixed.match(taskLineRe);
        if (taskLine) {
          // Split the task line into prefix (up to and including the mind tag + optional [P])
          // and description (everything after). Only strip @mind-ref from the description,
          // and only when not inside quotes (e.g., registry JSON entries).
          const line = taskLine[1];
          const prefixRe = /^(- \[ \] T\d+ @[\w-]+(?:\s+\[P\])?\s+)/;
          const prefixMatch = line.match(prefixRe);
          if (prefixMatch) {
            const prefix = prefixMatch[1];
            const desc = line.slice(prefix.length);
            const fixedDesc = desc.replace(new RegExp(`(?<!")@${escapeRegExp(mindRef)}\\b`, "g"), mindRef);
            fixed = fixed.replace(line, prefix + fixedDesc);
          }
        }
      }
    }

  }

  return fixed;
}
