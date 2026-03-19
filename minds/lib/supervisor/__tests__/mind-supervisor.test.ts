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
import { runMindSupervisor } from "../mind-supervisor.ts";
import {
  SupervisorState,
  type SupervisorConfig,
  type SupervisorResult,
} from "../supervisor-types.ts";
import { makeTestConfig } from "./test-helpers.ts";

const makeConfig = makeTestConfig;

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

describe("allDroneHandles tracking (Issue 10)", () => {
  test("result.allDroneHandles is initialized as empty array", async () => {
    // maxIterations validation fires before any drones are spawned,
    // but for a valid config that fails at spawnDrone, allDroneHandles should be empty
    const config = makeConfig({ maxIterations: 1 });

    // spawnDrone will fail because the paths are fake, but we can still
    // verify the result shape includes allDroneHandles
    const result = await runMindSupervisor(config);

    expect(result.allDroneHandles).toBeDefined();
    expect(Array.isArray(result.allDroneHandles)).toBe(true);
    // With a failed spawnDrone, no drones were created
    expect(result.allDroneHandles.length).toBe(0);
    expect(result.ok).toBe(false);
  });

  test("result always contains allDroneHandles even on failure", async () => {
    const config = makeConfig();
    const result = await runMindSupervisor(config);

    // Regardless of success/failure, allDroneHandles must be present
    expect(result).toHaveProperty("allDroneHandles");
    expect(Array.isArray(result.allDroneHandles)).toBe(true);
  });
});
