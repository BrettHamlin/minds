/**
 * E2E tests for src/scripts/orchestrator/commands/resolve-tickets.ts
 *
 * Spawns the CLI as a real subprocess. The CLI is a pure argument classifier —
 * no Linear API calls, no environment variables needed.
 */

import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const SCRIPT = join(
  import.meta.dir,
  "../../minds/coordination/resolve-tickets.ts"
);

async function run(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode: exitCode ?? 1 };
}

// ---------------------------------------------------------------------------
// No args → usage error, exit 1
// ---------------------------------------------------------------------------

describe("no arguments", () => {
  test("exits with code 1 and prints usage to stderr", async () => {
    const { stdout, stderr, exitCode } = await run([]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stdout.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Explicit ticket:variant — classified directly
// ---------------------------------------------------------------------------

describe("explicit ticket:variant classification", () => {
  test("single ticket:variant goes into ticketsWithVariant", async () => {
    const { stdout, exitCode } = await run(["BRE-342:backend"]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ticketsWithVariant).toEqual([
      { ticket: "BRE-342", variant: "backend" },
    ]);
    expect(parsed.ticketsNoVariant).toEqual([]);
    expect(parsed.projectNames).toEqual([]);
  });

  test("multiple ticket:variant pairs", async () => {
    const { stdout, exitCode } = await run([
      "BRE-342:default",
      "BRE-341:mobile",
      "BRE-339:custom",
    ]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ticketsWithVariant).toHaveLength(3);
    expect(parsed.ticketsWithVariant[0]).toEqual({ ticket: "BRE-342", variant: "default" });
    expect(parsed.ticketsWithVariant[1]).toEqual({ ticket: "BRE-341", variant: "mobile" });
    expect(parsed.ticketsWithVariant[2]).toEqual({ ticket: "BRE-339", variant: "custom" });
  });
});

// ---------------------------------------------------------------------------
// Bare ticket IDs — classified for MCP resolution
// ---------------------------------------------------------------------------

describe("bare ticket ID classification", () => {
  test("bare ticket goes into ticketsNoVariant", async () => {
    const { stdout, exitCode } = await run(["BRE-342"]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ticketsWithVariant).toEqual([]);
    expect(parsed.ticketsNoVariant).toEqual(["BRE-342"]);
    expect(parsed.projectNames).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Project names — classified for MCP resolution
// ---------------------------------------------------------------------------

describe("project name classification", () => {
  test("project name goes into projectNames", async () => {
    const { stdout, exitCode } = await run(["Collab Install"]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ticketsWithVariant).toEqual([]);
    expect(parsed.ticketsNoVariant).toEqual([]);
    expect(parsed.projectNames).toEqual(["Collab Install"]);
  });
});

// ---------------------------------------------------------------------------
// Mixed arguments
// ---------------------------------------------------------------------------

describe("mixed argument classification", () => {
  test("project name + ticket:variant + bare ticket all classified correctly", async () => {
    const { stdout, exitCode } = await run([
      "Collab",
      "BRE-100",
      "BRE-200:backend",
    ]);
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ticketsWithVariant).toEqual([{ ticket: "BRE-200", variant: "backend" }]);
    expect(parsed.ticketsNoVariant).toEqual(["BRE-100"]);
    expect(parsed.projectNames).toEqual(["Collab"]);
  });
});
