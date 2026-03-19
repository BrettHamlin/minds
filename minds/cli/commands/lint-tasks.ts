import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseTasks, lintTasks } from "../../lib/contracts.ts";
import { getRepoRoot, resolveMindsDir } from "../../shared/paths.js";
import { loadWorkspace } from "../../shared/workspace-loader.ts";
import { loadMultiRepoRegistries } from "../../shared/registry-loader.ts";
import type { MindDescription } from "../../mind.ts";

export interface LintTasksOptions {
  json?: boolean; // output machine-readable JSON
}

/**
 * `minds lint <tasks-path>` — Lint a tasks.md file against the Mind registry.
 *
 * Exits 0 if no errors (warnings are printed but non-fatal).
 * Exits 1 if errors are found.
 *
 * With --json: outputs { valid, errors, warnings } to stdout.
 */
export async function runLintTasks(
  tasksPath: string,
  options: LintTasksOptions = {},
): Promise<void> {
  const repoRoot = getRepoRoot();
  const workspace = loadWorkspace(repoRoot);
  const orchestratorRoot = workspace.orchestratorRoot;
  const mindsDir = resolveMindsDir(orchestratorRoot);

  // Resolve tasks path (absolute or relative to cwd)
  const resolvedTasksPath = tasksPath.startsWith("/")
    ? tasksPath
    : join(process.cwd(), tasksPath);

  if (!existsSync(resolvedTasksPath)) {
    if (options.json) {
      console.log(JSON.stringify({ valid: false, errors: [{ type: "file_not_found", task: "", message: `tasks.md not found: ${resolvedTasksPath}` }], warnings: [] }));
    } else {
      console.error(`Error: tasks.md not found: ${resolvedTasksPath}`);
    }
    process.exit(1);
  }

  // Load registry
  let registry: MindDescription[];
  if (workspace.isMultiRepo) {
    registry = loadMultiRepoRegistries(workspace.repoPaths);
  } else {
    const mindsJsonPath = join(mindsDir, "minds.json");
    if (!existsSync(mindsJsonPath)) {
      if (options.json) {
        console.log(JSON.stringify({ valid: false, errors: [{ type: "registry_not_found", task: "", message: `minds.json not found at ${mindsJsonPath}` }], warnings: [] }));
      } else {
        console.error(`Error: minds.json not found at ${mindsJsonPath}`);
      }
      process.exit(1);
    }
    registry = JSON.parse(readFileSync(mindsJsonPath, "utf-8")) as MindDescription[];
  }

  const lintWorkspace = workspace.isMultiRepo
    ? { repoAliases: [...workspace.repoPaths.keys()] }
    : undefined;

  const tasksContent = readFileSync(resolvedTasksPath, "utf-8");
  const parsedTasks = parseTasks(tasksContent);
  const result = lintTasks(parsedTasks, registry as any, lintWorkspace);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
    return;
  }

  // Human-readable output
  if (result.errors.length > 0) {
    console.error(`\nTask lint errors (${result.errors.length}):`);
    for (const err of result.errors) {
      console.error(`  [${err.type}] ${err.task}: ${err.message}`);
    }
  }
  if (result.warnings.length > 0) {
    console.warn(`\nTask lint warnings (${result.warnings.length}):`);
    for (const warn of result.warnings) {
      console.warn(`  [${warn.type}] ${warn.task}: ${warn.message}`);
    }
  }
  if (result.valid) {
    console.log(`\n✓ tasks.md is valid (${parsedTasks.length} tasks, ${result.warnings.length} warnings)`);
  } else {
    console.error(`\n✗ tasks.md has ${result.errors.length} error(s). Fix before implementing.`);
  }

  process.exit(result.valid ? 0 : 1);
}
