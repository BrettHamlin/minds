/**
 * Unit tests for src/cli/lib/registry.ts
 * Covers: parse valid registry.json, reject invalid, parse pipeline.json,
 * reject missing required fields, validate type field.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRegistryIndex,
  parseManifest,
  findEntry,
  listPipelines,
  listPacks,
  buildVersionMap,
} from "../../minds/cli/lib/registry.js";
import type { RegistryIndex, PipelineManifest } from "../../minds/cli/types/index.js";

const FIXTURES = join(import.meta.dir, "../fixtures/mock-registry");

// ─── parseRegistryIndex ───────────────────────────────────────────────────────

describe("parseRegistryIndex", () => {
  test("parses valid registry.json", () => {
    const raw = readFileSync(join(FIXTURES, "registry.json"), "utf8");
    const registry = parseRegistryIndex(raw, "test://registry.json");

    expect(registry.version).toBe("1");
    expect(registry.packs).toHaveLength(5);
    expect(registry.pipelines).toHaveLength(7);
    expect(registry.packs[0].name).toBe("specfactory");
    expect(registry.pipelines[0].name).toBe("specify");
  });

  test("rejects invalid JSON", () => {
    expect(() => parseRegistryIndex("not json", "test://url")).toThrow();
    try {
      parseRegistryIndex("not json", "test://url");
    } catch (err) {
      expect((err as { code: string }).code).toBe("REGISTRY_INVALID");
    }
  });

  test("rejects non-object JSON", () => {
    expect(() => parseRegistryIndex("[1, 2, 3]", "test://url")).toThrow();
  });

  test("rejects registry missing 'version' field", () => {
    const invalid = JSON.stringify({ pipelines: [], packs: [] });
    expect(() => parseRegistryIndex(invalid, "test://url")).toThrow();
    try {
      parseRegistryIndex(invalid, "test://url");
    } catch (err) {
      expect((err as { code: string }).code).toBe("REGISTRY_INVALID");
    }
  });

  test("rejects registry missing 'pipelines' array", () => {
    const invalid = JSON.stringify({ version: "1", packs: [] });
    expect(() => parseRegistryIndex(invalid, "test://url")).toThrow();
  });

  test("rejects registry missing 'packs' array", () => {
    const invalid = JSON.stringify({ version: "1", pipelines: [] });
    expect(() => parseRegistryIndex(invalid, "test://url")).toThrow();
  });

  test("rejects registry entry missing required fields", () => {
    const invalid = JSON.stringify({
      version: "1",
      pipelines: [{ name: "specify" }], // missing description, latestVersion, etc.
      packs: [],
    });
    expect(() => parseRegistryIndex(invalid, "test://url")).toThrow();
  });
});

// ─── parseManifest ────────────────────────────────────────────────────────────

describe("parseManifest", () => {
  test("parses valid pipeline.json", () => {
    const raw = readFileSync(
      join(FIXTURES, "pipelines/specify/pipeline.json"),
      "utf8"
    );
    const manifest = parseManifest(raw, "test://specify/pipeline.json");

    expect(manifest.name).toBe("specify");
    expect(manifest.type).toBe("pipeline");
    expect(manifest.version).toBe("1.2.0");
  });

  test("parses valid pack manifest", () => {
    const raw = readFileSync(
      join(FIXTURES, "packs/specfactory/pipeline.json"),
      "utf8"
    );
    const manifest = parseManifest(raw, "test://specfactory/pipeline.json");

    expect(manifest.name).toBe("specfactory");
    expect(manifest.type).toBe("pack");
  });

  test("rejects invalid JSON", () => {
    expect(() => parseManifest("{{bad json}}", "test://manifest")).toThrow();
    try {
      parseManifest("{{bad json}}", "test://manifest");
    } catch (err) {
      expect((err as { code: string }).code).toBe("MANIFEST_INVALID");
    }
  });

  test("rejects manifest missing 'name' field", () => {
    const invalid = JSON.stringify({
      type: "pipeline",
      version: "1.0.0",
      description: "no name",
    });
    expect(() => parseManifest(invalid, "test://manifest")).toThrow();
    try {
      parseManifest(invalid, "test://manifest");
    } catch (err) {
      expect((err as { code: string }).code).toBe("MANIFEST_INVALID");
    }
  });

  test("rejects manifest missing 'type' field", () => {
    const invalid = JSON.stringify({
      name: "specify",
      version: "1.0.0",
      description: "no type",
    });
    expect(() => parseManifest(invalid, "test://manifest")).toThrow();
  });

  test("rejects manifest missing 'version' field", () => {
    const invalid = JSON.stringify({
      name: "specify",
      type: "pipeline",
      description: "no version",
    });
    expect(() => parseManifest(invalid, "test://manifest")).toThrow();
  });

  test("rejects manifest missing 'description' field", () => {
    const invalid = JSON.stringify({
      name: "specify",
      type: "pipeline",
      version: "1.0.0",
    });
    expect(() => parseManifest(invalid, "test://manifest")).toThrow();
  });

  test("rejects type field that is not 'pipeline' or 'pack'", () => {
    const invalid = JSON.stringify({
      name: "specify",
      type: "module",
      version: "1.0.0",
      description: "wrong type",
    });
    expect(() => parseManifest(invalid, "test://manifest")).toThrow();
    try {
      parseManifest(invalid, "test://manifest");
    } catch (err) {
      expect((err as { code: string }).code).toBe("MANIFEST_INVALID");
      expect((err as { error: string }).error).toContain('"module"');
    }
  });
});

// ─── findEntry ────────────────────────────────────────────────────────────────

describe("findEntry", () => {
  let registry: RegistryIndex;

  test("setup: parse fixture registry", () => {
    const raw = readFileSync(join(FIXTURES, "registry.json"), "utf8");
    registry = parseRegistryIndex(raw, "test://registry.json");
  });

  test("finds a pipeline by name", () => {
    const raw = readFileSync(join(FIXTURES, "registry.json"), "utf8");
    const reg = parseRegistryIndex(raw, "test://registry.json");
    const entry = findEntry(reg, "specify");
    expect(entry.name).toBe("specify");
    expect(entry.latestVersion).toBe("1.2.0");
  });

  test("finds a pack by name", () => {
    const raw = readFileSync(join(FIXTURES, "registry.json"), "utf8");
    const reg = parseRegistryIndex(raw, "test://registry.json");
    const entry = findEntry(reg, "specfactory");
    expect(entry.name).toBe("specfactory");
  });

  test("throws PIPELINE_NOT_FOUND for unknown name", () => {
    const raw = readFileSync(join(FIXTURES, "registry.json"), "utf8");
    const reg = parseRegistryIndex(raw, "test://registry.json");

    expect(() => findEntry(reg, "nonexistent")).toThrow();
    try {
      findEntry(reg, "nonexistent");
    } catch (err) {
      expect((err as { code: string }).code).toBe("PIPELINE_NOT_FOUND");
    }
  });
});

// ─── buildVersionMap ──────────────────────────────────────────────────────────

describe("buildVersionMap", () => {
  test("builds a map of name → latestVersion", () => {
    const raw = readFileSync(join(FIXTURES, "registry.json"), "utf8");
    const registry = parseRegistryIndex(raw, "test://registry.json");
    const map = buildVersionMap(registry);

    expect(map.get("specify")).toBe("1.2.0");
    expect(map.get("plan")).toBe("1.1.0");
    expect(map.get("specfactory")).toBe("2.0.0");
  });
});
