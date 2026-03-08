#!/usr/bin/env bun

/**
 * resolve-execution-mode.ts — Determine execution mode for a pipeline phase.
 *
 * Ticket ID is REQUIRED — the script reads the registry to check autonomous mode
 * and resolves the correct pipeline variant config automatically.
 *
 * Usage:
 *   bun resolve-execution-mode.ts <TICKET_ID> [--phase <phase-name>]
 *
 * Output JSON to stdout:
 *   { "interactive": bool, "autonomous": bool, "phase": string }
 *
 * autonomous=true  → pipeline orchestrator launched this phase (registry active)
 * autonomous=false → manual (standalone) invocation; user is present
 *
 * interactive=true  → use AskUserQuestion for findings
 * interactive=false → use non-interactive batch protocol (emit findings signal)
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 */

import { getRepoRoot, readJsonFile, validateTicketIdArg, loadPipelineForTicket } from "../lib/pipeline";
import { registryPath } from "../lib/pipeline/paths";
import { resolveMode } from "../lib/pipeline/questions";

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "resolve-execution-mode.ts");

  if (args.length < 1) {
    console.error("Usage: resolve-execution-mode.ts <TICKET_ID> [--phase <phase-name>]");
    process.exit(1);
  }

  const ticketId = args[0];

  // Parse --phase flag
  let phaseName: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--phase" && args[i + 1]) {
      phaseName = args[++i];
    }
  }

  const repoRoot = getRepoRoot();
  const regPath = registryPath(repoRoot, ticketId);
  const registry = readJsonFile(regPath);

  // Determine autonomous: registry exists and current_step matches phase (if provided)
  let autonomous = false;
  if (registry !== null) {
    if (phaseName) {
      // Match the clarify.md / spec-critique.md logic: current_step contains phase name
      const currentStep = registry.current_step as string | undefined;
      autonomous = typeof currentStep === "string" && currentStep.includes(phaseName);
    } else {
      // No phase specified: autonomous if registry exists
      autonomous = true;
    }
  }

  let interactive: boolean;

  if (!autonomous) {
    // Manual (non-orchestrated) run: always interactive — user is present
    interactive = true;
  } else {
    // Orchestrated run: check pipeline config.
    // Default: non-interactive (absence of interactive field = batch mode for orchestrated pipelines).
    let configPath: string | undefined;
    try {
      const loaded = loadPipelineForTicket(repoRoot, ticketId);
      configPath = loaded.configPath;
    } catch {
      // No pipeline config → non-interactive for autonomous pipelines
      const output = { interactive: false, autonomous, phase: phaseName ?? "" };
      console.log(JSON.stringify(output));
      return;
    }

    // Use resolveMode() with defaultMode="non-interactive" so absent field → batch protocol.
    // Per-phase overrides in pipeline.json still take precedence via resolveMode().
    const mode = resolveMode({
      pipelineConfigPath: configPath,
      phase: phaseName,
      defaultMode: "non-interactive",
    });
    interactive = mode === "interactive";
  }

  const output = { interactive, autonomous, phase: phaseName ?? "" };
  console.log(JSON.stringify(output));
}

if (import.meta.main) {
  main();
}
