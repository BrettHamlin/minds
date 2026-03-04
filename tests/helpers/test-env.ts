/**
 * Test environment helper — creates an isolated temp project directory for each test.
 *
 * Usage:
 *   const env = await createTestEnv();
 *   // ... run tests using env.statePath, env.lockPath, etc.
 *   await env.cleanup();
 */

import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface TestEnv {
  /** Isolated temp directory with scaffolded .collab/ and .claude/ structure */
  projectRoot: string;
  /** Absolute path to installed-pipelines.json */
  statePath: string;
  /** Absolute path to pipeline-lock.json */
  lockPath: string;
  /** Absolute path to .collab/pipelines/ (tarball cache dir) */
  installDir: string;
  /** Absolute path to .claude/commands/ (command files destination) */
  commandsDir: string;
  /** Absolute path to .collab/handlers/ (handler files destination) */
  handlersDir: string;
  /** Absolute path to .collab/scripts/ (executor files destination) */
  executorsDir: string;
  /** Remove the temp directory — call in afterEach */
  cleanup: () => Promise<void>;
}

/**
 * Creates a temporary isolated project directory for each test.
 * Scaffolds the .collab/state/, .collab/pipelines/, and .claude/commands/ dirs.
 */
export async function createTestEnv(): Promise<TestEnv> {
  const projectRoot = mkdtempSync(join(tmpdir(), "collab-test-"));
  const statePath = join(projectRoot, ".collab", "state", "installed-pipelines.json");
  const lockPath = join(projectRoot, "pipeline-lock.json");
  const installDir = join(projectRoot, ".collab", "pipelines");
  const commandsDir = join(projectRoot, ".claude", "commands");
  const handlersDir = join(projectRoot, ".collab", "handlers");
  const executorsDir = join(projectRoot, ".collab", "scripts");

  mkdirSync(join(projectRoot, ".collab", "state"), { recursive: true });
  mkdirSync(installDir, { recursive: true });
  mkdirSync(commandsDir, { recursive: true });
  mkdirSync(handlersDir, { recursive: true });
  mkdirSync(executorsDir, { recursive: true });

  return {
    projectRoot,
    statePath,
    lockPath,
    installDir,
    commandsDir,
    handlersDir,
    executorsDir,
    cleanup: async () => {
      try {
        rmSync(projectRoot, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    },
  };
}
