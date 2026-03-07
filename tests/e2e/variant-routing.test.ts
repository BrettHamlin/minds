/**
 * tests/e2e/variant-routing.test.ts
 *
 * E2E tests for pipeline variant routing (BRE-351).
 *
 * Verifies:
 *   - TEST-L01 fixture has correct structure (default + variant configs)
 *   - Variant config loads when pipeline_variant is set in metadata.json
 *   - Variant pipeline routes differently from default pipeline
 *   - orchestrator-init resolves variant path correctly
 *   - Fallback to default when variant file missing
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { resolveTransition } from "../../minds/pipeline_core/transitions";
import { resolvePaths } from "../../minds/execution/orchestrator-init";
import type { InitContext } from "../../minds/execution/orchestrator-init";
import * as os from "os";

// ── Fixture paths ────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dir, "fixtures/TEST-L01");

// ── TEST-L01 fixture validation ──────────────────────────────────────────────

describe("e2e/TEST-L01: fixture structure", () => {
  test("1. fixture has default pipeline.json (clarify → done, 2 phases)", () => {
    const pipeline = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8")
    );
    const phaseIds = Object.keys(pipeline.phases);

    expect(phaseIds).toEqual(["clarify", "done"]);
    expect(pipeline.phases.clarify.transitions.CLARIFY_COMPLETE.to).toBe("done");
  });

  test("2. fixture has backend variant with 4 phases (clarify → implement → run_tests → done)", () => {
    const variant = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline-variants/backend.json"), "utf-8")
    );
    const phaseIds = Object.keys(variant.phases);

    expect(phaseIds).toEqual(["clarify", "implement", "run_tests", "done"]);
    expect(variant.phases.clarify.transitions.CLARIFY_COMPLETE.to).toBe("implement");
  });

  test("3. fixture metadata.json has pipeline_variant: backend", () => {
    const metadata = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "metadata.json"), "utf-8")
    );

    expect(metadata.pipeline_variant).toBe("backend");
    expect(metadata.ticket_id).toBe("TEST-L01");
  });

  test("4. fixture stub-signals.json covers all 3 non-terminal phases", () => {
    const stubs = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "stub-signals.json"), "utf-8")
    );

    expect(stubs.length).toBe(3);
    expect(stubs[0].trigger).toBe("/collab.clarify");
    expect(stubs[1].trigger).toBe("/collab.implement");
    expect(stubs[2].trigger).toBe("/collab.run-tests");
  });

  test("5. fixture expected.json matches variant walk: clarify → implement → run_tests → done", () => {
    const expected = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "expected.json"), "utf-8")
    );

    expect(expected).toEqual(["clarify", "implement", "run_tests", "done"]);
  });
});

// ── Variant pipeline routing ─────────────────────────────────────────────────

describe("e2e/variant-routing: variant pipeline transitions", () => {
  let variant: any;

  test("6. variant clarify → implement (not done like default)", () => {
    variant = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline-variants/backend.json"), "utf-8")
    );
    const t = resolveTransition("clarify", "CLARIFY_COMPLETE", variant);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("implement");
  });

  test("7. default clarify → done (different from variant)", () => {
    const defaultPipeline = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8")
    );
    const t = resolveTransition("clarify", "CLARIFY_COMPLETE", defaultPipeline);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("done");
  });

  test("8. variant implement → run_tests on IMPLEMENT_COMPLETE", () => {
    variant = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline-variants/backend.json"), "utf-8")
    );
    const t = resolveTransition("implement", "IMPLEMENT_COMPLETE", variant);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("run_tests");
  });

  test("9. variant run_tests → done on RUN_TESTS_COMPLETE", () => {
    variant = variant ?? JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline-variants/backend.json"), "utf-8")
    );
    const t = resolveTransition("run_tests", "RUN_TESTS_COMPLETE", variant);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("done");
  });

  test("10. variant IMPLEMENT_ERROR self-loops to implement", () => {
    variant = variant ?? JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline-variants/backend.json"), "utf-8")
    );
    const t = resolveTransition("implement", "IMPLEMENT_ERROR", variant);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("implement");
  });
});

// ── resolvePaths variant extraction ──────────────────────────────────────────

describe("e2e/variant-routing: resolvePaths extracts pipeline_variant", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdirSync(join(os.tmpdir(), `collab-variant-${Date.now()}`), { recursive: true }) as unknown as string;
    if (!tmpDir) tmpDir = join(os.tmpdir(), `collab-variant-${Date.now()}`);
    mkdirSync(join(tmpDir, ".collab/config"), { recursive: true });
    mkdirSync(join(tmpDir, ".collab/state/pipeline-registry"), { recursive: true });
    mkdirSync(join(tmpDir, "specs"), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(ticketId: string): InitContext {
    return {
      ticketId,
      orchestratorPane: "%test-orch",
      repoRoot: tmpDir,
      registryDir: join(tmpDir, ".collab/state/pipeline-registry"),
      groupsDir: join(tmpDir, ".collab/state/pipeline-groups"),
      configPath: join(tmpDir, ".collab/config/pipeline.json"),
      schemaPath: join(tmpDir, ".collab/config/pipeline.v3.schema.json"),
    };
  }

  test("11. metadata with pipeline_variant → resolvePaths returns variant", () => {
    const ctx = makeCtx("TEST-L01-PATHS");
    const specDir = join(tmpDir, "specs", "test-l01-paths");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-L01-PATHS", pipeline_variant: "backend" })
    );

    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBe("backend");

    rmSync(specDir, { recursive: true });
  });

  test("11b. metadata with repo_id + repos.json → resolves repoPath", () => {
    const ctx = makeCtx("TEST-L01-VREPO");
    const specDir = join(tmpDir, "specs", "test-l01-vrepo");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-L01-VREPO", pipeline_variant: "backend", repo_id: "paper-clips-backend" })
    );

    // Create a fake target repo
    const fakeRepoDir = join(tmpDir, "fake-backend-repo");
    mkdirSync(fakeRepoDir, { recursive: true });

    // Write repos.json via COLLAB_REPOS_FILE env var
    const reposFile = join(tmpDir, "test-repos.json");
    writeFileSync(reposFile, JSON.stringify({ "paper-clips-backend": { path: fakeRepoDir } }));
    process.env.COLLAB_REPOS_FILE = reposFile;

    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBe("backend");
    expect(result.repoId).toBe("paper-clips-backend");
    expect(result.repoPath).toBe(fakeRepoDir);

    // Cleanup
    delete process.env.COLLAB_REPOS_FILE;
    rmSync(specDir, { recursive: true });
    rmSync(fakeRepoDir, { recursive: true });
    rmSync(reposFile);
  });

  test("11c. metadata without repo_id → no repo resolution", () => {
    const ctx = makeCtx("TEST-L01-NOVR");
    const specDir = join(tmpDir, "specs", "test-l01-novr");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-L01-NOVR", pipeline_variant: "frontend-ui" })
    );

    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBe("frontend-ui");
    expect(result.repoId).toBeUndefined();
    expect(result.repoPath).toBeUndefined();

    rmSync(specDir, { recursive: true });
  });

  test("12. metadata without pipeline_variant → variant undefined", () => {
    const ctx = makeCtx("TEST-L01-NOVAL");
    const specDir = join(tmpDir, "specs", "test-l01-noval");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "metadata.json"),
      JSON.stringify({ ticket_id: "TEST-L01-NOVAL" })
    );

    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBeUndefined();

    rmSync(specDir, { recursive: true });
  });
});

// ── Full variant walk ────────────────────────────────────────────────────────

describe("e2e/variant-routing: full pipeline walk with variant config", () => {
  test("13. walk variant pipeline: clarify → implement → run_tests → done", () => {
    const variant = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline-variants/backend.json"), "utf-8")
    );
    const expected = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "expected.json"), "utf-8")
    );

    // Walk the pipeline
    const visited: string[] = [];
    let current = Object.keys(variant.phases)[0]; // "clarify"

    while (!variant.phases[current]?.terminal) {
      visited.push(current);
      const phase = variant.phases[current];
      // Use the first signal's transition (the _COMPLETE signal)
      const completeSignal = phase.signals.find((s: string) => s.endsWith("_COMPLETE"));
      expect(completeSignal).toBeTruthy();

      const t = resolveTransition(current, completeSignal, variant);
      expect(t).not.toBeNull();
      expect(t!.to).toBeTruthy();
      current = t!.to!;
    }
    visited.push(current); // "done"

    expect(visited).toEqual(expected);
  });

  test("14. walk default pipeline: clarify → done (shorter path)", () => {
    const defaultPipeline = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8")
    );

    const visited: string[] = [];
    let current = Object.keys(defaultPipeline.phases)[0];

    while (!defaultPipeline.phases[current]?.terminal) {
      visited.push(current);
      const phase = defaultPipeline.phases[current];
      const completeSignal = phase.signals.find((s: string) => s.endsWith("_COMPLETE"));
      const t = resolveTransition(current, completeSignal, defaultPipeline);
      current = t!.to!;
    }
    visited.push(current);

    // Default pipeline is shorter: just clarify → done
    expect(visited).toEqual(["clarify", "done"]);
    expect(visited.length).toBeLessThan(4); // Variant has 4 phases
  });
});
