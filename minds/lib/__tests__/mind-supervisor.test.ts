/**
 * mind-supervisor.test.ts — Tests for the main runMindSupervisor entry point.
 *
 * Most supervisor logic is tested in focused files:
 *   supervisor-state-machine.test.ts — state machine transitions
 *   supervisor-review.test.ts        — review prompt, verdict parsing, feedback
 *   supervisor-drone.test.ts         — drone Stop hook installation
 *   supervisor-bus-shape.test.ts     — bus event payload shape verification
 *
 * This file tests the orchestrator validation and integration.
 */

import { describe, test, expect } from "bun:test";
import {
  SupervisorState,
  type SupervisorConfig,
  runMindSupervisor,
} from "../mind-supervisor.ts";

function makeConfig(overrides?: Partial<SupervisorConfig>): SupervisorConfig {
  return {
    mindName: "transport",
    ticketId: "BRE-500",
    waveId: "wave-1",
    tasks: [
      { id: "T001", mind: "transport", description: "Implement SSE endpoint", parallel: false },
    ],
    repoRoot: "/tmp/test-repo",
    busUrl: "http://localhost:7777",
    busPort: 7777,
    channel: "minds-BRE-500",
    worktreePath: "/tmp/test-worktree",
    baseBranch: "dev",
    callerPane: "%0",
    mindsSourceDir: "/tmp/test-repo/minds",
    featureDir: "/tmp/test-repo/specs/BRE-500-feature",
    dependencies: [],
    maxIterations: 3,
    droneTimeoutMs: 20 * 60 * 1000,
    ...overrides,
  };
}

describe("runMindSupervisor validation", () => {
  test("throws when maxIterations is 0", async () => {
    const config = makeConfig({ maxIterations: 0 });
    await expect(runMindSupervisor(config)).rejects.toThrow(/maxIterations must be >= 1/);
  });

  test("throws when maxIterations is negative", async () => {
    const config = makeConfig({ maxIterations: -1 });
    await expect(runMindSupervisor(config)).rejects.toThrow(/maxIterations must be >= 1/);
  });
});
