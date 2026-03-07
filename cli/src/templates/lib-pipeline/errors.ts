/**
 * errors.ts - Shared error types for orchestrator commands
 *
 * OrchestratorError provides consistent error codes and exit code mapping
 * across all orchestrator TypeScript commands.
 *
 * Error codes map to process exit codes:
 *   USAGE         → exit 1 (missing/invalid arguments)
 *   VALIDATION    → exit 2 (invalid phase, nonce mismatch, constraint violation)
 *   FILE_NOT_FOUND→ exit 3 (registry, pipeline.json, or other file missing)
 *   DISPATCH_TIMEOUT → exit 0 (warning only; dispatch succeeded but receipt unconfirmed)
 *   HOLD          → exit 0 (ticket intentionally held for dependency)
 */

export type OrchestratorErrorCode =
  | "USAGE"
  | "VALIDATION"
  | "FILE_NOT_FOUND"
  | "DISPATCH_TIMEOUT"
  | "HOLD";

export class OrchestratorError extends Error {
  constructor(
    public readonly code: OrchestratorErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OrchestratorError";
  }

  /** Map error code to process exit code */
  get exitCode(): number {
    switch (this.code) {
      case "USAGE":
        return 1;
      case "VALIDATION":
        return 2;
      case "FILE_NOT_FOUND":
        return 3;
      case "DISPATCH_TIMEOUT":
      case "HOLD":
        return 0;
    }
  }
}

/** Handle an OrchestratorError or unexpected error at the CLI boundary */
export function handleError(err: unknown): never {
  if (err instanceof OrchestratorError) {
    console.error(`Error: ${err.message}`);
    process.exit(err.exitCode);
  }
  console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
