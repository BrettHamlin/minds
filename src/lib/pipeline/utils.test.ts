import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolvePipelineConfigPath, writeJsonAtomic } from "./utils";

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
