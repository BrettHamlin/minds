/**
 * collab pipeline validate — validate pipeline.json against 12-point checklist
 *
 * Checks (in order):
 *  1. pipeline.json exists
 *  2. Valid JSON
 *  3. Required fields present (name, version, type, description)
 *  4. type is "pipeline" or "pack"
 *  5. version is valid semver
 *  6. name is kebab-case
 *  7. (pipeline) commands[] is non-empty array of strings
 *  8. (pipeline) every commands[] file exists in commands/ subdir
 *  9. (pipeline) no extra .md files in commands/ not in commands[]   [WARN]
 * 10. (pack) pipelines is non-empty object with string values
 * 11. (pack) commands is absent or empty
 * 12. (both) clis values are valid semver ranges
 *
 * Exit code: 0 when valid (warnings OK), 1 on any error.
 * Pure validation function exported for testability.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tryParse } from "../../lib/semver.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckResult {
  check: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface ValidationResult {
  /** true when there are zero errors (warnings are OK) */
  valid: boolean;
  checks: CheckResult[];
  warnings: number;
  errors: number;
}

export interface ValidateOptions {
  /** Directory containing pipeline.json (default: ".") */
  path?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Returns true when the string looks like a valid semver range.
 * Supports: *, "", exact versions, and prefix operators >=, <=, >, <, ^, ~, =.
 * Also accepts X.Y shorthand (normalised to X.Y.0).
 */
function isValidSemverRange(range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;

  let versionPart = trimmed;
  for (const op of [">=", "<=", ">", "<", "~", "^", "="]) {
    if (trimmed.startsWith(op)) {
      versionPart = trimmed.slice(op.length).trim();
      break;
    }
  }

  return tryParse(normalizeVersionPart(versionPart)) !== null;
}

function normalizeVersionPart(v: string): string {
  const stripped = v.replace(/^v/, "");
  const mainPart = stripped.split("+")[0].split("-")[0];
  const parts = mainPart.split(".");
  if (parts.length === 2) return `${stripped}.0`;
  if (parts.length === 1 && /^\d+$/.test(parts[0])) return `${stripped}.0.0`;
  return stripped;
}

function buildResult(checks: CheckResult[]): ValidationResult {
  const errors = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  return { valid: errors === 0, checks, warnings, errors };
}

// ─── Core validation ──────────────────────────────────────────────────────────

/**
 * Validate a pipeline directory's pipeline.json against all 12 checks.
 * Returns a structured ValidationResult — does NOT call process.exit().
 */
export function validateManifest(dirPath: string): ValidationResult {
  const checks: CheckResult[] = [];
  const filePath = join(dirPath, "pipeline.json");

  // Check 1: pipeline.json exists
  if (!existsSync(filePath)) {
    checks.push({
      check: "pipeline.json exists",
      status: "fail",
      message: `pipeline.json not found at ${filePath}`,
    });
    return buildResult(checks);
  }
  checks.push({
    check: "pipeline.json exists",
    status: "pass",
    message: "pipeline.json found",
  });

  // Check 2: valid JSON
  let obj: Record<string, unknown>;
  try {
    const raw = readFileSync(filePath, "utf8");
    obj = JSON.parse(raw) as Record<string, unknown>;
    checks.push({ check: "Valid JSON", status: "pass", message: "Valid JSON" });
  } catch (err) {
    checks.push({
      check: "Valid JSON",
      status: "fail",
      message: `Invalid JSON: ${err}`,
    });
    return buildResult(checks);
  }

  // Check 3: required fields
  const requiredFields = ["name", "version", "type", "description"];
  let missingAny = false;
  for (const field of requiredFields) {
    if (typeof obj[field] !== "string") {
      checks.push({
        check: "Required fields",
        status: "fail",
        message: `missing field: ${field}`,
      });
      missingAny = true;
    }
  }
  if (missingAny) return buildResult(checks);
  checks.push({
    check: "Required fields",
    status: "pass",
    message: "Required fields present",
  });

  const name = obj.name as string;
  const version = obj.version as string;
  const type = obj.type as string;

  // Check 4: type value
  if (type !== "pipeline" && type !== "pack") {
    checks.push({
      check: "Type",
      status: "fail",
      message: `type must be pipeline or pack, got "${type}"`,
    });
    return buildResult(checks);
  }
  checks.push({ check: "Type", status: "pass", message: `Type: ${type}` });

  // Check 5: version is valid semver
  if (!tryParse(version)) {
    checks.push({
      check: "Version",
      status: "fail",
      message: `version "${version}" is not valid semver`,
    });
  } else {
    checks.push({
      check: "Version",
      status: "pass",
      message: `Version: ${version} (valid semver)`,
    });
  }

  // Check 6: name is kebab-case
  if (!KEBAB_CASE_RE.test(name)) {
    checks.push({
      check: "Name",
      status: "fail",
      message: `name "${name}" is not valid kebab-case`,
    });
  } else {
    checks.push({
      check: "Name",
      status: "pass",
      message: `Name: ${name} (valid kebab-case)`,
    });
  }

  if (type === "pipeline") {
    const commands = obj.commands;

    // Check 7: commands[] is an array of strings (empty = warn; missing/wrong type = fail)
    if (!Array.isArray(commands)) {
      checks.push({
        check: "Commands",
        status: "fail",
        message: "commands[] must be an array of strings",
      });
    } else if ((commands as unknown[]).length === 0) {
      checks.push({
        check: "Commands",
        status: "warn",
        message: "commands[] is empty — no command files declared",
      });
    } else if (!(commands as unknown[]).every((c) => typeof c === "string")) {
      checks.push({
        check: "Commands",
        status: "fail",
        message: "all commands[] entries must be strings",
      });
    } else {
      const cmdList = commands as string[];
      checks.push({
        check: "Commands",
        status: "pass",
        message: `Commands: ${cmdList.length} declared`,
      });

      const commandsDir = join(dirPath, "commands");

      // Check 8: every commands[] file exists in commands/ subdir
      const missingFiles = cmdList.filter(
        (f) => !existsSync(join(commandsDir, f))
      );
      if (missingFiles.length > 0) {
        for (const f of missingFiles) {
          checks.push({
            check: "Command files",
            status: "fail",
            message: `command file not found: commands/${f}`,
          });
        }
      } else {
        checks.push({
          check: "Command files",
          status: "pass",
          message: `${cmdList.length} command file(s) found on disk`,
        });

        // Check 9: no extra .md files in commands/ not in commands[]
        if (existsSync(commandsDir)) {
          const onDisk = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
          const declared = new Set(cmdList);
          for (const f of onDisk) {
            if (!declared.has(f)) {
              checks.push({
                check: "Extra command files",
                status: "warn",
                message: `Extra file in commands/: ${f} (not in commands[])`,
              });
            }
          }
        }
      }
    }
  } else {
    // type === "pack"

    // Check 10: pipelines is non-empty object with string values
    const pipelines = obj.pipelines;
    if (
      typeof pipelines !== "object" ||
      pipelines === null ||
      Array.isArray(pipelines)
    ) {
      checks.push({
        check: "Pipelines",
        status: "fail",
        message: "pipelines must be a non-empty object with string values (semver ranges)",
      });
    } else {
      const entries = Object.entries(pipelines as Record<string, unknown>);
      if (entries.length === 0) {
        checks.push({
          check: "Pipelines",
          status: "fail",
          message: "pipelines must be a non-empty object",
        });
      } else if (!entries.every(([, v]) => typeof v === "string")) {
        checks.push({
          check: "Pipelines",
          status: "fail",
          message: "all pipelines values must be strings (semver ranges)",
        });
      } else {
        checks.push({
          check: "Pipelines",
          status: "pass",
          message: `${entries.length} pipeline(s) in pack`,
        });
      }
    }

    // Check 11: commands is absent or empty
    const commands = obj.commands;
    if (
      commands !== undefined &&
      commands !== null &&
      Array.isArray(commands) &&
      (commands as unknown[]).length > 0
    ) {
      checks.push({
        check: "Pack commands",
        status: "fail",
        message: "pack manifests must not have commands[]",
      });
    }
  }

  // Check 12: clis values are valid semver ranges
  if (obj.clis !== undefined && obj.clis !== null) {
    if (typeof obj.clis !== "object" || Array.isArray(obj.clis)) {
      checks.push({
        check: "CLI deps",
        status: "fail",
        message: "clis must be an object mapping CLI name to semver range",
      });
    } else {
      for (const [cliName, rangeVal] of Object.entries(
        obj.clis as Record<string, unknown>
      )) {
        if (typeof rangeVal !== "string") {
          checks.push({
            check: "CLI deps",
            status: "fail",
            message: `clis.${cliName} must be a string semver range`,
          });
        } else if (!isValidSemverRange(rangeVal)) {
          checks.push({
            check: "CLI deps",
            status: "fail",
            message: `clis.${cliName}: "${rangeVal}" is not a valid semver range`,
          });
        } else {
          checks.push({
            check: "CLI deps",
            status: "pass",
            message: `${cliName} ${rangeVal} (valid range)`,
          });
        }
      }
    }
  }

  return buildResult(checks);
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

/**
 * CLI entry point: prints check results and exits appropriately.
 */
export async function validate(options: ValidateOptions = {}): Promise<void> {
  // Accept either a directory path or a direct path to pipeline.json
  let dir = options.path ?? ".";
  if (dir.endsWith(".json")) {
    dir = dirname(dir);
  }
  const filePath = join(dir, "pipeline.json");

  console.log(`Validating: ${filePath}`);
  console.log();

  const result = validateManifest(dir);

  for (const check of result.checks) {
    const icon =
      check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    console.log(`${icon} ${check.message}`);
  }

  console.log();
  const w = result.warnings;
  const e = result.errors;
  console.log(
    `Result: ${w} warning${w !== 1 ? "s" : ""}, ${e} error${e !== 1 ? "s" : ""}`
  );

  if (!result.valid) {
    process.exit(1);
  }
}
