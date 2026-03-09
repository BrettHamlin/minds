/**
 * test-helpers.ts — Shared test utilities for orchestrator CLI tests.
 *
 * Not bundled into templates (*.test.ts exclusion in bundle-templates.ts covers
 * this file since it lacks ".test" but is only imported by test files).
 */

/**
 * Spawn a Bun CLI script and capture stdout, stderr, and exit code.
 * Accepts an optional env override for test isolation (e.g. PATH with fake binaries).
 */
export async function spawnCli(
  cliPath: string,
  args: string[],
  cwd: string,
  env?: Record<string, string | undefined>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env } : {}),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}
