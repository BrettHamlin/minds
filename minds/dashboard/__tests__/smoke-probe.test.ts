// smoke-probe.test.ts — Unit tests for smoke-probe CLI (BRE-454 T002)

import { describe, test, expect } from "bun:test";
import { join } from "path";

const SMOKE_PROBE = join(import.meta.dir, "../smoke-probe.ts");

async function run(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", SMOKE_PROBE, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("smoke-probe CLI", () => {
  test("exits 1 with error when --phase is missing", async () => {
    const { stderr, exitCode } = await run(["--ticket", "BRE-454"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--phase");
  });

  test("exits 1 with error when --ticket is missing", async () => {
    const { stderr, exitCode } = await run(["--phase", "clarify"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--ticket");
  });

  test("exits 0 with --dry-run and logs started + complete", async () => {
    const { stdout, exitCode } = await run([
      "--phase",
      "clarify",
      "--ticket",
      "BRE-454",
      "--dry-run",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Phase "clarify" started for BRE-454');
    expect(stdout).toContain('Phase "clarify" complete for BRE-454');
  });

  test("log lines include ISO timestamp prefix", async () => {
    const { stdout } = await run([
      "--phase",
      "plan",
      "--ticket",
      "TEST-1",
      "--dry-run",
    ]);
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    // Each line starts with [<ISO timestamp>]
    for (const line of lines) {
      expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });

  test("log format matches expected pattern exactly", async () => {
    const { stdout } = await run([
      "--phase",
      "analyze",
      "--ticket",
      "BRE-100",
      "--dry-run",
    ]);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toMatch(/\] Phase "analyze" started for BRE-100$/);
    expect(lines[1]).toMatch(/\] Phase "analyze" complete for BRE-100$/);
  });

  test("--dry-run skips sleep (completes quickly)", async () => {
    const start = Date.now();
    const { exitCode } = await run([
      "--phase",
      "tasks",
      "--ticket",
      "BRE-454",
      "--dry-run",
    ]);
    const elapsed = Date.now() - start;
    expect(exitCode).toBe(0);
    // Should complete well under 5 seconds (not the 60s sleep)
    expect(elapsed).toBeLessThan(5000);
  });
});
