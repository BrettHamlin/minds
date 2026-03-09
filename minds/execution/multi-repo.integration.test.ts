/**
 * Multi-repo integration tests: exercises the full orchestrator-init → signal-validate
 * → status-table pipeline for a 2-ticket multi-repo scenario without live tmux.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolvePaths, createRegistry } from "./orchestrator-init";
import type { InitContext } from "./orchestrator-init";
import { validateSignal } from "./signal-validate";
import type { ParsedSignal } from "./signal-validate";
import { renderTable } from "./status-table";
import { buildAdjacency } from "../coordination/coordination-check"; // CROSS-MIND

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-mr-int-"));

  fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".collab/state/pipeline-registry"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".collab/state/pipeline-groups"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "specs"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "repos/backend"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "repos/frontend"), { recursive: true });

  // Write repos.json via env var (replaces multi-repo.json for repo path resolution)
  const reposFile = path.join(tmpDir, "test-repos.json");
  fs.writeFileSync(
    reposFile,
    JSON.stringify({
      backend: { path: path.join(tmpDir, "repos/backend") },
      frontend: { path: path.join(tmpDir, "repos/frontend") },
    })
  );
  process.env.COLLAB_REPOS_FILE = reposFile;

  // Write multi-repo.json (still needed for status-table Repo column)
  fs.writeFileSync(
    path.join(tmpDir, ".collab/config/multi-repo.json"),
    JSON.stringify({
      repos: {
        backend: { path: path.join(tmpDir, "repos/backend") },
        frontend: { path: path.join(tmpDir, "repos/frontend") },
      },
    })
  );

  // Write a minimal pipeline.json for each repo's .collab
  const pipeline = {
    version: "3.1",
    phases: {
      build: { command: "/collab.build", signals: ["BUILD_COMPLETE", "BUILD_ERROR"] },
      done: { terminal: true },
    },
  };
  for (const repo of ["backend", "frontend"]) {
    fs.mkdirSync(path.join(tmpDir, `repos/${repo}/.collab/config`), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, `repos/${repo}/.collab/config/pipeline.json`),
      JSON.stringify(pipeline)
    );
  }
});

afterAll(() => {
  delete process.env.COLLAB_REPOS_FILE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeCtx(ticketId: string): InitContext {
  return {
    ticketId,
    orchestratorPane: "%test-orch",
    repoRoot: tmpDir,
    registryDir: path.join(tmpDir, ".collab/state/pipeline-registry"),
    groupsDir: path.join(tmpDir, ".collab/state/pipeline-groups"),
    configPath: path.join(tmpDir, ".collab/config/pipeline.json"),
    schemaPath: path.join(tmpDir, ".collab/config/pipeline.v3.schema.json"),
  };
}

// ---------------------------------------------------------------------------
// 2-ticket multi-repo scenario
// ---------------------------------------------------------------------------

describe("multi-repo integration: 2 tickets across 2 repos", () => {
  test("1. resolvePaths() for backend ticket uses backend repo path", () => {
    const ctx = makeCtx("INT-BACKEND-001");
    const specDir = path.join(tmpDir, "specs", "int-backend-001");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "INT-BACKEND-001", repo_id: "backend" })
    );

    const result = resolvePaths(ctx);
    expect(result.repoId).toBe("backend");
    expect(result.repoPath).toBe(path.join(tmpDir, "repos/backend"));
    expect(result.spawnCmd).toContain(path.join(tmpDir, "repos/backend"));

    fs.rmSync(specDir, { recursive: true });
  });

  test("2. resolvePaths() for frontend ticket uses frontend repo path", () => {
    const ctx = makeCtx("INT-FRONTEND-001");
    const specDir = path.join(tmpDir, "specs", "int-frontend-001");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "INT-FRONTEND-001", repo_id: "frontend" })
    );

    const result = resolvePaths(ctx);
    expect(result.repoId).toBe("frontend");
    expect(result.repoPath).toBe(path.join(tmpDir, "repos/frontend"));

    fs.rmSync(specDir, { recursive: true });
  });

  test("3. validateSignal uses per-repo pipeline when registry has repo_path", () => {
    const backendPipeline = {
      version: "3.1",
      phases: [{ id: "build", signals: ["BUILD_COMPLETE", "BUILD_ERROR"] }],
      transitions: [],
    };
    const registry = {
      ticket_id: "INT-BACKEND-001",
      nonce: "be01",
      current_step: "build",
      status: "running",
      repo_path: path.join(tmpDir, "repos/backend"),
    };
    const parsed: ParsedSignal = {
      ticketId: "INT-BACKEND-001",
      nonce: "be01",
      signalType: "BUILD_COMPLETE",
      detail: "Backend built",
    };

    const result = validateSignal(parsed, registry, backendPipeline);
    expect(result.valid).toBe(true);
  });

  test("4. status-table shows Repo column for both tickets", () => {
    const registryDir = path.join(tmpDir, ".collab/state/pipeline-registry");
    const groupsDir = path.join(tmpDir, ".collab/state/pipeline-groups");
    const multiRepoPath = path.join(tmpDir, ".collab/config/multi-repo.json");

    // Write two registry entries
    fs.writeFileSync(
      path.join(registryDir, "INT-BACKEND-001.json"),
      JSON.stringify({
        ticket_id: "INT-BACKEND-001",
        current_step: "build",
        repo_id: "backend",
        nonce: "be01",
      })
    );
    fs.writeFileSync(
      path.join(registryDir, "INT-FRONTEND-001.json"),
      JSON.stringify({
        ticket_id: "INT-FRONTEND-001",
        current_step: "build",
        repo_id: "frontend",
        nonce: "fe01",
      })
    );

    const table = renderTable(registryDir, groupsDir, { multiRepoConfigPath: multiRepoPath });
    expect(table).toContain("Repo");
    expect(table).toContain("backend");
    expect(table).toContain("frontend");
    // Ticket IDs are truncated to COL_TICKET=13 chars in the table
    expect(table).toContain("INT-BACKEND-0"); // "INT-BACKEND-001" truncated
    expect(table).toContain("INT-FRONTEND-"); // "INT-FRONTEND-001" truncated

    fs.unlinkSync(path.join(registryDir, "INT-BACKEND-001.json"));
    fs.unlinkSync(path.join(registryDir, "INT-FRONTEND-001.json"));
  });

  test("5. buildAdjacency with 2 specsDirs finds coordination.json in either", () => {
    const specsA = path.join(tmpDir, "specs-a");
    const specsB = path.join(tmpDir, "specs-b");
    fs.mkdirSync(path.join(specsA, "BRE-ALPHA"), { recursive: true });
    fs.mkdirSync(path.join(specsB, "BRE-BETA"), { recursive: true });

    // BRE-ALPHA (in specsA) depends on BRE-BETA (in specsB)
    fs.writeFileSync(
      path.join(specsA, "BRE-ALPHA", "coordination.json"),
      JSON.stringify({ wait_for: [{ id: "BRE-BETA", phase: "build" }] })
    );

    const { adjacency, errors } = buildAdjacency(["BRE-ALPHA", "BRE-BETA"], [specsA, specsB]);
    expect(errors).toHaveLength(0);
    expect(adjacency.get("BRE-ALPHA")).toContain("BRE-BETA");
    expect(adjacency.get("BRE-BETA")).toEqual([]);

    fs.rmSync(specsA, { recursive: true });
    fs.rmSync(specsB, { recursive: true });
  });
});
