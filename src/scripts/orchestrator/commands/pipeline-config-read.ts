#!/usr/bin/env bun

/**
 * pipeline-config-read.ts - Read pipeline config from pipeline.json
 *
 * Outputs KEY=VALUE lines for settings, with sensible defaults
 * when fields are absent. Replaces fragile jq one-liners in collab.run.md.
 *
 * Usage:
 *   bun commands/pipeline-config-read.ts codereview [--phase <phase-name>]
 *   bun commands/pipeline-config-read.ts interactive [--phase <phase-name>]
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
 *   3 = pipeline.json not found or malformed
 */

import { getRepoRoot, readJsonFile } from "../orchestrator-utils";

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error("Usage: pipeline-config-read.ts <command> [options]");
    console.error("  codereview [--phase <phase-name>]");
    console.error("  interactive [--phase <phase-name>]");
    process.exit(1);
  }

  const command = args[0];

  if (command !== "codereview" && command !== "interactive") {
    console.error(`Unknown command: ${command}. Supported: codereview, interactive`);
    process.exit(1);
  }

  // Parse --phase flag
  let phaseName: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--phase" && args[i + 1]) {
      phaseName = args[++i];
    }
  }

  const repoRoot = getRepoRoot();
  const configPath = `${repoRoot}/.collab/config/pipeline.json`;
  const pipeline = readJsonFile(configPath);

  if (pipeline === null) {
    console.error(`Error: pipeline.json not found: ${configPath}`);
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

    // Global interactive setting with default (true — interactive by default)
    const interactiveEnabled = ia.enabled !== false ? "true" : "false";

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
