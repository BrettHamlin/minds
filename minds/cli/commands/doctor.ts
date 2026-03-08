// CROSS-MIND: imports from installer Mind — consumed per BRE-433 interface contract
import {
  runDoctorChecks,
  type DoctorCheck,
  type DoctorResult,
} from "../../installer/core";

export interface DoctorOptions {
  /** Override repo root (defaults to process.cwd()) */
  repoRoot?: string;
  /** Output JSON instead of human-readable table */
  json?: boolean;
}

/**
 * Run installation health checks against repoRoot and print results.
 * Human-readable table by default; JSON when json=true.
 * Exits with code 1 when any check fails.
 */
export function doctorCommand(options: DoctorOptions = {}): void {
  const repoRoot = options.repoRoot ?? process.cwd();
  const result: DoctorResult = runDoctorChecks(repoRoot);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exit(1);
    return;
  }

  // Human-readable table
  for (const check of result.checks) {
    const icon = check.pass ? "✓" : "✗";
    console.log(`  ${icon}  ${check.message}`);
  }

  console.log("");

  const total = result.checks.length;
  const failed = result.checks.filter((c: DoctorCheck) => !c.pass).length;

  if (result.pass) {
    console.log(`All ${total} check(s) passed.`);
  } else {
    console.error(`${failed}/${total} check(s) failed.`);
    process.exit(1);
  }
}

export function printDoctorHelp(): void {
  console.log(`Usage: collab doctor [--json] [--path <dir>]

Check installation health for a collab-enabled repository.

Options:
  --json          Output results as JSON
  --path <dir>    Path to repo root (default: current directory)
  --help, -h      Show this help`);
}
