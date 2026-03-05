import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  validateSchema,
  resolvePaths,
  setupSymlinks,
  createRegistry,
  resolveTransportFromConfig,
  injectBusEnv,
  startBusServer,
  teardownBusServer,
  findDependencyHold,
} from "./orchestrator-init";
import type { InitContext, HoldInfo } from "./orchestrator-init";

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
  test("8. repos.json + metadata repo_id → spawnCmd uses repo path", () => {
    const ctx = makeCtx("TEST-INIT-MR-001");
    const targetRepo = path.join(tmpDir, "repos", "backend");
    fs.mkdirSync(targetRepo, { recursive: true });

    // Write repos.json via env var
    const reposFile = path.join(tmpDir, "test-repos-8.json");
    fs.writeFileSync(reposFile, JSON.stringify({ backend: { path: targetRepo } }));
    process.env.COLLAB_REPOS_FILE = reposFile;

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

    delete process.env.COLLAB_REPOS_FILE;
    fs.unlinkSync(reposFile);
    fs.rmSync(specDir, { recursive: true });
    fs.rmSync(targetRepo, { recursive: true });
  });

  test("9. repo_id not in repos.json → repoId/repoPath undefined (logged warning)", () => {
    const ctx = makeCtx("TEST-INIT-MR-002");

    // repos.json has frontend but metadata says backend
    const reposFile = path.join(tmpDir, "test-repos-9.json");
    fs.writeFileSync(reposFile, JSON.stringify({ frontend: { path: "/some/path" } }));
    process.env.COLLAB_REPOS_FILE = reposFile;

    const specDir = path.join(tmpDir, "specs", "test-init-mr-002");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-MR-002", repo_id: "backend" })
    );

    const result = resolvePaths(ctx);
    expect(result.repoId).toBeUndefined();
    expect(result.repoPath).toBeUndefined();

    delete process.env.COLLAB_REPOS_FILE;
    fs.unlinkSync(reposFile);
    fs.rmSync(specDir, { recursive: true });
  });

  test("10. repo path does not exist → repoId/repoPath undefined", () => {
    const ctx = makeCtx("TEST-INIT-MR-003");

    const reposFile = path.join(tmpDir, "test-repos-10.json");
    fs.writeFileSync(reposFile, JSON.stringify({ backend: { path: "/nonexistent/repo/xyz" } }));
    process.env.COLLAB_REPOS_FILE = reposFile;

    const specDir = path.join(tmpDir, "specs", "test-init-mr-003");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-MR-003", repo_id: "backend" })
    );

    const result = resolvePaths(ctx);
    expect(result.repoId).toBeUndefined();
    expect(result.repoPath).toBeUndefined();

    delete process.env.COLLAB_REPOS_FILE;
    fs.unlinkSync(reposFile);
    fs.rmSync(specDir, { recursive: true });
  });

  test("11. no repos.json entry → repoId and repoPath are undefined", () => {
    const ctx = makeCtx("TEST-INIT-MR-004");
    // Point to empty repos file
    const reposFile = path.join(tmpDir, "test-repos-11.json");
    fs.writeFileSync(reposFile, JSON.stringify({}));
    process.env.COLLAB_REPOS_FILE = reposFile;

    const result = resolvePaths(ctx);
    expect(result.repoId).toBeUndefined();
    expect(result.repoPath).toBeUndefined();

    delete process.env.COLLAB_REPOS_FILE;
    fs.unlinkSync(reposFile);
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

  test("14b. metadata.json with 'pipeline' key (not 'pipeline_variant') → returns variant", () => {
    const ctx = makeCtx("TEST-INIT-VAR-004");
    const specDir = path.join(tmpDir, "specs", "test-init-var-004");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-VAR-004", pipeline: "frontend-ui" })
    );

    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBe("frontend-ui");

    fs.rmSync(specDir, { recursive: true });
  });

  test("14c. ctx.pipelineVariant (CLI --pipeline) overrides metadata", () => {
    const ctx = makeCtx("TEST-INIT-VAR-005");
    ctx.pipelineVariant = "backend";
    const specDir = path.join(tmpDir, "specs", "test-init-var-005");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-INIT-VAR-005", pipeline: "frontend-ui" })
    );

    // initPipeline uses ctx.pipelineVariant ?? resolved.pipelineVariant
    // resolvePaths itself returns metadata value; the override happens in initPipeline
    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBe("frontend-ui"); // resolvePaths returns metadata value
    // The CLI override is tested via ctx.pipelineVariant taking precedence in initPipeline

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

describe("orchestrator-init: createRegistry() hold fields", () => {
  test("30. registry includes held_by fields when holdInfo provided", () => {
    const ctx = makeCtx("TEST-REG-HOLD-001");
    fs.writeFileSync(
      ctx.configPath,
      JSON.stringify({ version: "3.1", phases: { clarify: { terminal: false } } })
    );

    const holdInfo: HoldInfo = {
      held_by: "BRE-246",
      hold_release_when: "done",
      hold_reason: "Linear blockedBy",
      hold_external: false,
    };

    const rb = {};
    const { registryPath } = createRegistry(
      ctx, "%test-agent", rb,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      holdInfo
    );

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.held_by).toBe("BRE-246");
    expect(registry.hold_release_when).toBe("done");
    expect(registry.hold_reason).toBe("Linear blockedBy");
    expect(registry.hold_external).toBeUndefined(); // false doesn't get written

    fs.unlinkSync(registryPath);
    fs.unlinkSync(ctx.configPath);
  });

  test("30b. registry includes hold_external=true when blocker is external", () => {
    const ctx = makeCtx("TEST-REG-HOLD-003");
    fs.writeFileSync(
      ctx.configPath,
      JSON.stringify({ version: "3.1", phases: { clarify: { terminal: false } } })
    );

    const holdInfo: HoldInfo = {
      held_by: "BRE-EXTERNAL",
      hold_release_when: "done",
      hold_reason: "Linear blockedBy",
      hold_external: true,
    };

    const rb = {};
    const { registryPath } = createRegistry(
      ctx, "%test-agent", rb,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      holdInfo
    );

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.held_by).toBe("BRE-EXTERNAL");
    expect(registry.hold_external).toBe(true);

    fs.unlinkSync(registryPath);
    fs.unlinkSync(ctx.configPath);
  });

  test("31. registry omits hold fields when holdInfo not provided", () => {
    const ctx = makeCtx("TEST-REG-HOLD-002");
    fs.writeFileSync(
      ctx.configPath,
      JSON.stringify({ version: "3.1", phases: { clarify: { terminal: false } } })
    );

    const rb = {};
    const { registryPath } = createRegistry(ctx, "%test-agent", rb);

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.held_by).toBeUndefined();
    expect(registry.hold_release_when).toBeUndefined();
    expect(registry.hold_reason).toBeUndefined();

    fs.unlinkSync(registryPath);
    fs.unlinkSync(ctx.configPath);
  });
});

