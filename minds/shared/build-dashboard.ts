/**
 * build-dashboard.ts — Ensure the dashboard SPA is built.
 *
 * Shared by the installer (minds init) and the implement CLI.
 * Runs `bun install` + `bun run build.ts` if dist/index.html is missing.
 */

import { existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

export interface DashboardBuildResult {
  success: boolean;
  skipped: boolean;
  error?: string;
}

/**
 * Build the dashboard SPA if dist/index.html doesn't exist.
 * @param mindsDir - Absolute path to the minds (or .minds) directory.
 * @param quiet - Suppress stdout from build commands.
 */
export function ensureDashboardBuilt(mindsDir: string, quiet = false): DashboardBuildResult {
  const dashboardDir = join(mindsDir, "dashboard");
  const packageJson = join(dashboardDir, "package.json");
  const indexHtml = join(dashboardDir, "dist", "index.html");

  if (!existsSync(packageJson)) {
    return { success: true, skipped: true };
  }

  if (existsSync(indexHtml)) {
    return { success: true, skipped: true };
  }

  const stdio = quiet ? "ignore" as const : "inherit" as const;

  const installProc = spawnSync("bun", ["install"], {
    cwd: dashboardDir,
    stdout: stdio,
    stderr: "inherit",
  });
  if (installProc.status !== 0) {
    return { success: false, skipped: false, error: "bun install failed" };
  }

  const buildProc = spawnSync("bun", ["run", "build.ts"], {
    cwd: dashboardDir,
    stdout: stdio,
    stderr: "inherit",
  });
  if (buildProc.status !== 0) {
    return { success: false, skipped: false, error: "bun run build.ts failed" };
  }

  return { success: true, skipped: false };
}
