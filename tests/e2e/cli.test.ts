/**
 * E2E tests for src/cli/index.ts
 *
 * Each test spawns the CLI as a real subprocess via `bun run`.
 * No unit-test imports — these verify the actual CLI binary contract.
 *
 * Tests:
 *  1. No args  → usage text, exit 0
 *  2. pipelines browse  → lists registry contents from mock HTTP server
 *  3. pipeline init  → creates pipeline.json with correct structure
 *  4. pipeline validate  → exits 0 on init-generated manifest
 *  5. pipelines list (empty)  → "No pipelines installed" message, exit 0
 *  6. pipelines install (full flow)  → state file + lockfile written correctly
 *  7. pipelines remove  → state + lockfile no longer contain the removed entry
 *  8. pipelines update  → reports installed vs registry version when outdated
 *  9. pack install  → installs pack + transitive pipeline dep; both in state + lockfile
 * 10. CLI dep blocking  → exits non-zero when required CLI tool is missing
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Absolute path to the CLI entry point
const CLI_ENTRY = join(import.meta.dir, "../../minds/cli/index.ts");

// ─── Subprocess helper ────────────────────────────────────────────────────────
// Uses Bun.spawn (async) rather than spawnSync so the event loop stays free to
// serve incoming HTTP requests from the spawned subprocess. spawnSync blocks the
// main thread and prevents the in-process Bun.serve server from responding.

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

function makeTmpDir(label: string): string {
  const dir = join(tmpdir(), `collab-e2e-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Local HTTP server ────────────────────────────────────────────────────────
// Serves: registry.json, per-pipeline manifests, and tarballs.
// Port is determined at runtime (port: 0) and stored in `serverPort`.
// The registry.json handler references `serverPort` by closure — this is safe
// because no requests arrive until after beforeAll() completes.

let server: ReturnType<typeof Bun.serve> | null = null;
let serverPort = 0;
let tarballBuildDir = "";
let tarballPath = "";
let packTarballPath = "";
let cliGatedTarballPath = "";

beforeAll(() => {
  tarballBuildDir = makeTmpDir("tarball-build");

  // ── specify-1.2.0 tarball ─────────────────────────────────────────────────
  // Structure: specify-1.2.0/{pipeline.json,commands/collab.specify.md}
  // After `tar --strip-components=1`, files land directly in the pipeline dir.
  const specifyRoot = join(tarballBuildDir, "specify-1.2.0");
  mkdirSync(join(specifyRoot, "commands"), { recursive: true });
  writeFileSync(
    join(specifyRoot, "pipeline.json"),
    JSON.stringify({
      name: "specify",
      type: "pipeline",
      version: "1.2.0",
      description: "Specification pipeline",
      dependencies: [],
      cliDependencies: [],
      commands: ["commands/collab.specify.md"],
    })
  );
  writeFileSync(
    join(specifyRoot, "commands", "collab.specify.md"),
    "# collab specify\nTest command file\n"
  );
  tarballPath = join(tarballBuildDir, "specify-1.2.0.tar.gz");
  execSync(`tar -czf "${tarballPath}" -C "${tarballBuildDir}" specify-1.2.0`);

  // ── full-workflow-1.0.0 tarball (pack that depends on specify) ────────────
  const packRoot = join(tarballBuildDir, "full-workflow-1.0.0");
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(
    join(packRoot, "pipeline.json"),
    JSON.stringify({
      name: "full-workflow",
      type: "pack",
      version: "1.0.0",
      description: "Full workflow pack",
      pipelines: ["specify"],
      dependencies: [{ name: "specify", version: ">=1.0.0" }],
      cliDependencies: [],
      commands: [],
    })
  );
  packTarballPath = join(tarballBuildDir, "full-workflow-1.0.0.tar.gz");
  execSync(`tar -czf "${packTarballPath}" -C "${tarballBuildDir}" full-workflow-1.0.0`);

  // ── cli-gated-1.0.0 tarball (requires a nonexistent CLI tool) ────────────
  const cliGatedRoot = join(tarballBuildDir, "cli-gated-1.0.0");
  mkdirSync(cliGatedRoot, { recursive: true });
  writeFileSync(
    join(cliGatedRoot, "pipeline.json"),
    JSON.stringify({
      name: "cli-gated",
      type: "pipeline",
      version: "1.0.0",
      description: "Requires a nonexistent CLI — used to test CLI dep blocking",
      dependencies: [],
      cliDependencies: [
        {
          name: "nonexistent-tool",
          version: ">=1.0.0",
          required: true,
          installHint: "This tool does not exist — install test only",
        },
      ],
      commands: [],
    })
  );
  cliGatedTarballPath = join(tarballBuildDir, "cli-gated-1.0.0.tar.gz");
  execSync(`tar -czf "${cliGatedTarballPath}" -C "${tarballBuildDir}" cli-gated-1.0.0`);

  // ── Start HTTP server — port 0 = OS-assigned random port ─────────────────
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      const base = `http://localhost:${serverPort}`;

      // ── Registry index ──────────────────────────────────────────────────
      if (pathname === "/registry.json") {
        return new Response(
          JSON.stringify({
            version: "1",
            updatedAt: "2026-03-03T00:00:00.000Z",
            packs: [
              {
                name: "full-workflow",
                description: "Full workflow pack",
                latestVersion: "1.0.0",
                manifestUrl: `${base}/packs/full-workflow/pipeline.json`,
                tarballUrl: `${base}/packs/full-workflow/full-workflow-1.0.0.tar.gz`,
              },
            ],
            pipelines: [
              {
                name: "specify",
                description: "AI-powered spec creation",
                latestVersion: "1.2.0",
                manifestUrl: `${base}/pipelines/specify/pipeline.json`,
                tarballUrl: `${base}/pipelines/specify/specify-1.2.0.tar.gz`,
              },
              {
                name: "plan",
                description: "Implementation planning",
                latestVersion: "1.1.0",
                manifestUrl: `${base}/pipelines/plan/pipeline.json`,
                tarballUrl: `${base}/pipelines/plan/plan-1.1.0.tar.gz`,
              },
              {
                name: "cli-gated",
                description: "Requires a nonexistent CLI tool",
                latestVersion: "1.0.0",
                manifestUrl: `${base}/pipelines/cli-gated/pipeline.json`,
                tarballUrl: `${base}/pipelines/cli-gated/cli-gated-1.0.0.tar.gz`,
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // ── Updated registry: specify bumped to 1.3.0 (for update test) ────
      if (pathname === "/registry-updated.json") {
        return new Response(
          JSON.stringify({
            version: "1",
            updatedAt: "2026-03-03T12:00:00.000Z",
            packs: [],
            pipelines: [
              {
                name: "specify",
                description: "AI-powered spec creation",
                latestVersion: "1.3.0",
                manifestUrl: `${base}/pipelines/specify/pipeline.json`,
                tarballUrl: `${base}/pipelines/specify/specify-1.2.0.tar.gz`,
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // ── specify manifest + tarball ──────────────────────────────────────
      if (pathname === "/pipelines/specify/pipeline.json") {
        // No checksum → install skips verification (safe for test)
        return new Response(
          JSON.stringify({
            name: "specify",
            type: "pipeline",
            version: "1.2.0",
            description: "Specification pipeline",
            dependencies: [],
            cliDependencies: [],
            commands: ["commands/collab.specify.md"],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/pipelines/specify/specify-1.2.0.tar.gz") {
        return new Response(readFileSync(tarballPath), {
          headers: { "Content-Type": "application/gzip" },
        });
      }

      // ── full-workflow pack manifest + tarball ───────────────────────────
      if (pathname === "/packs/full-workflow/pipeline.json") {
        return new Response(
          JSON.stringify({
            name: "full-workflow",
            type: "pack",
            version: "1.0.0",
            description: "Full workflow pack",
            pipelines: ["specify"],
            dependencies: [{ name: "specify", version: ">=1.0.0" }],
            cliDependencies: [],
            commands: [],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/packs/full-workflow/full-workflow-1.0.0.tar.gz") {
        return new Response(readFileSync(packTarballPath), {
          headers: { "Content-Type": "application/gzip" },
        });
      }

      // ── cli-gated manifest + tarball ────────────────────────────────────
      if (pathname === "/pipelines/cli-gated/pipeline.json") {
        return new Response(
          JSON.stringify({
            name: "cli-gated",
            type: "pipeline",
            version: "1.0.0",
            description: "Requires a nonexistent CLI",
            dependencies: [],
            cliDependencies: [
              {
                name: "nonexistent-tool",
                version: ">=1.0.0",
                required: true,
                installHint: "This tool does not exist — install test only",
              },
            ],
            commands: [],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/pipelines/cli-gated/cli-gated-1.0.0.tar.gz") {
        return new Response(readFileSync(cliGatedTarballPath), {
          headers: { "Content-Type": "application/gzip" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  // serverPort is read by the handlers at request time (safe — no requests arrive
  // until after beforeAll completes)
  serverPort = server.port;
});

afterAll(() => {
  server?.stop();
  try {
    rmSync(tarballBuildDir, { recursive: true, force: true });
  } catch {}
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("collab CLI — E2E", () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  test("1. no args prints usage and exits 0", async () => {
    const { stdout, exitCode } = await runCLI([]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("collab v");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("pipelines install");
    expect(stdout).toContain("pipeline init");
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  test("2. pipelines browse lists registry contents via mock server", async () => {
    const registryUrl = `http://localhost:${serverPort}/registry.json`;
    const { stdout, exitCode } = await runCLI([
      "pipelines",
      "browse",
      "--registry",
      registryUrl,
    ]);

    expect(exitCode).toBe(0);
    // Both pipelines appear
    expect(stdout).toContain("specify");
    expect(stdout).toContain("plan");
    // Versions appear
    expect(stdout).toContain("1.2.0");
    expect(stdout).toContain("1.1.0");
    // Section headers
    expect(stdout).toContain("Available Pipelines");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  test("3. pipeline init creates pipeline.json with correct structure", async () => {
    const tmpDir = makeTmpDir("init");
    const { stdout, exitCode } = await runCLI(
      ["pipeline", "init", "--name", "test-pipe", "--type", "pipeline"],
      { cwd: tmpDir }
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created");

    const pipelinePath = join(tmpDir, "pipeline.json");
    expect(existsSync(pipelinePath)).toBe(true);

    const manifest = JSON.parse(readFileSync(pipelinePath, "utf8"));
    expect(manifest.name).toBe("test-pipe");
    expect(manifest.type).toBe("pipeline");
    expect(manifest.version).toBe("1.0.0");
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(Array.isArray(manifest.dependencies)).toBe(true);
    expect(Array.isArray(manifest.cliDependencies)).toBe(true);
    expect(Array.isArray(manifest.commands)).toBe(true);
    // Pack-only field should not be present on a pipeline
    expect((manifest as Record<string, unknown>).pipelines).toBeUndefined();
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  test("4. pipeline validate exits 0 on init-generated manifest", async () => {
    const tmpDir = makeTmpDir("validate");

    // First generate the manifest
    const initResult = await runCLI(
      ["pipeline", "init", "--name", "my-pipe"],
      { cwd: tmpDir }
    );
    expect(initResult.exitCode).toBe(0);

    const pipelinePath = join(tmpDir, "pipeline.json");

    // Now validate it — must exit 0
    const { stdout, exitCode } = await runCLI([
      "pipeline",
      "validate",
      "--path",
      pipelinePath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✓");
    expect(stdout).toContain("my-pipe");
    expect(stdout).toContain("1.0.0");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  test("5. pipelines list with no installed pipelines exits 0 with empty message", async () => {
    const tmpDir = makeTmpDir("list-empty");
    // Point --state at a path that doesn't exist → readState returns empty state
    const { stdout, exitCode } = await runCLI([
      "pipelines",
      "list",
      "--state",
      join(tmpDir, "nonexistent-installed-pipelines.json"),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No pipelines installed");
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  test("6. pipelines install creates state file and lockfile", async () => {
    const tmpDir = makeTmpDir("install");

    const stateDir = join(tmpDir, ".collab", "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "installed-pipelines.json");
    const lockPath = join(tmpDir, "pipeline-lock.json");
    const installDir = join(tmpDir, ".collab", "pipelines");
    const registryUrl = `http://localhost:${serverPort}/registry.json`;

    const { stdout, exitCode } = await runCLI(
      [
        "pipelines",
        "install",
        "specify",
        "--registry",
        registryUrl,
        "--state",
        statePath,
        "--lock",
        lockPath,
        "--install-dir",
        installDir,
      ],
      { cwd: tmpDir }
    );

    // Must succeed
    expect(exitCode).toBe(0);
    expect(stdout).toContain("✓ Installation complete");

    // State file must be written and contain the installed pipeline
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.pipelines["specify"]).toBeDefined();
    expect(state.pipelines["specify"].version).toBe("1.2.0");
    expect(state.pipelines["specify"].checksum).toBeTruthy();

    // Lockfile must be written and contain the resolved entry
    expect(existsSync(lockPath)).toBe(true);
    const lockfile = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lockfile.lockfileVersion).toBe(1);
    expect(lockfile.pipelines["specify"]).toBeDefined();
    expect(lockfile.pipelines["specify"].resolvedVersion).toBe("1.2.0");
    expect(lockfile.pipelines["specify"].tarballUrl).toContain("specify-1.2.0.tar.gz");

    // Tarball must be cached in the install dir
    const tarball = join(installDir, "specify", "specify-1.2.0.tar.gz");
    expect(existsSync(tarball)).toBe(true);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  test("7. pipelines remove uninstalls pipeline from state and lockfile", async () => {
    const tmpDir = makeTmpDir("remove");
    const stateDir = join(tmpDir, ".collab", "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "installed-pipelines.json");
    const lockPath = join(tmpDir, "pipeline-lock.json");
    const installDir = join(tmpDir, ".collab", "pipelines");
    const registryUrl = `http://localhost:${serverPort}/registry.json`;

    // Install specify first
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

    // Now remove it
    const { stdout, exitCode } = await runCLI(
      [
        "pipelines", "remove", "specify",
        "--state", statePath,
        "--lock", lockPath,
        "--install-dir", installDir,
      ],
      { cwd: tmpDir }
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Removed specify");

    // State file must no longer contain specify
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.pipelines["specify"]).toBeUndefined();

    // Lockfile must no longer contain specify
    const lockfile = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lockfile.pipelines["specify"]).toBeUndefined();
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  test("8. pipelines update reports available upgrade with installed vs registry version", async () => {
    const tmpDir = makeTmpDir("update");
    const stateDir = join(tmpDir, ".collab", "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "installed-pipelines.json");
    const lockPath = join(tmpDir, "pipeline-lock.json");
    const installDir = join(tmpDir, ".collab", "pipelines");
    const registryUrl = `http://localhost:${serverPort}/registry.json`;

    // Install specify at 1.2.0
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

    // Run update against /registry-updated.json which shows specify at 1.3.0.
    // Without --yes this is a dry-run: reports what would be updated and exits 0.
    const updatedRegistryUrl = `http://localhost:${serverPort}/registry-updated.json`;
    const { stdout, exitCode } = await runCLI(
      [
        "pipelines", "update",
        "--registry", updatedRegistryUrl,
        "--state", statePath,
        "--lock", lockPath,
      ],
      { cwd: tmpDir }
    );

    expect(exitCode).toBe(0);
    // Both the installed version and the available version must appear
    expect(stdout).toContain("specify");
    expect(stdout).toContain("1.2.0");
    expect(stdout).toContain("1.3.0");
    // Arrow showing the upgrade direction
    expect(stdout).toContain("→");
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  test("9. pack install installs pack and its transitive pipeline dependency", async () => {
    const tmpDir = makeTmpDir("pack-install");
    const stateDir = join(tmpDir, ".collab", "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "installed-pipelines.json");
    const lockPath = join(tmpDir, "pipeline-lock.json");
    const installDir = join(tmpDir, ".collab", "pipelines");
    const registryUrl = `http://localhost:${serverPort}/registry.json`;

    const { stdout, exitCode } = await runCLI(
      [
        "pipelines", "install", "full-workflow",
        "--registry", registryUrl,
        "--state", statePath,
        "--lock", lockPath,
        "--install-dir", installDir,
      ],
      { cwd: tmpDir }
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✓ Installation complete");

    // State must contain both the pack itself and its transitive dep (specify)
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.pipelines["full-workflow"]).toBeDefined();
    expect(state.pipelines["full-workflow"].version).toBe("1.0.0");
    expect(state.pipelines["specify"]).toBeDefined();
    expect(state.pipelines["specify"].version).toBe("1.2.0");
    // specify was installed as a transitive dep of full-workflow
    expect(state.pipelines["specify"].requiredBy).toContain("full-workflow");

    // Lockfile must contain both entries
    const lockfile = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lockfile.pipelines["full-workflow"]).toBeDefined();
    expect(lockfile.pipelines["full-workflow"].resolvedVersion).toBe("1.0.0");
    expect(lockfile.pipelines["specify"]).toBeDefined();
    expect(lockfile.pipelines["specify"].resolvedVersion).toBe("1.2.0");
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  test("10. pipelines install exits non-zero when required CLI dependency is missing", async () => {
    const tmpDir = makeTmpDir("cli-blocked");
    const stateDir = join(tmpDir, ".collab", "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "installed-pipelines.json");
    const lockPath = join(tmpDir, "pipeline-lock.json");
    const installDir = join(tmpDir, ".collab", "pipelines");
    const registryUrl = `http://localhost:${serverPort}/registry.json`;

    const { stdout, stderr, exitCode } = await runCLI(
      [
        "pipelines", "install", "cli-gated",
        "--registry", registryUrl,
        "--state", statePath,
        "--lock", lockPath,
        "--install-dir", installDir,
      ],
      { cwd: tmpDir }
    );

    // Must fail
    expect(exitCode).not.toBe(0);
    // The blocking CLI name appears in stdout (from formatCliResult)
    expect(stdout).toContain("nonexistent-tool");
    // The install failure message appears in stderr
    expect(stderr).toContain("Cannot install");
  });
});
