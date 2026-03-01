import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  validateSchema,
  resolvePaths,
  setupSymlinks,
} from "./orchestrator-init";
import type { InitContext } from "./orchestrator-init";

// Note: Full orchestrator-init integration requires a live tmux session.
// These tests cover the pure/file-I/O steps without spawning panes.

let tmpDir: string;
let repoRoot: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-init-"));
  repoRoot = tmpDir;

  // Create minimal directory structure
  fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".collab/state/pipeline-registry"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".collab/state/pipeline-groups"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "specs"), { recursive: true });
});

afterAll(() => {
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

describe("orchestrator-init: validateSchema()", () => {
  test("1. throws FILE_NOT_FOUND when schema file missing", () => {
    const ctx = makeCtx("TEST-INIT-001");
    expect(() => validateSchema(ctx)).toThrow("Schema file not found");
  });

  test("2. throws FILE_NOT_FOUND when pipeline.json missing", () => {
    const ctx = makeCtx("TEST-INIT-001");
    // Create schema but not pipeline.json
    fs.writeFileSync(ctx.schemaPath, "{}");
    expect(() => validateSchema(ctx)).toThrow("Pipeline config not found");
    fs.unlinkSync(ctx.schemaPath);
  });
});

describe("orchestrator-init: resolvePaths()", () => {
  test("3. no metadata.json → no worktree path, uses current dir", () => {
    const ctx = makeCtx("TEST-INIT-002");
    // No specs/*/metadata.json for this ticket
    const result = resolvePaths(ctx);
    expect(result.worktreePath).toBeNull();
    expect(result.spawnCmd).toContain("claude --dangerously-skip-permissions");
  });

  test("4. metadata.json with valid worktree → resolves path", () => {
    const ctx = makeCtx("TEST-INIT-003");
    const worktreePath = path.join(tmpDir, "worktrees", "test-init-003");
    fs.mkdirSync(worktreePath, { recursive: true });

    const specDir = path.join(tmpDir, "specs", "test-init-003");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-003", worktree_path: worktreePath })
    );

    const result = resolvePaths(ctx);
    expect(result.worktreePath).toBe(worktreePath);
    expect(result.spawnCmd).toContain(worktreePath);

    fs.rmSync(worktreePath, { recursive: true });
    fs.rmSync(specDir, { recursive: true });
  });

  test("5. metadata.json with non-existent worktree → throws FILE_NOT_FOUND", () => {
    const ctx = makeCtx("TEST-INIT-004");
    const specDir = path.join(tmpDir, "specs", "test-init-004");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-004", worktree_path: "/nonexistent/path/xyz" })
    );

    expect(() => resolvePaths(ctx)).toThrow("does not exist");
    fs.rmSync(specDir, { recursive: true });
  });
});

describe("orchestrator-init: setupSymlinks()", () => {
  test("6. creates .claude and .collab symlinks in worktree", () => {
    const worktreePath = path.join(tmpDir, "worktrees", "symlink-test");
    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".collab"), { recursive: true });

    const rb = {};
    setupSymlinks(worktreePath, tmpDir, rb);

    expect(fs.lstatSync(path.join(worktreePath, ".claude")).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(worktreePath, ".collab")).isSymbolicLink()).toBe(true);

    fs.rmSync(worktreePath, { recursive: true });
  });

  test("7. no-op when worktreePath is null", () => {
    const rb = {};
    // Should not throw
    expect(() => setupSymlinks(null, tmpDir, rb)).not.toThrow();
  });
});
