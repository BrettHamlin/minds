/**
 * workspace.test.ts — Tests for workspace manifest schema and validation (MR-001).
 */

import { describe, test, expect } from "bun:test";
import {
  validateWorkspaceManifest,
  validateWorkspaceManifestDetailed,
  WORKSPACE_MANIFEST_FILENAME,
  ALIAS_PATTERN,
  type WorkspaceManifest,
} from "../workspace.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validManifest(overrides?: Partial<WorkspaceManifest>): Record<string, unknown> {
  return {
    version: 1,
    orchestratorRepo: "main-repo",
    repos: [
      { alias: "main-repo", path: "./main" },
      { alias: "backend", path: "./services/backend" },
    ],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WORKSPACE_MANIFEST_FILENAME", () => {
  test("is minds-workspace.json", () => {
    expect(WORKSPACE_MANIFEST_FILENAME).toBe("minds-workspace.json");
  });
});

describe("validateWorkspaceManifest", () => {
  test("valid manifest passes", () => {
    expect(validateWorkspaceManifest(validManifest())).toBe(true);
  });

  test("valid manifest with all optional fields passes", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "main-repo",
      repos: [
        {
          alias: "main-repo",
          path: "./main",
          installCommand: "npm install",
          testCommand: "npm test",
          infraExclusions: [".github/**"],
          defaultBranch: "develop",
        },
      ],
    };
    expect(validateWorkspaceManifest(manifest)).toBe(true);
  });

  test("extra unknown fields are tolerated", () => {
    const manifest = { ...validManifest(), customField: "hello", meta: { foo: 1 } };
    expect(validateWorkspaceManifest(manifest)).toBe(true);
  });

  // ── version ──────────────────────────────────────────────────────────────

  test("missing version fails", () => {
    const manifest = validManifest();
    delete manifest.version;
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  test("wrong version fails", () => {
    const result = validateWorkspaceManifestDetailed(validManifest({ version: 2 as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  // ── orchestratorRepo ─────────────────────────────────────────────────────

  test("orchestratorRepo not in repos fails", () => {
    const manifest = validManifest({ orchestratorRepo: "nonexistent" });
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });

  test("empty orchestratorRepo fails", () => {
    const manifest = validManifest({ orchestratorRepo: "" });
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("orchestratorRepo"))).toBe(true);
  });

  // ── repos array ──────────────────────────────────────────────────────────

  test("empty repos array fails", () => {
    const result = validateWorkspaceManifestDetailed(validManifest({ repos: [] } as any));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-empty array"))).toBe(true);
  });

  test("repos not an array fails", () => {
    const result = validateWorkspaceManifestDetailed(validManifest({ repos: "nope" } as any));
    expect(result.valid).toBe(false);
  });

  // ── alias validation ─────────────────────────────────────────────────────

  test("duplicate alias fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "backend",
      repos: [
        { alias: "backend", path: "./a" },
        { alias: "backend", path: "./b" },
      ],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  test("alias with colon fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "bad:alias",
      repos: [{ alias: "bad:alias", path: "./a" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid characters"))).toBe(true);
  });

  test("alias with slash fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "bad/alias",
      repos: [{ alias: "bad/alias", path: "./a" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid characters"))).toBe(true);
  });

  test("alias with spaces fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "bad alias",
      repos: [{ alias: "bad alias", path: "./a" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid characters"))).toBe(true);
  });

  test("alias with hyphens and underscores passes", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "my-repo_v2",
      repos: [{ alias: "my-repo_v2", path: "./a" }],
    };
    expect(validateWorkspaceManifest(manifest)).toBe(true);
  });

  // ── path security (MR-P3) ───────────────────────────────────────────────

  test("path with .. fails (path traversal)", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "repo",
      repos: [{ alias: "repo", path: "../outside" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("path traversal"))).toBe(true);
  });

  test("path with embedded .. fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "repo",
      repos: [{ alias: "repo", path: "./foo/../bar" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("path traversal"))).toBe(true);
  });

  // ── optional field validation ────────────────────────────────────────────

  test("non-string installCommand fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "repo",
      repos: [{ alias: "repo", path: "./a", installCommand: 123 }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("installCommand"))).toBe(true);
  });

  test("non-string testCommand fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "repo",
      repos: [{ alias: "repo", path: "./a", testCommand: true }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("testCommand"))).toBe(true);
  });

  test("non-array infraExclusions fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "repo",
      repos: [{ alias: "repo", path: "./a", infraExclusions: "nope" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("infraExclusions"))).toBe(true);
  });

  // ── edge cases ───────────────────────────────────────────────────────────

  test("null value fails", () => {
    const result = validateWorkspaceManifestDetailed(null);
    expect(result.valid).toBe(false);
  });

  test("array value fails", () => {
    const result = validateWorkspaceManifestDetailed([]);
    expect(result.valid).toBe(false);
  });

  test("string value fails", () => {
    const result = validateWorkspaceManifestDetailed("not a manifest");
    expect(result.valid).toBe(false);
  });

  test("single-repo manifest passes", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "mono",
      repos: [{ alias: "mono", path: "." }],
    };
    expect(validateWorkspaceManifest(manifest)).toBe(true);
  });

  // ── path traversal precision (review fix #1) ─────────────────────────────

  test("path with double dots in name (foo..bar) passes — not path traversal", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "repo",
      repos: [{ alias: "repo", path: "./foo..bar" }],
    };
    expect(validateWorkspaceManifest(manifest)).toBe(true);
  });

  test("path with .. as directory component fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "repo",
      repos: [{ alias: "repo", path: "foo/../bar" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("path traversal"))).toBe(true);
  });

  // ── missing alias or path fields (review fix #5) ─────────────────────────

  test("repo entry missing alias field fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "repo",
      repos: [{ path: "./a" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("alias"))).toBe(true);
  });

  test("repo entry missing path field fails", () => {
    const manifest = {
      version: 1,
      orchestratorRepo: "foo",
      repos: [{ alias: "foo" }],
    };
    const result = validateWorkspaceManifestDetailed(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("path"))).toBe(true);
  });
});

describe("ALIAS_PATTERN", () => {
  test("is exported and matches valid aliases", () => {
    expect(ALIAS_PATTERN.test("my-repo_v2")).toBe(true);
    expect(ALIAS_PATTERN.test("backend")).toBe(true);
  });

  test("rejects invalid aliases", () => {
    expect(ALIAS_PATTERN.test("bad:alias")).toBe(false);
    expect(ALIAS_PATTERN.test("bad alias")).toBe(false);
    expect(ALIAS_PATTERN.test("bad/alias")).toBe(false);
  });
});
