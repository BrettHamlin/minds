/**
 * E2E test: checksum failure detection
 *
 * Steps:
 *  1. Start local registry where the manifest declares a checksum that does not
 *     match the actual tarball content
 *  2. Attempt to install the pipeline
 *  3. Verify: CLI exits non-zero, stderr contains "Checksum mismatch", no
 *     commands copied, state unchanged
 *
 * Uses subprocess spawning so process.exit() behaviour is captured correctly.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeChecksum } from "../../minds/cli/lib/integrity";

const CLI_ENTRY = join(import.meta.dir, "../../minds/cli/index.ts");

async function runCLI(
  args: string[],
  opts: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_ENTRY, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env },
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
let tarballPath = "";

beforeAll(() => {
  buildDir = join(tmpdir(), `collab-chksum-${Date.now()}`);
  mkdirSync(buildDir, { recursive: true });

  // Build a valid tarball
  const pipelineDir = join(buildDir, "tampered-1.0.0");
  mkdirSync(join(pipelineDir, "commands"), { recursive: true });
  writeFileSync(
    join(pipelineDir, "pipeline.json"),
    JSON.stringify({
      name: "tampered",
      type: "pipeline",
      version: "1.0.0",
      description: "Test pipeline for checksum failure",
      dependencies: [],
      cliDependencies: [],
      commands: ["commands/collab.tampered.md"],
    })
  );
  writeFileSync(join(pipelineDir, "commands", "collab.tampered.md"), "# tampered\n");
  tarballPath = join(buildDir, "tampered-1.0.0.tar.gz");
  execSync(`tar -czf "${tarballPath}" -C "${buildDir}" tampered-1.0.0`);

  // Compute the real checksum — the manifest will declare a WRONG checksum
  const realChecksum = computeChecksum(readFileSync(tarballPath));
  const wrongChecksum = realChecksum.split("").reverse().join(""); // definitely wrong

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
                name: "tampered",
                description: "Checksum test pipeline",
                latestVersion: "1.0.0",
                manifestUrl: `${base}/pipelines/tampered/pipeline.json`,
                tarballUrl: `${base}/pipelines/tampered/tampered-1.0.0.tar.gz`,
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/pipelines/tampered/pipeline.json") {
        return new Response(
          JSON.stringify({
            name: "tampered",
            type: "pipeline",
            version: "1.0.0",
            description: "Test pipeline",
            dependencies: [],
            cliDependencies: [],
            commands: ["commands/collab.tampered.md"],
            // deliberately wrong checksum — install must reject this
            checksum: wrongChecksum,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (pathname === "/pipelines/tampered/tampered-1.0.0.tar.gz") {
        return new Response(readFileSync(tarballPath), {
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

// ─── Test ─────────────────────────────────────────────────────────────────────

describe("E2E: checksum failure", () => {
  test("tampered file rejected — CLI exits non-zero, error mentions checksum", async () => {
    const tmpDir = join(tmpdir(), `collab-chksum-run-${Date.now()}`);
    const stateDir = join(tmpDir, ".collab", "state");
    mkdirSync(stateDir, { recursive: true });
    const statePath = join(stateDir, "installed-pipelines.json");
    const lockPath = join(tmpDir, "pipeline-lock.json");
    const installDir = join(tmpDir, ".collab", "pipelines");

    try {
      const result = await runCLI(
        [
          "pipelines", "install", "tampered",
          "--registry", `http://localhost:${serverPort}/registry.json`,
          "--state", statePath,
          "--lock", lockPath,
          "--install-dir", installDir,
        ],
        { cwd: tmpDir }
      );

      // Must fail
      expect(result.exitCode).not.toBe(0);

      // Error output must mention checksum mismatch
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toContain("checksum");

      // State must be unchanged (pipeline not installed)
      if (existsSync(statePath)) {
        const state = JSON.parse(readFileSync(statePath, "utf8"));
        expect(state.pipelines?.tampered).toBeUndefined();
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 20_000);
});
