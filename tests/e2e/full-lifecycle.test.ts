/**
 * E2E test: full install lifecycle
 *
 * Steps verified:
 *  1. Fresh env — no state, no lockfile, no commands
 *  2. Install specify — commands present, state + lockfile written
 *  3. pipelines list — shows specify in output
 *  4. Registry bumps specify to 1.3.0
 *  5. update --yes — specify updated, lockfile reflects new version
 *  6. remove specify — state empty, lockfile empty
 *  7. Temp dir clean (no orphaned files)
 *
 * Uses subprocess spawning so the full CLI binary contract is exercised.
 * The in-process Bun.serve server handles all HTTP requests from spawned processes.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_ENTRY = join(import.meta.dir, "../../src/cli/index.ts");

async function runCLI(
  args: string[],
  opts: { cwd?: string; env?: Partial<NodeJS.ProcessEnv> } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_ENTRY, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...opts.env },
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

// ─── Server setup ─────────────────────────────────────────────────────────────

let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort = 0;
let buildDir = "";
let specifyTarball = "";
let specify130Tarball = "";

beforeAll(() => {
  buildDir = join(tmpdir(), `collab-lifecycle-${Date.now()}`);
  mkdirSync(buildDir, { recursive: true });

  // specify-1.2.0 tarball
  const spec120Dir = join(buildDir, "specify-1.2.0");
  mkdirSync(join(spec120Dir, "commands"), { recursive: true });
  writeFileSync(
    join(spec120Dir, "pipeline.json"),
    JSON.stringify({
      name: "specify",
      type: "pipeline",
      version: "1.2.0",
      description: "Spec pipeline",
      dependencies: [],
      cliDependencies: [],
      commands: ["commands/collab.specify.md"],
    })
  );
  writeFileSync(join(spec120Dir, "commands", "collab.specify.md"), "# specify v1.2\n");
  specifyTarball = join(buildDir, "specify-1.2.0.tar.gz");
  execSync(`tar -czf "${specifyTarball}" -C "${buildDir}" specify-1.2.0`);

  // specify-1.3.0 tarball (for update step)
  const spec130Dir = join(buildDir, "specify-1.3.0");
  mkdirSync(join(spec130Dir, "commands"), { recursive: true });
  writeFileSync(
    join(spec130Dir, "pipeline.json"),
    JSON.stringify({
      name: "specify",
      type: "pipeline",
      version: "1.3.0",
      description: "Spec pipeline",
      dependencies: [],
      cliDependencies: [],
      commands: ["commands/collab.specify.md"],
    })
  );
  writeFileSync(join(spec130Dir, "commands", "collab.specify.md"), "# specify v1.3\n");
  specify130Tarball = join(buildDir, "specify-1.3.0.tar.gz");
  execSync(`tar -czf "${specify130Tarball}" -C "${buildDir}" specify-1.3.0`);

  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      const base = `http://localhost:${serverPort}`;

      if (pathname === "/registry.json") {
        return new Response(
          JSON.stringify({
            version: "1",
            updatedAt: "2026-03-03T00:00:00Z",
            packs: [],
            pipelines: [
              {
                name: "specify",
                description: "Spec pipeline",
                latestVersion: "1.2.0",
                manifestUrl: `${base}/pipelines/specify/pipeline.json`,
                tarballUrl: `${base}/pipelines/specify/specify-1.2.0.tar.gz`,
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/registry-updated.json") {
        return new Response(
          JSON.stringify({
            version: "1",
            updatedAt: "2026-03-03T12:00:00Z",
            packs: [],
            pipelines: [
              {
                name: "specify",
                description: "Spec pipeline",
                latestVersion: "1.3.0",
                manifestUrl: `${base}/pipelines/specify/pipeline-130.json`,
                tarballUrl: `${base}/pipelines/specify/specify-1.3.0.tar.gz`,
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/pipelines/specify/pipeline.json") {
        return new Response(
          JSON.stringify({
            name: "specify",
            type: "pipeline",
            version: "1.2.0",
            description: "Spec pipeline",
            dependencies: [],
            cliDependencies: [],
            commands: ["commands/collab.specify.md"],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/pipelines/specify/pipeline-130.json") {
        return new Response(
          JSON.stringify({
            name: "specify",
            type: "pipeline",
            version: "1.3.0",
            description: "Spec pipeline",
            dependencies: [],
            cliDependencies: [],
            commands: ["commands/collab.specify.md"],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/pipelines/specify/specify-1.2.0.tar.gz") {
        return new Response(readFileSync(specifyTarball), {
          headers: { "Content-Type": "application/gzip" },
        });
      }

      if (pathname === "/pipelines/specify/specify-1.3.0.tar.gz") {
        return new Response(readFileSync(specify130Tarball), {
          headers: { "Content-Type": "application/gzip" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  serverPort = server.port;
});

afterAll(() => {
  server?.stop();
  try {
    rmSync(buildDir, { recursive: true, force: true });
  } catch {}
});

// ─── Full lifecycle test ───────────────────────────────────────────────────────

describe("E2E: full install lifecycle", () => {
  test("fresh → install → list → update → remove → clean", async () => {
    const tmpDir = join(tmpdir(), `collab-lifecycle-run-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const stateDir = join(tmpDir, ".collab", "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "installed-pipelines.json");
    const lockPath = join(tmpDir, "pipeline-lock.json");
    const installDir = join(tmpDir, ".collab", "pipelines");
    const commandsDir = join(tmpDir, ".claude", "commands");
    const registryUrl = `http://localhost:${serverPort}/registry.json`;
    const updatedRegistryUrl = `http://localhost:${serverPort}/registry-updated.json`;

    try {
      // ── Step 1: Fresh env ──────────────────────────────────────────────────
      expect(existsSync(statePath)).toBe(false);
      expect(existsSync(lockPath)).toBe(false);

      // ── Step 2: Install specify ────────────────────────────────────────────
      const installResult = await runCLI(
        [
          "pipelines", "install", "specify",
          "--registry", registryUrl,
          "--state", statePath,
          "--lock", lockPath,
          "--install-dir", installDir,
        ],
        { cwd: tmpDir }
      );

      expect(installResult.exitCode).toBe(0);
      expect(installResult.stdout).toContain("Installation complete");

      // Commands, state, lockfile created
      expect(existsSync(join(commandsDir, "collab.specify.md"))).toBe(true);
      const state1 = JSON.parse(readFileSync(statePath, "utf8"));
      expect(state1.pipelines.specify.version).toBe("1.2.0");

      const lockfile1 = JSON.parse(readFileSync(lockPath, "utf8"));
      expect(lockfile1.pipelines.specify.resolvedVersion).toBe("1.2.0");

      // ── Step 3: pipelines list ─────────────────────────────────────────────
      const listResult = await runCLI(
        ["pipelines", "list", "--state", statePath],
        { cwd: tmpDir }
      );

      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain("specify");
      expect(listResult.stdout).toContain("1.2.0");

      // ── Step 4+5: update --yes with v1.3.0 registry ───────────────────────
      const updateResult = await runCLI(
        [
          "pipelines", "update", "--yes",
          "--registry", updatedRegistryUrl,
          "--state", statePath,
          "--lock", lockPath,
          "--install-dir", installDir,
        ],
        { cwd: tmpDir }
      );

      expect(updateResult.exitCode).toBe(0);

      const state2 = JSON.parse(readFileSync(statePath, "utf8"));
      expect(state2.pipelines.specify.version).toBe("1.3.0");

      const lockfile2 = JSON.parse(readFileSync(lockPath, "utf8"));
      expect(lockfile2.pipelines.specify.resolvedVersion).toBe("1.3.0");

      // ── Step 6: remove specify ─────────────────────────────────────────────
      const removeResult = await runCLI(
        [
          "pipelines", "remove", "specify",
          "--state", statePath,
          "--lock", lockPath,
          "--install-dir", installDir,
        ],
        { cwd: tmpDir }
      );

      expect(removeResult.exitCode).toBe(0);
      expect(removeResult.stdout).toContain("Removed specify");

      const state3 = JSON.parse(readFileSync(statePath, "utf8"));
      expect(state3.pipelines.specify).toBeUndefined();

      const lockfile3 = JSON.parse(readFileSync(lockPath, "utf8"));
      expect(lockfile3.pipelines.specify).toBeUndefined();

      // ── Step 7: installDir cleaned up ─────────────────────────────────────
      expect(existsSync(join(installDir, "specify"))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);
});
