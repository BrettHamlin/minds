#!/usr/bin/env bun

/**
 * pipeline-config-read.ts - Read pipeline config settings
 *
 * Ticket ID is REQUIRED — the script reads the registry to resolve the
 * correct pipeline variant config automatically.
 *
 * Usage:
 *   bun pipeline-config-read.ts <TICKET_ID> codereview [--phase <phase-name>]
 *   bun pipeline-config-read.ts <TICKET_ID> interactive [--phase <phase-name>]
 *
 * codereview output (stdout, one per line):
 *   CR_ENABLED=true
 *   CR_MODEL=claude-opus-4-6
 *   CR_MAX=3
 *   CR_FILE=
 *   PHASE_CR=inherit
 *
 * interactive output (stdout, one per line):
 *   INTERACTIVE_ENABLED=true
 *   PHASE_INTERACTIVE=inherit
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   3 = pipeline config not found or malformed
 */

import { getRepoRoot, loadPipelineForTicket, validateTicketIdArg } from "../orchestrator-utils";

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "pipeline-config-read.ts");

  if (args.length < 2) {
    console.error("Usage: pipeline-config-read.ts <TICKET_ID> <command> [options]");
    console.error("  <TICKET_ID> codereview [--phase <phase-name>]");
    console.error("  <TICKET_ID> interactive [--phase <phase-name>]");
    process.exit(1);
  }

  const ticketId = args[0];
  const command = args[1];

  if (command !== "codereview" && command !== "interactive") {
    console.error(`Unknown command: ${command}. Supported: codereview, interactive`);
    process.exit(1);
  }

  // Parse --phase flag
  let phaseName: string | undefined;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--phase" && args[i + 1]) {
      phaseName = args[++i];
    }
  }

  const repoRoot = getRepoRoot();
  let pipeline: any;
  try {
    ({ pipeline } = loadPipelineForTicket(repoRoot, ticketId));
  } catch {
    console.error(`Error: pipeline config not found for ticket ${ticketId}`);
    process.exit(3);
  }

  if (command === "codereview") {
    const cr = (pipeline.codeReview as Record<string, any>) ?? {};

    // Global code review settings with defaults
    const crEnabled = cr.enabled !== false ? "true" : "false";
    const crModel = (cr.model as string) ?? "claude-opus-4-6";
    const crMax = (cr.maxAttempts as number) ?? 3;
    const crFile = (cr.file as string) ?? "";

    // Per-phase override (if --phase supplied)
    let phaseCr = "inherit";
    if (phaseName) {
      const phases = (pipeline.phases as Record<string, any>) ?? {};
      const phase = (phases[phaseName] as Record<string, any>) ?? {};
      const phaseCodeReview = (phase.codeReview as Record<string, any>) ?? {};
      if (phaseCodeReview.enabled === false) {
        phaseCr = "false";
      } else if (phaseCodeReview.enabled === true) {
        phaseCr = "true";
      }
      // else stays "inherit"
    }

    console.log(`CR_ENABLED=${crEnabled}`);
    console.log(`CR_MODEL=${crModel}`);
    console.log(`CR_MAX=${crMax}`);
    console.log(`CR_FILE=${crFile}`);
    console.log(`PHASE_CR=${phaseCr}`);
  } else if (command === "interactive") {
    const ia = (pipeline.interactive as Record<string, any>) ?? {};

    // Global interactive setting with default (false — non-interactive by default).
    // When the `interactive` field is absent from pipeline.json, orchestrated
    // pipelines use the non-interactive batch protocol (step 8a in clarify).
    const interactiveEnabled = ia.enabled === true ? "true" : "false";

    // Per-phase override (if --phase supplied)
    let phaseInteractive = "inherit";
    if (phaseName) {
      const phases = (pipeline.phases as Record<string, any>) ?? {};
      const phase = (phases[phaseName] as Record<string, any>) ?? {};
      const phaseIa = (phase.interactive as Record<string, any>) ?? {};
      if (phaseIa.enabled === false) {
        phaseInteractive = "false";
      } else if (phaseIa.enabled === true) {
        phaseInteractive = "true";
      }
      // else stays "inherit"
    }

    console.log(`INTERACTIVE_ENABLED=${interactiveEnabled}`);
    console.log(`PHASE_INTERACTIVE=${phaseInteractive}`);
  }
}

if (import.meta.main) {
  main();
}
