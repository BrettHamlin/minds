import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  validateSchema,
  resolvePaths,
  setupSymlinks,
  createRegistry,
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

describe("orchestrator-init: resolvePaths() multi-repo", () => {
  test("8. multi-repo.json + metadata repo_id → spawnCmd uses repo path", () => {
    const ctx = makeCtx("TEST-INIT-MR-001");
    const targetRepo = path.join(tmpDir, "repos", "backend");
    fs.mkdirSync(targetRepo, { recursive: true });

    // Write multi-repo.json
    const multiRepoPath = path.join(tmpDir, ".collab", "config", "multi-repo.json");
    fs.writeFileSync(multiRepoPath, JSON.stringify({ repos: { backend: { path: targetRepo } } }));

    // Write metadata.json with repo_id
    const specDir = path.join(tmpDir, "specs", "test-init-mr-001");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-MR-001", repo_id: "backend" })
    );

    const result = resolvePaths(ctx);
    expect(result.repoId).toBe("backend");
    expect(result.repoPath).toBe(targetRepo);
    expect(result.spawnCmd).toContain(targetRepo);

    fs.unlinkSync(multiRepoPath);
    fs.rmSync(specDir, { recursive: true });
    fs.rmSync(targetRepo, { recursive: true });
  });

  test("9. repo_id not in multi-repo.json → throws VALIDATION error", () => {
    const ctx = makeCtx("TEST-INIT-MR-002");

    const multiRepoPath = path.join(tmpDir, ".collab", "config", "multi-repo.json");
    fs.writeFileSync(multiRepoPath, JSON.stringify({ repos: { frontend: { path: "/some/path" } } }));

    const specDir = path.join(tmpDir, "specs", "test-init-mr-002");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-MR-002", repo_id: "backend" })
    );

    expect(() => resolvePaths(ctx)).toThrow("not found in multi-repo.json");

    fs.unlinkSync(multiRepoPath);
    fs.rmSync(specDir, { recursive: true });
  });

  test("10. multi-repo path does not exist → throws FILE_NOT_FOUND", () => {
    const ctx = makeCtx("TEST-INIT-MR-003");

    const multiRepoPath = path.join(tmpDir, ".collab", "config", "multi-repo.json");
    fs.writeFileSync(
      multiRepoPath,
      JSON.stringify({ repos: { backend: { path: "/nonexistent/repo/xyz" } } })
    );

    const specDir = path.join(tmpDir, "specs", "test-init-mr-003");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-MR-003", repo_id: "backend" })
    );

    expect(() => resolvePaths(ctx)).toThrow("does not exist");

    fs.unlinkSync(multiRepoPath);
    fs.rmSync(specDir, { recursive: true });
  });

  test("11. no multi-repo.json → repoId and repoPath are undefined", () => {
    const ctx = makeCtx("TEST-INIT-MR-004");
    // Ensure multi-repo.json doesn't exist
    const multiRepoPath = path.join(tmpDir, ".collab", "config", "multi-repo.json");
    if (fs.existsSync(multiRepoPath)) fs.unlinkSync(multiRepoPath);

    const result = resolvePaths(ctx);
    expect(result.repoId).toBeUndefined();
    expect(result.repoPath).toBeUndefined();
  });
});

describe("orchestrator-init: resolvePaths() pipeline variant", () => {
  test("12. metadata.json with pipeline_variant → returns variant", () => {
    const ctx = makeCtx("TEST-INIT-VAR-001");
    const specDir = path.join(tmpDir, "specs", "test-init-var-001");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-VAR-001", pipeline_variant: "backend" })
    );

    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBe("backend");

    fs.rmSync(specDir, { recursive: true });
  });

  test("13. metadata.json without pipeline_variant → variant is undefined", () => {
    const ctx = makeCtx("TEST-INIT-VAR-002");
    const specDir = path.join(tmpDir, "specs", "test-init-var-002");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-VAR-002" })
    );

    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBeUndefined();

    fs.rmSync(specDir, { recursive: true });
  });

  test("14. no metadata.json → variant is undefined", () => {
    const ctx = makeCtx("TEST-INIT-VAR-003");
    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBeUndefined();
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

describe("orchestrator-init: createRegistry() pipeline variant", () => {
  test("15. registry includes pipeline_variant when provided", () => {
    const ctx = makeCtx("TEST-REG-VAR-001");
    // Write a minimal pipeline.json so createRegistry can read first phase
    fs.writeFileSync(
      ctx.configPath,
      JSON.stringify({ version: "3.1", phases: { clarify: { terminal: false } } })
    );

    const rb = {};
    const { nonce, registryPath } = createRegistry(
      ctx, "%test-agent", rb, undefined, undefined, "backend"
    );

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.pipeline_variant).toBe("backend");
    expect(registry.ticket_id).toBe("TEST-REG-VAR-001");
    expect(nonce).toBeTruthy();

    // Cleanup
    fs.unlinkSync(registryPath);
    fs.unlinkSync(ctx.configPath);
  });

  test("16. registry omits pipeline_variant when not provided", () => {
    const ctx = makeCtx("TEST-REG-VAR-002");
    fs.writeFileSync(
      ctx.configPath,
      JSON.stringify({ version: "3.1", phases: { clarify: { terminal: false } } })
    );

    const rb = {};
    const { registryPath } = createRegistry(
      ctx, "%test-agent", rb, undefined, undefined
    );

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.pipeline_variant).toBeUndefined();

    fs.unlinkSync(registryPath);
    fs.unlinkSync(ctx.configPath);
  });
});
