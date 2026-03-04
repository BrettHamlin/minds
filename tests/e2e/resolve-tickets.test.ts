/**
 * E2E tests for src/scripts/orchestrator/commands/resolve-tickets.ts
 *
 * Spawns the CLI as a real subprocess. Tests that do not require Linear API
 * access cover: no-args usage error, explicit ticket:variant passthrough.
 * Tests that require LINEAR_API_KEY are skipped when the variable is absent.
 */

import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const SCRIPT = join(
  import.meta.dir,
  "../../src/scripts/orchestrator/commands/resolve-tickets.ts"
);

async function run(
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", SCRIPT, ...args], {
    env: { ...process.env, ...env },
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
// Explicit ticket:variant passthrough — no API key needed
// ---------------------------------------------------------------------------

describe("explicit ticket:variant passthrough (no LINEAR_API_KEY required)", () => {
  test("single explicit ticket:variant outputs valid JSON array", async () => {
    const { stdout, stderr, exitCode } = await run(
      ["BRE-342:backend"],
      { LINEAR_API_KEY: undefined } // explicitly absent
    );
    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      ticket: "BRE-342",
      variant: "backend",
      source: "explicit",
    });
  });

  test("multiple explicit ticket:variant pairs all appear in output", async () => {
    const { stdout, exitCode } = await run(
      ["BRE-342:default", "BRE-341:mobile", "BRE-339:custom"],
      { LINEAR_API_KEY: undefined }
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ ticket: "BRE-342", variant: "default", source: "explicit" });
    expect(parsed[1]).toMatchObject({ ticket: "BRE-341", variant: "mobile", source: "explicit" });
    expect(parsed[2]).toMatchObject({ ticket: "BRE-339", variant: "custom", source: "explicit" });
  });

  test("output JSON fields include ticket, variant, title, status, source", async () => {
    const { stdout, exitCode } = await run(["BRE-100:default"], { LINEAR_API_KEY: undefined });
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    const item = parsed[0];
    // All required fields present
    expect(item).toHaveProperty("ticket");
    expect(item).toHaveProperty("variant");
    expect(item).toHaveProperty("title");
    expect(item).toHaveProperty("status");
    expect(item).toHaveProperty("source");
    // Explicit:variant skips API — title/status intentionally empty
    expect(item.title).toBe("");
    expect(item.status).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Missing API key when bare ticket ID supplied → exit 1
// ---------------------------------------------------------------------------

describe("LINEAR_API_KEY required for bare ticket IDs", () => {
  test("exits 1 with clear error when API key absent and bare ticket provided", async () => {
    const env: Partial<NodeJS.ProcessEnv> = { ...process.env };
    delete env.LINEAR_API_KEY;

    const { stderr, exitCode } = await run(["BRE-342"], env);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LINEAR_API_KEY");
  });

  test("exits 1 with clear error when API key absent and project name provided", async () => {
    const env: Partial<NodeJS.ProcessEnv> = { ...process.env };
    delete env.LINEAR_API_KEY;

    const { stderr, exitCode } = await run(["Collab Install"], env);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LINEAR_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// --project-id flag requires API key
// ---------------------------------------------------------------------------

describe("--project-id flag", () => {
  test("exits 1 when --project-id given but no API key", async () => {
    const env: Partial<NodeJS.ProcessEnv> = { ...process.env };
    delete env.LINEAR_API_KEY;

    const { stderr, exitCode } = await run(["--project-id", "some-uuid"], env);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("LINEAR_API_KEY");
  });

  test("exits 1 when --project-id flag is missing its value", async () => {
    const { stderr, exitCode } = await run(["--project-id"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--project-id");
  });
});
