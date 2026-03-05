import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolvePipelineConfigPath, parsePipelineArgs, loadPipelineForTicket, writeJsonAtomic } from "./utils";

// ============================================================================
// resolvePipelineConfigPath
// ============================================================================

describe("resolvePipelineConfigPath", () => {
  let tmpDir: string;
  let collabConfigDir: string;
  let variantsDir: string;
  let registryDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-utils-"));
    collabConfigDir = path.join(tmpDir, ".collab", "config");
    variantsDir = path.join(collabConfigDir, "pipeline-variants");
    registryDir = path.join(tmpDir, ".collab", "state", "pipeline-registry");
    fs.mkdirSync(variantsDir, { recursive: true });
    fs.mkdirSync(registryDir, { recursive: true });

    // Create default pipeline.json
    fs.writeFileSync(
      path.join(collabConfigDir, "pipeline.json"),
      JSON.stringify({ version: "3.1", phases: {}, id: "default" })
    );

    // Create a variant config file
    fs.writeFileSync(
      path.join(variantsDir, "fast.json"),
      JSON.stringify({ version: "3.1", phases: {}, id: "fast" })
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("1. no options → returns default pipeline.json path", () => {
    const result = resolvePipelineConfigPath(tmpDir);
    expect(result).toBe(path.join(tmpDir, ".collab", "config", "pipeline.json"));
  });

  test("2. explicit variant that exists → returns variant path", () => {
    const result = resolvePipelineConfigPath(tmpDir, { variant: "fast" });
    expect(result).toBe(path.join(variantsDir, "fast.json"));
  });

  test("3. explicit variant that does NOT exist → falls back to pipeline.json", () => {
    const result = resolvePipelineConfigPath(tmpDir, { variant: "nonexistent" });
    expect(result).toBe(path.join(tmpDir, ".collab", "config", "pipeline.json"));
  });

  test("4. ticketId with pipeline_variant in registry → returns variant path", () => {
    // Write a registry entry with pipeline_variant set
    writeJsonAtomic(path.join(registryDir, "BRE-999.json"), {
      ticket_id: "BRE-999",
      pipeline_variant: "fast",
      current_step: "clarify",
    });

    const result = resolvePipelineConfigPath(tmpDir, {
      ticketId: "BRE-999",
      registryDir,
    });
    expect(result).toBe(path.join(variantsDir, "fast.json"));
  });

  test("5. ticketId with no pipeline_variant in registry → returns default pipeline.json", () => {
    writeJsonAtomic(path.join(registryDir, "BRE-1000.json"), {
      ticket_id: "BRE-1000",
      current_step: "clarify",
    });

    const result = resolvePipelineConfigPath(tmpDir, {
      ticketId: "BRE-1000",
      registryDir,
    });
    expect(result).toBe(path.join(tmpDir, ".collab", "config", "pipeline.json"));
  });

  test("6. ticketId but registry file missing → returns default pipeline.json", () => {
    const result = resolvePipelineConfigPath(tmpDir, {
      ticketId: "BRE-MISSING",
      registryDir,
    });
    expect(result).toBe(path.join(tmpDir, ".collab", "config", "pipeline.json"));
  });

  test("7. explicit variant overrides pipeline_variant from registry", () => {
    // Registry says 'fast', explicit flag says 'nonexistent' → falls back to default
    // (variant flag takes precedence over registry; file doesn't exist → default)
    const result = resolvePipelineConfigPath(tmpDir, {
      variant: "nonexistent",
      ticketId: "BRE-999",
      registryDir,
    });
    expect(result).toBe(path.join(tmpDir, ".collab", "config", "pipeline.json"));
  });

  test("8. explicit variant flag 'fast' overrides registry with different variant", () => {
    // Write a registry with a different variant
    writeJsonAtomic(path.join(registryDir, "BRE-2000.json"), {
      ticket_id: "BRE-2000",
      pipeline_variant: "other-variant",
    });
    // 'fast' variant exists, should win over registry 'other-variant'
    const result = resolvePipelineConfigPath(tmpDir, {
      variant: "fast",
      ticketId: "BRE-2000",
      registryDir,
    });
    expect(result).toBe(path.join(variantsDir, "fast.json"));
  });

  test("9. ticketId without registryDir → skips registry lookup, returns default", () => {
    const result = resolvePipelineConfigPath(tmpDir, {
      ticketId: "BRE-999",
      // registryDir intentionally omitted
    });
    expect(result).toBe(path.join(tmpDir, ".collab", "config", "pipeline.json"));
  });

});

// ============================================================================
// loadPipelineForTicket
// ============================================================================

describe("loadPipelineForTicket", () => {
  let tmpDir: string;
  let variantsDir: string;
  let registryDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-load-"));
    const collabConfigDir = path.join(tmpDir, ".collab", "config");
    variantsDir = path.join(collabConfigDir, "pipeline-variants");
    registryDir = path.join(tmpDir, ".collab", "state", "pipeline-registry");
    fs.mkdirSync(variantsDir, { recursive: true });
    fs.mkdirSync(registryDir, { recursive: true });

    // Default pipeline.json (no spec_critique phase)
    fs.writeFileSync(
      path.join(collabConfigDir, "pipeline.json"),
      JSON.stringify({ version: "3.1", phases: { clarify: {}, plan: {}, done: { terminal: true } } })
    );

    // Variant with spec_critique
    fs.writeFileSync(
      path.join(variantsDir, "backend.json"),
      JSON.stringify({ version: "3.1", phases: { clarify: {}, spec_critique: {}, plan: {}, done: { terminal: true } } })
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("1. loads variant config from registry pipeline_variant", () => {
    writeJsonAtomic(path.join(registryDir, "BRE-500.json"), {
      ticket_id: "BRE-500",
      pipeline_variant: "backend",
      current_step: "clarify",
    });

    const { pipeline, variant, configPath } = loadPipelineForTicket(tmpDir, "BRE-500");
    expect(variant).toBe("backend");
    expect(configPath).toBe(path.join(variantsDir, "backend.json"));
    expect(pipeline.phases.spec_critique).toBeDefined();
  });

  test("2. falls back to default when no registry exists", () => {
    const { pipeline, variant } = loadPipelineForTicket(tmpDir, "BRE-MISSING");
    expect(variant).toBeUndefined();
    expect(pipeline.phases.spec_critique).toBeUndefined();
    expect(pipeline.phases.clarify).toBeDefined();
  });

  test("3. falls back to default when registry has no pipeline_variant", () => {
    writeJsonAtomic(path.join(registryDir, "BRE-501.json"), {
      ticket_id: "BRE-501",
      current_step: "clarify",
    });

    const { variant } = loadPipelineForTicket(tmpDir, "BRE-501");
    expect(variant).toBeUndefined();
  });

  test("4. uses repo_path from registry for multi-repo", () => {
    // Create a separate "repo" with its own variant config
    const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), "collab-other-"));
    const otherVariantsDir = path.join(otherRepo, ".collab", "config", "pipeline-variants");
    const otherConfigDir = path.join(otherRepo, ".collab", "config");
    fs.mkdirSync(otherVariantsDir, { recursive: true });
    fs.writeFileSync(
      path.join(otherConfigDir, "pipeline.json"),
      JSON.stringify({ version: "3.1", phases: { other: {} } })
    );
    fs.writeFileSync(
      path.join(otherVariantsDir, "frontend.json"),
      JSON.stringify({ version: "3.1", phases: { clarify: {}, visual_verify: {}, done: { terminal: true } } })
    );

    writeJsonAtomic(path.join(registryDir, "BRE-502.json"), {
      ticket_id: "BRE-502",
      pipeline_variant: "frontend",
      repo_path: otherRepo,
      current_step: "clarify",
    });

    const { pipeline, configPath } = loadPipelineForTicket(tmpDir, "BRE-502");
    expect(configPath).toBe(path.join(otherVariantsDir, "frontend.json"));
    expect(pipeline.phases.visual_verify).toBeDefined();

    fs.rmSync(otherRepo, { recursive: true, force: true });
  });
});

// ============================================================================
// parsePipelineArgs
// ============================================================================

describe("parsePipelineArgs", () => {
  test("1. extracts --pipeline and --ticket flags", () => {
    const result = parsePipelineArgs(["--pipeline", "backend", "--ticket", "BRE-100"]);
    expect(result).toEqual({ variant: "backend", ticketId: "BRE-100" });
  });

  test("2. returns undefined for missing flags", () => {
    const result = parsePipelineArgs(["--first"]);
    expect(result).toEqual({ variant: undefined, ticketId: undefined });
  });

  test("3. handles --pipeline without value", () => {
    const result = parsePipelineArgs(["--pipeline"]);
    expect(result).toEqual({ variant: undefined, ticketId: undefined });
  });

  test("4. ignores other args", () => {
    const result = parsePipelineArgs(["clarify", "CLARIFY_COMPLETE", "--pipeline", "frontend-ui", "--plain"]);
    expect(result).toEqual({ variant: "frontend-ui", ticketId: undefined });
  });
});
