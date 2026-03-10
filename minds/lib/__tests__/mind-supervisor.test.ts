/**
 * mind-supervisor.test.ts — Tests for the main runMindSupervisor entry point.
 *
 * Most supervisor logic is tested in focused files:
 *   supervisor-state-machine.test.ts — state machine transitions
 *   supervisor-review.test.ts        — review prompt, verdict parsing, feedback
 *   supervisor-drone.test.ts         — drone Stop hook installation
 *   supervisor-bus-shape.test.ts     — bus event payload shape verification
 *
 * This file tests the orchestrator validation, pane tracking, and cleanup.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  SupervisorState,
  type SupervisorConfig,
  type SupervisorResult,
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

describe("allPaneIds tracking (Issue 10)", () => {
  test("result.allPaneIds is initialized as empty array", async () => {
    // maxIterations validation fires before any panes are spawned,
    // but for a valid config that fails at spawnDrone, allPaneIds should be empty
    const config = makeConfig({ maxIterations: 1 });

    // spawnDrone will fail because the paths are fake, but we can still
    // verify the result shape includes allPaneIds
    const result = await runMindSupervisor(config);

    expect(result.allPaneIds).toBeDefined();
    expect(Array.isArray(result.allPaneIds)).toBe(true);
    // With a failed spawnDrone, no panes were created
    expect(result.allPaneIds.length).toBe(0);
    expect(result.ok).toBe(false);
  });

  test("result always contains allPaneIds even on failure", async () => {
    const config = makeConfig();
    const result = await runMindSupervisor(config);

    // Regardless of success/failure, allPaneIds must be present
    expect(result).toHaveProperty("allPaneIds");
    expect(Array.isArray(result.allPaneIds)).toBe(true);
  });
});
