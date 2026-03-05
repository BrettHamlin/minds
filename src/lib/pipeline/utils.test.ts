import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolvePipelineConfigPath, parsePipelineArgs, loadPipelineForTicket, writeJsonAtomic, readFeatureMetadata, findFeatureDir } from "./utils";

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

// ============================================================================
// readFeatureMetadata
// ============================================================================

describe("readFeatureMetadata", () => {
  let tmpDir: string;
  let specsDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-metadata-"));
    specsDir = path.join(tmpDir, "specs");
    fs.mkdirSync(specsDir, { recursive: true });

    // Feature dir named after ticket ID (Pass 1 match)
    const dir1 = path.join(specsDir, "BRE-100-my-feature");
    fs.mkdirSync(dir1);
    fs.writeFileSync(
      path.join(dir1, "metadata.json"),
      JSON.stringify({ ticket_id: "BRE-100", branch_name: "bre-100-my-feature" })
    );

    // Feature dir named differently (Pass 2 match by ticket_id field)
    const dir2 = path.join(specsDir, "001-another-feature");
    fs.mkdirSync(dir2);
    fs.writeFileSync(
      path.join(dir2, "metadata.json"),
      JSON.stringify({ ticket_id: "BRE-200", branch_name: "001-another-feature" })
    );

    // Feature dir with legacy "pipeline" key (normalization test)
    const dir3 = path.join(specsDir, "BRE-300-pipeline-key");
    fs.mkdirSync(dir3);
    fs.writeFileSync(
      path.join(dir3, "metadata.json"),
      JSON.stringify({ ticket_id: "BRE-300", pipeline: "backend" })
    );

    // Feature dir with both "pipeline" and "pipeline_variant" (pipeline_variant wins)
    const dir4 = path.join(specsDir, "BRE-400-both-keys");
    fs.mkdirSync(dir4);
    fs.writeFileSync(
      path.join(dir4, "metadata.json"),
      JSON.stringify({ ticket_id: "BRE-400", pipeline: "frontend", pipeline_variant: "backend" })
    );

    // Feature dir with no metadata.json
    const dir5 = path.join(specsDir, "BRE-500-no-metadata");
    fs.mkdirSync(dir5);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("1. found by dir name (Pass 1)", () => {
    const result = readFeatureMetadata(specsDir, "BRE-100");
    expect(result).not.toBeNull();
    expect(result!.ticket_id).toBe("BRE-100");
    expect(result!.branch_name).toBe("bre-100-my-feature");
  });

  test("2. found by metadata.json ticket_id (Pass 2)", () => {
    const result = readFeatureMetadata(specsDir, "BRE-200");
    expect(result).not.toBeNull();
    expect(result!.ticket_id).toBe("BRE-200");
    expect(result!.branch_name).toBe("001-another-feature");
  });

  test("3. pipeline key normalized to pipeline_variant", () => {
    const result = readFeatureMetadata(specsDir, "BRE-300");
    expect(result).not.toBeNull();
    expect(result!.pipeline_variant).toBe("backend");
  });

  test("4. pipeline_variant wins over pipeline when both present", () => {
    const result = readFeatureMetadata(specsDir, "BRE-400");
    expect(result).not.toBeNull();
    expect(result!.pipeline_variant).toBe("backend");
  });

  test("5. missing metadata.json returns null", () => {
    const result = readFeatureMetadata(specsDir, "BRE-500");
    expect(result).toBeNull();
  });

  test("6. missing specs dir returns null", () => {
    const result = readFeatureMetadata(path.join(tmpDir, "nonexistent"), "BRE-100");
    expect(result).toBeNull();
  });

  test("7. unknown ticket ID returns null", () => {
    const result = readFeatureMetadata(specsDir, "BRE-UNKNOWN");
    expect(result).toBeNull();
  });
});

// ============================================================================
// findFeatureDir (branch option)
// ============================================================================

describe("findFeatureDir with branch option", () => {
  let tmpDir: string;
  let specsDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-findfeaturedir-"));
    specsDir = path.join(tmpDir, "specs");
    fs.mkdirSync(specsDir, { recursive: true });

    // Exact branch name match: specs/001-exact-branch
    fs.mkdirSync(path.join(specsDir, "001-exact-branch"));

    // Prefix match: specs/002-other-name (dir doesn't start with branch name)
    fs.mkdirSync(path.join(specsDir, "002-other-name"));

    // TicketId match: specs/BRE-300-ticket-feature
    fs.mkdirSync(path.join(specsDir, "BRE-300-ticket-feature"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("1. exact branch match (Pass 0a)", () => {
    const result = findFeatureDir(tmpDir, "BRE-100", { branch: "001-exact-branch" });
    expect(result).toBe(path.join(specsDir, "001-exact-branch"));
  });

  test("2. branch numeric prefix match (Pass 0b)", () => {
    const result = findFeatureDir(tmpDir, "BRE-200", { branch: "002-something-else" });
    expect(result).toBe(path.join(specsDir, "002-other-name"));
  });

  test("3. falls through to ticketId match when branch doesn't match (Pass 1)", () => {
    const result = findFeatureDir(tmpDir, "BRE-300", { branch: "999-nonexistent" });
    expect(result).toBe(path.join(specsDir, "BRE-300-ticket-feature"));
  });

  test("4. returns null when nothing matches", () => {
    const result = findFeatureDir(tmpDir, "BRE-MISSING", { branch: "999-also-missing" });
    expect(result).toBeNull();
  });
});
