/**
 * Unit tests for src/cli/lib/lockfile.ts
 * Covers: generate, read, write, diff against registry, add/remove entries.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readLockfile,
  writeLockfile,
  generateLockfile,
  diffAgainstRegistry,
  addPipelineToLockfile,
  addPackToLockfile,
  removePipelineFromLockfile,
  removeFromLockfile,
} from "../../src/cli/lib/lockfile.js";
import type { Lockfile, PipelineManifest } from "../../src/cli/types/index.js";

function tmpPath(name: string): string {
  return join(tmpdir(), `lockfile-test-${name}-${Date.now()}.json`);
}

// ─── readLockfile ─────────────────────────────────────────────────────────────

describe("readLockfile", () => {
  test("returns null when file does not exist", () => {
    expect(readLockfile("/nonexistent/path/pipeline-lock.json")).toBeNull();
  });

  test("reads a valid lockfile", () => {
    const path = tmpPath("read");
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: new Date().toISOString(),
      pipelines: {
        specify: {
          name: "specify",
          resolvedVersion: "1.2.0",
          tarballUrl: "https://example.com/specify-1.2.0.tar.gz",
          checksum: "abc123",
          dependencies: [],
        },
      },
    };
    writeFileSync(path, JSON.stringify(lockfile, null, 2));

    const read = readLockfile(path);
    expect(read).not.toBeNull();
    expect(read!.lockfileVersion).toBe(1);
    expect(read!.pipelines["specify"].resolvedVersion).toBe("1.2.0");

    unlinkSync(path);
  });

  test("throws CollabError on invalid JSON", () => {
    const path = tmpPath("corrupt");
    writeFileSync(path, "not json {{{");

    expect(() => readLockfile(path)).toThrow();
    try {
      readLockfile(path);
    } catch (err) {
      expect((err as { code: string }).code).toBe("STATE_CORRUPT");
    }
    unlinkSync(path);
  });

  test("throws on unknown lockfile version", () => {
    const path = tmpPath("badver");
    writeFileSync(
      path,
      JSON.stringify({ lockfileVersion: 99, generatedAt: "", pipelines: {} })
    );
    expect(() => readLockfile(path)).toThrow();
    unlinkSync(path);
  });
});

// ─── writeLockfile ────────────────────────────────────────────────────────────

describe("writeLockfile", () => {
  test("writes lockfile atomically and can be re-read", () => {
    const path = tmpPath("write");
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: new Date().toISOString(),
      pipelines: {},
    };

    writeLockfile(path, lockfile);

    const read = readLockfile(path);
    expect(read).not.toBeNull();
    expect(read!.lockfileVersion).toBe(1);

    // No tmp file left over (atomic write succeeded)
    expect(existsSync(path + ".tmp")).toBe(false);

    unlinkSync(path);
  });

  test("write + read roundtrip preserves all fields", () => {
    const path = tmpPath("roundtrip");
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "2026-03-03T05:00:00Z",
      registryUrl: "https://example.com/registry.json",
      packs: {
        specfactory: { version: "2.0.0", resolved: { specify: "1.0.0", plan: "1.0.0" } },
      },
      pipelines: {
        specify: {
          name: "specify",
          resolvedVersion: "1.0.0",
          tarballUrl: "https://example.com/specify.tar.gz",
          checksum: "abc",
          dependencies: [],
        },
      },
    };

    writeLockfile(path, lockfile);
    const read = readLockfile(path);

    expect(read).not.toBeNull();
    expect(read!.registryUrl).toBe("https://example.com/registry.json");
    expect(read!.packs?.specfactory.version).toBe("2.0.0");
    expect(read!.packs?.specfactory.resolved.specify).toBe("1.0.0");
    expect(read!.pipelines.specify.resolvedVersion).toBe("1.0.0");

    unlinkSync(path);
  });
});

// ─── generateLockfile ─────────────────────────────────────────────────────────

describe("generateLockfile", () => {
  test("generates lockfile from resolved manifests", () => {
    const specifyManifest: PipelineManifest = {
      name: "specify",
      type: "pipeline",
      version: "1.2.0",
      description: "specify",
      dependencies: [],
      cliDependencies: [],
      commands: [],
    };
    const planManifest: PipelineManifest = {
      name: "plan",
      type: "pipeline",
      version: "1.1.0",
      description: "plan",
      dependencies: [{ name: "specify", version: ">=1.0.0" }],
      cliDependencies: [],
      commands: [],
    };

    const resolved = new Map([
      ["specify", specifyManifest],
      ["plan", planManifest],
    ]);
    const checksums = new Map([
      ["specify", "checksum-specify"],
      ["plan", "checksum-plan"],
    ]);
    const tarballUrls = new Map([
      ["specify", "https://example.com/specify.tar.gz"],
      ["plan", "https://example.com/plan.tar.gz"],
    ]);

    const lockfile = generateLockfile(resolved, checksums, tarballUrls);

    expect(lockfile.lockfileVersion).toBe(1);
    expect(lockfile.pipelines["specify"].resolvedVersion).toBe("1.2.0");
    expect(lockfile.pipelines["specify"].checksum).toBe("checksum-specify");
    expect(lockfile.pipelines["plan"].dependencies).toEqual(["specify"]);
  });
});

// ─── diffAgainstRegistry ──────────────────────────────────────────────────────

describe("diffAgainstRegistry", () => {
  test("returns outdated pipelines as UpdateDiff entries", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      pipelines: {
        specify: {
          name: "specify",
          resolvedVersion: "1.0.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
        plan: {
          name: "plan",
          resolvedVersion: "1.1.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
      },
    };

    const registryVersions = new Map([
      ["specify", "1.2.0"], // newer
      ["plan", "1.1.0"],    // same
    ]);

    const diffs = diffAgainstRegistry(lockfile, registryVersions);
    expect(diffs.some((d) => d.name === "specify")).toBe(true);
    expect(diffs.some((d) => d.name === "plan")).toBe(false);

    const specDiff = diffs.find((d) => d.name === "specify")!;
    expect(specDiff.currentVersion).toBe("1.0.0");
    expect(specDiff.latestVersion).toBe("1.2.0");
    expect(specDiff.type).toBe("pipeline");
  });

  test("returns empty array when all up to date", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      pipelines: {
        specify: {
          name: "specify",
          resolvedVersion: "1.2.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
      },
    };
    const registryVersions = new Map([["specify", "1.2.0"]]);
    expect(diffAgainstRegistry(lockfile, registryVersions)).toHaveLength(0);
  });

  test("update available — returns one UpdateDiff entry with version info", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      pipelines: {
        specify: {
          name: "specify",
          resolvedVersion: "1.0.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
      },
    };

    const registryVersions = new Map([["specify", "1.1.0"]]);
    const diffs = diffAgainstRegistry(lockfile, registryVersions);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].name).toBe("specify");
    expect(diffs[0].currentVersion).toBe("1.0.0");
    expect(diffs[0].latestVersion).toBe("1.1.0");
    expect(diffs[0].type).toBe("pipeline");
  });

  test("includes packs in diff when pack version is outdated", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      packs: {
        specfactory: { version: "1.0.0", resolved: { specify: "1.0.0" } },
      },
      pipelines: {},
    };

    const registryVersions = new Map([["specfactory", "2.0.0"]]);
    const diffs = diffAgainstRegistry(lockfile, registryVersions);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].name).toBe("specfactory");
    expect(diffs[0].type).toBe("pack");
    expect(diffs[0].currentVersion).toBe("1.0.0");
    expect(diffs[0].latestVersion).toBe("2.0.0");
  });
});

// ─── addPipelineToLockfile ────────────────────────────────────────────────────

describe("addPipelineToLockfile", () => {
  test("adds a pipeline entry", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      pipelines: {},
    };
    const updated = addPipelineToLockfile(lockfile, {
      name: "specify",
      resolvedVersion: "1.2.0",
      tarballUrl: "https://example.com/specify.tar.gz",
      checksum: "abc",
      dependencies: [],
    });
    expect(updated.pipelines["specify"].resolvedVersion).toBe("1.2.0");
  });
});

// ─── addPackToLockfile ────────────────────────────────────────────────────────

describe("addPackToLockfile", () => {
  test("adds a pack with resolved component versions", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      pipelines: {},
    };

    const resolved = { specify: "1.0.0", plan: "1.0.0", tasks: "1.2.0" };
    const updated = addPackToLockfile(lockfile, "specfactory", "2.0.0", resolved);

    expect(updated.packs?.specfactory).toBeDefined();
    expect(updated.packs?.specfactory.version).toBe("2.0.0");
    expect(updated.packs?.specfactory.resolved.specify).toBe("1.0.0");
    expect(updated.packs?.specfactory.resolved.tasks).toBe("1.2.0");
    // Original lockfile unchanged (immutable)
    expect(lockfile.packs).toBeUndefined();
  });

  test("adds multiple packs independently", () => {
    let lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      pipelines: {},
    };

    lockfile = addPackToLockfile(lockfile, "pack-a", "1.0.0", { alpha: "1.0.0" });
    lockfile = addPackToLockfile(lockfile, "pack-b", "2.0.0", { beta: "2.0.0" });

    expect(Object.keys(lockfile.packs ?? {})).toHaveLength(2);
    expect(lockfile.packs?.["pack-a"].version).toBe("1.0.0");
    expect(lockfile.packs?.["pack-b"].version).toBe("2.0.0");
  });
});

// ─── removePipelineFromLockfile / removeFromLockfile ─────────────────────────

describe("remove from lockfile", () => {
  test("removePipelineFromLockfile removes the named pipeline", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      pipelines: {
        specify: {
          name: "specify",
          resolvedVersion: "1.2.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
        plan: {
          name: "plan",
          resolvedVersion: "1.0.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
      },
    };

    const updated = removePipelineFromLockfile(lockfile, "specify");
    expect(updated.pipelines["specify"]).toBeUndefined();
    expect(updated.pipelines["plan"]).toBeDefined();
  });

  test("removeFromLockfile removes a pack entry, leaving component pipelines intact", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      packs: {
        specfactory: { version: "2.0.0", resolved: { specify: "1.0.0", plan: "1.0.0" } },
      },
      pipelines: {
        specify: {
          name: "specify",
          resolvedVersion: "1.0.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
        plan: {
          name: "plan",
          resolvedVersion: "1.0.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
      },
    };

    const updated = removeFromLockfile(lockfile, "specfactory");

    // Pack entry removed
    expect(updated.packs?.specfactory).toBeUndefined();
    // Component pipelines untouched
    expect(updated.pipelines.specify).toBeDefined();
    expect(updated.pipelines.plan).toBeDefined();
  });

  test("removeFromLockfile removes a pipeline when name is not in packs", () => {
    const lockfile: Lockfile = {
      lockfileVersion: 1,
      generatedAt: "",
      pipelines: {
        specify: {
          name: "specify",
          resolvedVersion: "1.0.0",
          tarballUrl: "",
          checksum: "",
          dependencies: [],
        },
      },
    };

    const updated = removeFromLockfile(lockfile, "specify");
    expect(updated.pipelines.specify).toBeUndefined();
  });
});