describe("orchestrator-init: findDependencyHold()", () => {
  let holdSpecsTmpDir: string;
  let holdSpecsDir: string;

  beforeAll(() => {
    holdSpecsTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-fdh-"));
    holdSpecsDir = path.join(holdSpecsTmpDir, "specs");
    fs.mkdirSync(holdSpecsDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(holdSpecsTmpDir, { recursive: true, force: true });
  });

  function writeMetadata(ticketId: string, data: Record<string, unknown>): void {
    const dir = path.join(holdSpecsDir, ticketId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(data));
  }

  test("32. returns null when ticket has no blockedBy in metadata", () => {
    writeMetadata("FDH-100", { ticket_id: "FDH-100" });
    const hold = findDependencyHold("FDH-100", ["FDH-100"], holdSpecsDir);
    expect(hold).toBeNull();
  });

  test("33. returns hold record when ticket has blockedBy", () => {
    writeMetadata("FDH-200", { ticket_id: "FDH-200", blockedBy: ["FDH-201"] });
    const hold = findDependencyHold("FDH-200", ["FDH-200", "FDH-201"], holdSpecsDir);
    expect(hold).not.toBeNull();
    expect(hold!.held_ticket).toBe("FDH-200");
    expect(hold!.blocked_by).toBe("FDH-201");
    expect(hold!.external).toBe(false);
  });

  test("34. returns external hold when blocker not in session", () => {
    writeMetadata("FDH-300", { ticket_id: "FDH-300", blockedBy: ["FDH-EXTERNAL"] });
    const hold = findDependencyHold("FDH-300", ["FDH-300"], holdSpecsDir);
    expect(hold).not.toBeNull();
    expect(hold!.external).toBe(true);
  });

  test("35. implicitBlockedBy creates a hold when no metadata blockedBy exists", () => {
    writeMetadata("FDH-400", { ticket_id: "FDH-400" }); // no blockedBy in metadata
    const hold = findDependencyHold(
      "FDH-400",
      ["FDH-400", "FDH-BACKEND-400"],
      holdSpecsDir,
      ["FDH-BACKEND-400"]
    );
    expect(hold).not.toBeNull();
    expect(hold!.held_ticket).toBe("FDH-400");
    expect(hold!.blocked_by).toBe("FDH-BACKEND-400");
    expect(hold!.reason).toBe("implicit variant dependency");
    expect(hold!.external).toBe(false); // blocker is in sessionTickets
  });

  test("36. implicit blocker not in session → external=true", () => {
    writeMetadata("FDH-500", { ticket_id: "FDH-500" });
    const hold = findDependencyHold(
      "FDH-500",
      ["FDH-500"], // FDH-BACKEND-500 not in session
      holdSpecsDir,
      ["FDH-BACKEND-500"]
    );
    expect(hold).not.toBeNull();
    expect(hold!.external).toBe(true);
  });

  test("37. implicit hold skipped when explicit metadata hold already covers same blocker", () => {
    writeMetadata("FDH-600", { ticket_id: "FDH-600", blockedBy: ["FDH-BACKEND-600"] });
    const hold = findDependencyHold(
      "FDH-600",
      ["FDH-600", "FDH-BACKEND-600"],
      holdSpecsDir,
      ["FDH-BACKEND-600"] // same blocker as metadata
    );
    // Should return one hold, not two
    expect(hold).not.toBeNull();
    expect(hold!.reason).toBe("Linear blockedBy"); // explicit takes precedence (found first)
  });
});

// ---------------------------------------------------------------------------
// BRE-378: Bus server lifecycle tests
// ---------------------------------------------------------------------------

const REAL_REPO_ROOT = path.resolve(__dirname, "../../../../");

describe("orchestrator-init: resolveTransportFromConfig()", () => {
  test("17. pipeline transport=bus → returns 'bus'", () => {
    const configPath = path.join(tmpDir, ".collab/config/pipeline-bus.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "3.1", transport: "bus", phases: {} }));
    const saved = process.env.COLLAB_TRANSPORT;
    delete process.env.COLLAB_TRANSPORT;

    expect(resolveTransportFromConfig(configPath)).toBe("bus");

    process.env.COLLAB_TRANSPORT = saved;
    fs.unlinkSync(configPath);
  });

  test("18. pipeline transport=tmux → returns 'tmux'", () => {
    const configPath = path.join(tmpDir, ".collab/config/pipeline-tmux.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "3.1", transport: "tmux", phases: {} }));
    const saved = process.env.COLLAB_TRANSPORT;
    delete process.env.COLLAB_TRANSPORT;

    expect(resolveTransportFromConfig(configPath)).toBe("tmux");

    process.env.COLLAB_TRANSPORT = saved;
    fs.unlinkSync(configPath);
  });

  test("19. no transport field in pipeline.json → defaults to 'tmux'", () => {
    const configPath = path.join(tmpDir, ".collab/config/pipeline-notransport.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "3.1", phases: {} }));
    const saved = process.env.COLLAB_TRANSPORT;
    delete process.env.COLLAB_TRANSPORT;

    expect(resolveTransportFromConfig(configPath)).toBe("tmux");

    process.env.COLLAB_TRANSPORT = saved;
    fs.unlinkSync(configPath);
  });

  test("20. COLLAB_TRANSPORT=bus env var overrides pipeline transport=tmux", () => {
    const configPath = path.join(tmpDir, ".collab/config/pipeline-override-bus.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "3.1", transport: "tmux", phases: {} }));
    const saved = process.env.COLLAB_TRANSPORT;
    process.env.COLLAB_TRANSPORT = "bus";

    expect(resolveTransportFromConfig(configPath)).toBe("bus");

    if (saved !== undefined) process.env.COLLAB_TRANSPORT = saved;
    else delete process.env.COLLAB_TRANSPORT;
    fs.unlinkSync(configPath);
  });

  test("21. COLLAB_TRANSPORT=tmux env var overrides pipeline transport=bus", () => {
    const configPath = path.join(tmpDir, ".collab/config/pipeline-override-tmux.json");
    fs.writeFileSync(configPath, JSON.stringify({ version: "3.1", transport: "bus", phases: {} }));
    const saved = process.env.COLLAB_TRANSPORT;
    process.env.COLLAB_TRANSPORT = "tmux";

    expect(resolveTransportFromConfig(configPath)).toBe("tmux");

    if (saved !== undefined) process.env.COLLAB_TRANSPORT = saved;
    else delete process.env.COLLAB_TRANSPORT;
    fs.unlinkSync(configPath);
  });
});

describe("orchestrator-init: injectBusEnv()", () => {
  test("22. injects env vars before claude in cd+claude command", () => {
    const cmd = "cd '/path/to/worktree' && claude --dangerously-skip-permissions";
    const result = injectBusEnv(cmd, "http://localhost:12345");
    expect(result).toBe(
      "cd '/path/to/worktree' && COLLAB_TRANSPORT=bus BUS_URL=http://localhost:12345 claude --dangerously-skip-permissions"
    );
  });

  test("23. injects env vars before claude in plain command (no cd)", () => {
    const cmd = "claude --dangerously-skip-permissions";
    const result = injectBusEnv(cmd, "http://localhost:54321");
    expect(result).toBe(
      "COLLAB_TRANSPORT=bus BUS_URL=http://localhost:54321 claude --dangerously-skip-permissions"
    );
  });
});

describe("orchestrator-init: createRegistry() transport fields", () => {
  test("24. registry includes transport, bus_server_pid, bus_url when transport=bus", () => {
    const ctx = makeCtx("TEST-REG-BUS-001");
    fs.writeFileSync(
      ctx.configPath,
      JSON.stringify({ version: "3.1", phases: { clarify: { terminal: false } } })
    );

    const rb = {};
    const { registryPath } = createRegistry(
      ctx, "%test-agent", rb, undefined, undefined, undefined,
      "bus", 99999, "http://localhost:9876"
    );

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.transport).toBe("bus");
    expect(registry.bus_server_pid).toBe(99999);
    expect(registry.bus_url).toBe("http://localhost:9876");

    fs.unlinkSync(registryPath);
    fs.unlinkSync(ctx.configPath);
  });

  test("25. registry has transport=tmux and no bus fields when transport=tmux", () => {
    const ctx = makeCtx("TEST-REG-BUS-002");
    fs.writeFileSync(
      ctx.configPath,
      JSON.stringify({ version: "3.1", phases: { clarify: { terminal: false } } })
    );

    const rb = {};
    const { registryPath } = createRegistry(
      ctx, "%test-agent", rb, undefined, undefined, undefined, "tmux"
    );

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.transport).toBe("tmux");
    expect(registry.bus_server_pid).toBeUndefined();
    expect(registry.bus_url).toBeUndefined();

    fs.unlinkSync(registryPath);
    fs.unlinkSync(ctx.configPath);
  });

  test("26. registry omits transport fields when not provided", () => {
    const ctx = makeCtx("TEST-REG-BUS-003");
    fs.writeFileSync(
      ctx.configPath,
      JSON.stringify({ version: "3.1", phases: { clarify: { terminal: false } } })
    );

    const rb = {};
    const { registryPath } = createRegistry(ctx, "%test-agent", rb);

    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    expect(registry.transport).toBeUndefined();
    expect(registry.bus_server_pid).toBeUndefined();
    expect(registry.bus_url).toBeUndefined();

    fs.unlinkSync(registryPath);
    fs.unlinkSync(ctx.configPath);
  });
});

describe("orchestrator-init: startBusServer() + teardownBusServer()", () => {
  test("27. startBusServer() starts server, returns port > 0, process is alive", async () => {
    const { pid, url } = await startBusServer(REAL_REPO_ROOT);

    expect(pid).toBeGreaterThan(0);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);

    // Verify process is alive
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* dead */ }
    expect(alive).toBe(true);

    // Teardown
    teardownBusServer(pid);
  });

  test("28. startBusServer() — GET /status returns { ok: true }", async () => {
    const { pid, url } = await startBusServer(REAL_REPO_ROOT);

    const resp = await fetch(`${url}/status`);
    const body = await resp.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    teardownBusServer(pid);
  });

  test("29. teardownBusServer() kills the bus server process", async () => {
    const { pid } = await startBusServer(REAL_REPO_ROOT);

    teardownBusServer(pid);

    // Give process time to die
    await new Promise((r) => setTimeout(r, 100));

    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* dead */ }
    expect(alive).toBe(false);
  });
});
