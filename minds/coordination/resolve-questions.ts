#!/usr/bin/env bun

/**
 * resolve-questions.ts — Deterministic CLI for gathering question context bundle.
 *
 * Reads a findings file (from a phase emitting _QUESTIONS), gathers all
 * relevant context (spec, constitution, prior resolutions, coordination.json,
 * LSP/grep results), and writes a context-bundle.json for the inference model.
 *
 * Usage:
 *   bun resolve-questions.ts <findings-file> [--output <path>]
 *
 * Output:
 *   context-bundle.json in the same directory as the findings file (default)
 *   or at the path specified by --output
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   2 = findings file not found or malformed
 *   3 = unable to gather context
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { execSync } from "child_process";

// TODO(WD): These should be requested via parent escalation once Pipeline Core is a Mind.
import type { FindingsBatch, ResolutionBatch } from "../pipeline_core/questions"; // CROSS-MIND
import { resolutionsPath } from "../pipeline_core/paths"; // CROSS-MIND
import { getRepoRoot } from "../pipeline_core/repo"; // CROSS-MIND
import { findFeatureDir } from "../pipeline_core/feature"; // CROSS-MIND
import { validateTicketIdArg } from "../pipeline_core/validation"; // CROSS-MIND

// ── Context bundle types ──────────────────────────────────────────────────────

interface ContextBundle {
  findings: FindingsBatch;
  context: {
    spec: string;
    constitution: string;
    priorResolutions: ResolutionBatch[];
    coordinationJson: Record<string, unknown> | null;
    codePatterns: string[];
  };
  /** Priority order for orchestrator reasoning */
  priorityHint: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeReadFile(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function safeReadJson(path: string): Record<string, unknown> | null {
  const raw = safeReadFile(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadPriorResolutions(featureDir: string, phase: string, currentRound: number): ResolutionBatch[] {
  const results: ResolutionBatch[] = [];
  const resDir = join(featureDir, "resolutions");
  if (!existsSync(resDir)) return results;

  for (let round = 1; round < currentRound; round++) {
    const path = resolutionsPath(featureDir, phase, round);
    const data = safeReadJson(path);
    if (data) results.push(data as ResolutionBatch);
  }

  return results;
}

function gatherCodePatterns(findings: FindingsBatch, repoRoot?: string): string[] {
  // 1. Collect patterns already discovered by the agent (from context.codePatterns when present)
  const patterns: string[] = [];
  for (const finding of findings.findings) {
    if (finding.context?.codePatterns) {
      patterns.push(...finding.context.codePatterns);
    }
  }

  // 2. Grep the codebase for key terms from finding questions and constraints
  //    to fill gaps the agent may have missed (AC6)
  if (repoRoot) {
    const searchTerms = new Set<string>();
    for (const finding of findings.findings) {
      // Extract meaningful words from questions (≥5 chars, skip common stop words)
      const stopWords = new Set(["should", "would", "could", "which", "where", "there", "their", "about", "after", "before"]);
      for (const word of finding.question.split(/\W+/)) {
        if (word.length >= 5 && !stopWords.has(word.toLowerCase())) {
          searchTerms.add(word);
        }
      }
      // Constraints tend to have precise technical terms
      for (const constraint of finding.context?.constraints ?? []) {
        for (const word of constraint.split(/\W+/)) {
          if (word.length >= 4) searchTerms.add(word);
        }
      }
    }

    // Run grep for each term, capture matching file:line context
    for (const term of [...searchTerms].slice(0, 10)) { // cap at 10 terms to avoid slow runs
      try {
        const result = execSync(
          `grep -r --include="*.ts" --include="*.js" --include="*.go" --include="*.py" -l "${term}" "${repoRoot}/src" 2>/dev/null || true`,
          { encoding: "utf-8", timeout: 5000 },
        ).trim();
        for (const file of result.split("\n").filter(Boolean).slice(0, 3)) {
          const rel = file.replace(repoRoot + "/", "");
          patterns.push(`${rel} contains "${term}"`);
        }
      } catch {
        // grep failure is non-fatal — continue with what we have
      }
    }
  }

  return [...new Set(patterns)]; // deduplicate
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "resolve-questions.ts");

  if (args.length < 1) {
    console.error("Usage: resolve-questions.ts <findings-file> [--output <path>]");
    process.exit(1);
  }

  const findingsFile = args[0];
  let outputPath: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  if (!existsSync(findingsFile)) {
    console.error(`Error: findings file not found: ${findingsFile}`);
    process.exit(2);
  }

  let findings: FindingsBatch;
  try {
    findings = JSON.parse(readFileSync(findingsFile, "utf-8")) as FindingsBatch;
  } catch (e) {
    console.error(`Error: malformed findings file: ${e}`);
    process.exit(2);
  }

  const repoRoot = getRepoRoot();
  const featureDir = findFeatureDir(repoRoot, findings.ticketId);

  // 1. Load spec
  const spec = featureDir ? safeReadFile(join(featureDir, "spec.md")) : "";

  // 2. Load constitution / architecture doc
  const constitution = safeReadFile(join(repoRoot, ".collab/memory/constitution.md"));
  const archDoc = safeReadFile(join(repoRoot, ".collab/memory/architecture.md"));
  const constitutionText = [constitution, archDoc].filter(Boolean).join("\n\n---\n\n");

  // 3. Load prior resolutions (earlier rounds of same phase)
  const priorResolutions = featureDir
    ? loadPriorResolutions(featureDir, findings.phase, findings.round)
    : [];

  // 4. Load coordination.json
  const coordinationPath = featureDir
    ? join(featureDir, "coordination.json")
    : null;
  const coordinationJson = coordinationPath ? safeReadJson(coordinationPath) : null;

  // 5. Gather code patterns: agent-provided + grep-based codebase discovery (AC6)
  const codePatterns = gatherCodePatterns(findings, repoRoot);

  // Bundle assembly
  const bundle: ContextBundle = {
    findings,
    context: {
      spec,
      constitution: constitutionText,
      priorResolutions,
      coordinationJson,
      codePatterns,
    },
    priorityHint: [
      "1. spec + ticket description (stated requirements, acceptance criteria)",
      "2. constitution / architecture doc (project-level principles and constraints)",
      "3. previous phase resolutions (decisions already made in this pipeline run)",
      "4. codebase patterns (how the project already does things)",
      "5. agent-provided context (what the agent discovered during its analysis)",
      "6. coordination / dependency context (coordination.json, related tickets)",
    ],
  };

  const outPath = outputPath ?? join(dirname(findingsFile), "context-bundle.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(bundle, null, 2));

  console.log(`[resolve-questions] Context bundle written to: ${outPath}`);
  console.log(`[resolve-questions] Findings: ${findings.findings.length} questions`);
  console.log(`[resolve-questions] Prior resolutions: ${priorResolutions.length} rounds`);
}

if (import.meta.main) {
  main();
}

export { ContextBundle };
