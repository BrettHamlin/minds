#!/usr/bin/env bun

/**
 * emit-findings.ts — CLI for agents to write findings and emit _QUESTIONS signal.
 *
 * Enforces the correct FindingsBatch schema so agents don't need to know
 * the internal structure. Agents pass questions as simple JSON objects
 * and this CLI wraps them in the correct format.
 *
 * Usage:
 *   bun emit-findings.ts --phase clarify --round 1 --stdin
 *   echo '<json>' | bun emit-findings.ts --phase clarify --round 1 --stdin
 *   bun emit-findings.ts --phase clarify --round 1 <findings-json-file>
 *
 * Input JSON format (array of questions):
 *   [
 *     {
 *       "question": "Which table should the API query?",
 *       "why": "Two table systems exist with different schemas",
 *       "specReferences": ["Section 3.1 mentions feed_items"],
 *       "codePatterns": ["src/services/briefing.ts uses feed_items"],
 *       "constraints": ["Must not break existing API consumers"],
 *       "implications": ["Determines migration strategy"]
 *     }
 *   ]
 *
 * All context fields (why, specReferences, codePatterns, constraints,
 * implications) are optional — defaults to empty strings/arrays.
 *
 * Environment:
 *   FEATURE_DIR — path to the feature specs directory (optional, auto-detected)
 *
 * Exit codes:
 *   0 = success (findings written and signal emitted)
 *   1 = usage error
 *   2 = invalid input
 *   3 = write/emit error
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";

import type { Finding, FindingsBatch } from "../lib/pipeline/questions";
import { findingsPath } from "../lib/pipeline/paths";
import { getRepoRoot } from "../lib/pipeline/repo";

// ── Input types ──────────────────────────────────────────────────────────────

interface QuestionInput {
  question: string;
  why?: string;
  specReferences?: string[];
  codePatterns?: string[];
  constraints?: string[];
  implications?: string[];
}

// ── Validation ───────────────────────────────────────────────────────────────

function isQuestionInput(obj: unknown): obj is QuestionInput {
  if (typeof obj !== "object" || obj === null) return false;
  const q = obj as Record<string, unknown>;
  return typeof q.question === "string" && q.question.length > 0;
}

function toFinding(input: QuestionInput, index: number): Finding {
  return {
    id: `f${index + 1}`,
    question: input.question,
    context: {
      why: input.why ?? "",
      specReferences: input.specReferences ?? [],
      codePatterns: input.codePatterns ?? [],
      constraints: input.constraints ?? [],
      implications: input.implications ?? [],
    },
  };
}

// ── Feature dir resolution ───────────────────────────────────────────────────

function resolveFeatureDir(featureDirEnv?: string): string {
  if (featureDirEnv && existsSync(featureDirEnv)) return featureDirEnv;

  // Auto-detect from resolve-feature.ts
  const repoRoot = getRepoRoot();
  try {
    const result = execSync("bun .collab/scripts/resolve-feature.ts 2>/dev/null", {
      encoding: "utf-8",
      cwd: repoRoot,
    });
    const parsed = JSON.parse(result);
    if (parsed.FEATURE_DIR && existsSync(parsed.FEATURE_DIR)) {
      return parsed.FEATURE_DIR;
    }
  } catch {
    // fall through
  }

  throw new Error(
    "Could not resolve feature directory. Set FEATURE_DIR or run from a feature worktree.",
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let phase: string | undefined;
  let round = 1;
  let ticketId: string | undefined;
  let inputArg: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--phase":
        phase = args[++i];
        break;
      case "--round":
        round = parseInt(args[++i], 10);
        break;
      case "--ticket":
        ticketId = args[++i];
        break;
      case "--stdin":
        inputArg = "--stdin";
        break;
      default:
        if (!inputArg) inputArg = args[i];
        break;
    }
  }

  if (!phase) {
    console.error("Usage: emit-findings.ts --phase <phase> [--round <N>] [--ticket <id>] <input.json|--stdin>");
    console.error("");
    console.error("Input: JSON array of { question, why?, specReferences?, codePatterns?, constraints?, implications? }");
    process.exit(1);
  }

  if (isNaN(round) || round < 1) {
    console.error(`Error: round must be a positive integer, got: ${args[args.indexOf("--round") + 1]}`);
    process.exit(1);
  }

  // Read input
  let rawInput: string;
  if (inputArg === "--stdin") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    rawInput = Buffer.concat(chunks).toString("utf-8");
  } else if (inputArg && existsSync(inputArg)) {
    rawInput = readFileSync(inputArg, "utf-8");
  } else {
    console.error("Error: provide a JSON file path or --stdin");
    process.exit(1);
  }

  // Parse input
  let questions: QuestionInput[];
  try {
    const parsed = JSON.parse(rawInput);
    if (!Array.isArray(parsed)) {
      throw new Error("Input must be a JSON array of question objects");
    }
    questions = parsed;
  } catch (e) {
    console.error(`Error: invalid JSON input: ${e}`);
    process.exit(2);
  }

  // Validate each question
  const invalid = questions.filter((q, i) => !isQuestionInput(q));
  if (invalid.length > 0) {
    console.error(`Error: ${invalid.length} invalid question(s). Each must have a non-empty "question" string.`);
    process.exit(2);
  }

  // Convert to findings
  const findings: Finding[] = questions.map((q, i) => toFinding(q, i));

  // Resolve feature dir and ticket ID
  const featureDir = resolveFeatureDir(process.env.FEATURE_DIR);

  if (!ticketId) {
    // Try to extract from metadata.json
    try {
      const metaPath = join(featureDir, "metadata.json");
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        ticketId = meta.ticket_id;
      }
    } catch {
      // non-fatal
    }
    ticketId = ticketId ?? "UNKNOWN";
  }

  // Build batch
  const batch: FindingsBatch = {
    phase,
    round,
    ticketId,
    findings,
    specExcerpt: "",
  };

  // Write findings file
  const filePath = findingsPath(featureDir, phase, round);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(batch, null, 2));
  } catch (e) {
    console.error(`Error writing findings: ${e}`);
    process.exit(3);
  }

  // Emit the _QUESTIONS signal
  const repoRoot = getRepoRoot();
  try {
    execSync(
      `bun .collab/handlers/emit-question-signal.ts question "${filePath}"`,
      { stdio: "inherit", cwd: repoRoot },
    );
  } catch {
    console.error(`Warning: could not emit signal. Findings written to: ${filePath}`);
  }

  console.log(`[emit-findings] Written ${findings.length} finding(s) to: ${filePath}`);
  console.log(`[emit-findings] Phase: ${phase}, Round: ${round}, Ticket: ${ticketId}`);
}

if (import.meta.main) {
  main();
}

export { QuestionInput, toFinding };
