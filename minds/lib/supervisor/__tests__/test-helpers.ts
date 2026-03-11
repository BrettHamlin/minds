/**
 * test-helpers.ts — Shared test fixtures for supervisor test files.
 *
 * Centralizes makeTestConfig and makeTestTmpDir so they are not duplicated
 * across mind-supervisor.test.ts, supervisor-state-machine.test.ts, and
 * mind-supervisor-integration.test.ts.
 */

import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { SupervisorConfig } from "../supervisor-types.ts";

/**
 * Create a SupervisorConfig with sensible defaults for tests.
 * Use the `overrides` parameter to customize individual fields.
 */
export function makeTestConfig(overrides?: Partial<SupervisorConfig>): SupervisorConfig {
  return {
    mindName: "transport",
    ticketId: "BRE-500",
    waveId: "wave-1",
    tasks: [
      { id: "T001", mind: "transport", description: "Implement SSE endpoint", parallel: false },
    ],
    repoRoot: overrides?.repoRoot ?? "/tmp/test-repo",
    busUrl: "http://localhost:7777",
    busPort: 7777,
    channel: "minds-BRE-500",
    worktreePath: overrides?.worktreePath ?? "/tmp/test-worktree",
    baseBranch: "dev",
    callerPane: "%0",
    mindsSourceDir: overrides?.mindsSourceDir ?? "/tmp/test-repo/minds",
    featureDir: overrides?.featureDir ?? "/tmp/test-repo/specs/BRE-500-feature",
    dependencies: [],
    maxIterations: 3,
    droneTimeoutMs: 20 * 60 * 1000,
    ...overrides,
  };
}

/**
 * Create a unique temporary directory for test isolation.
 * The directory is created immediately and the path is returned.
 */
export function makeTestTmpDir(prefix: string = "supervisor-test"): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
