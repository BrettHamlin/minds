/**
 * Unit tests for src/cli/lib/state.ts
 * Covers: read empty state, write pipeline entry, write CLI entry,
 * remove pipeline (update requiredBy), atomic write safety.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readState,
  writeState,
  addPipeline,
  removePipeline,
  addCli,
  removePipelineFromClis,
  listPipelineNames,
  isPipelineInstalled,
} from "../../src/cli/lib/state.js";
import type { InstalledState } from "../../src/cli/types/index.js";

function tmpPath(name: string): string {
  return join(tmpdir(), `state-test-${name}-${Date.now()}.json`);
}

// ─── readState ────────────────────────────────────────────────────────────────

describe("readState", () => {
  test("returns empty state when file does not exist", () => {
    const state = readState("/nonexistent/path/installed-pipelines.json");
    expect(state.version).toBe("1");
    expect(state.pipelines).toEqual({});
    expect(state.clis).toEqual({});
  });

  test("reads a valid state file", () => {
    const path = tmpPath("read");
    const stateData: InstalledState = {
      version: "1",
      installedAt: new Date().toISOString(),
      pipelines: {
        specify: {
          name: "specify",
          version: "1.2.0",
          installedAt: new Date().toISOString(),
          requiredBy: ["direct"],
          checksum: "abc123",
        },
      },
      clis: {},
    };
    writeFileSync(path, JSON.stringify(stateData, null, 2));

    const read = readState(path);
    expect(read.version).toBe("1");
    expect(read.pipelines["specify"].version).toBe("1.2.0");

    unlinkSync(path);
  });

  test("throws CollabError on corrupt JSON", () => {
    const path = tmpPath("corrupt");
    writeFileSync(path, "not json {{{}}}");

    expect(() => readState(path)).toThrow();
    try {
      readState(path);
    } catch (err) {
      expect((err as { code: string }).code).toBe("STATE_CORRUPT");
    }
    unlinkSync(path);
  });

  test("throws on unknown version", () => {
    const path = tmpPath("badver");
    writeFileSync(path, JSON.stringify({ version: "99", pipelines: {}, clis: {} }));
    expect(() => readState(path)).toThrow();
    unlinkSync(path);
  });
});

// ─── writeState ───────────────────────────────────────────────────────────────

describe("writeState", () => {
  test("writes state atomically and can be re-read", () => {
    const path = tmpPath("write");
    const state: InstalledState = {
      version: "1",
      installedAt: new Date().toISOString(),
      pipelines: {},
      clis: {},
    };

    writeState(path, state);

    const read = readState(path);
    expect(read.version).toBe("1");
    expect(existsSync(path + ".tmp")).toBe(false);

    unlinkSync(path);
  });

  test("atomic write: no .tmp file remains on success", () => {
    const path = tmpPath("atomic");
    const state: InstalledState = {
      version: "1",
      installedAt: new Date().toISOString(),
      pipelines: {},
      clis: {},
    };

    writeState(path, state);
    expect(existsSync(path + ".tmp")).toBe(false);
    expect(existsSync(path)).toBe(true);

    unlinkSync(path);
  });
});

// ─── addPipeline ──────────────────────────────────────────────────────────────

describe("addPipeline", () => {
  test("adds a pipeline entry to state", () => {
    const state: InstalledState = {
      version: "1",
      installedAt: "",
      pipelines: {},
      clis: {},
    };

    const updated = addPipeline(state, {
      name: "specify",
      version: "1.2.0",
      requiredBy: ["direct"],
      checksum: "abc",
    });

    expect(updated.pipelines["specify"]).toBeDefined();
    expect(updated.pipelines["specify"].version).toBe("1.2.0");
    expect(updated.pipelines["specify"].requiredBy).toEqual(["direct"]);
  });

  test("merges requiredBy when pipeline already exists", () => {
    const state: InstalledState = {
      version: "1",
      installedAt: "",
      pipelines: {
        specify: {
          name: "specify",
          version: "1.0.0",
          installedAt: "",
          requiredBy: ["direct"],
          checksum: "abc",
        },
      },
      clis: {},
    };

    const updated = addPipeline(state, {
      name: "specify",
      version: "1.0.0",
      requiredBy: ["specfactory"],
      checksum: "abc",
    });

    expect(updated.pipelines["specify"].requiredBy).toContain("direct");
    expect(updated.pipelines["specify"].requiredBy).toContain("specfactory");
  });
});

// ─── removePipeline ───────────────────────────────────────────────────────────

describe("removePipeline", () => {
  test("removes pipeline from state", () => {
    const state: InstalledState = {
      version: "1",
      installedAt: "",
      pipelines: {
        specify: {
          name: "specify",
          version: "1.2.0",
          installedAt: "",
          requiredBy: ["direct"],
          checksum: "abc",
        },
      },
      clis: {},
    };

    const updated = removePipeline(state, "specify");
    expect(updated.pipelines["specify"]).toBeUndefined();
  });

  test("cleans requiredBy references in other pipelines", () => {
    const state: InstalledState = {
      version: "1",
      installedAt: "",
      pipelines: {
        specify: {
          name: "specify",
          version: "1.0.0",
          installedAt: "",
          requiredBy: ["specfactory"],
          checksum: "abc",
        },
        specfactory: {
          name: "specfactory",
          version: "2.0.0",
          installedAt: "",
          requiredBy: ["direct"],
          checksum: "def",
        },
      },
      clis: {},
    };

    // Removing specfactory should clean its name from specify's requiredBy
    const updated = removePipeline(state, "specfactory");
    expect(updated.pipelines["specify"].requiredBy).not.toContain("specfactory");
  });
});

// ─── addCli ───────────────────────────────────────────────────────────────────

describe("addCli", () => {
  test("adds a CLI entry to state", () => {
    const state: InstalledState = {
      version: "1",
      installedAt: "",
      pipelines: {},
      clis: {},
    };

    const updated = addCli(state, {
      name: "jq",
      version: "1.6.0",
      requiredBy: ["specify"],
    });

    expect(updated.clis["jq"]).toBeDefined();
    expect(updated.clis["jq"].version).toBe("1.6.0");
  });
});

// ─── listPipelineNames / isPipelineInstalled ──────────────────────────────────

describe("listPipelineNames", () => {
  test("returns sorted list of installed pipeline names", () => {
    const state: InstalledState = {
      version: "1",
      installedAt: "",
      pipelines: {
        plan: { name: "plan", version: "1.0.0", installedAt: "", requiredBy: [], checksum: "" },
        specify: { name: "specify", version: "1.0.0", installedAt: "", requiredBy: [], checksum: "" },
        analyze: { name: "analyze", version: "1.0.0", installedAt: "", requiredBy: [], checksum: "" },
      },
      clis: {},
    };

    const names = listPipelineNames(state);
    expect(names).toEqual(["analyze", "plan", "specify"]);
  });
});

describe("isPipelineInstalled", () => {
  test("returns true when installed", () => {
    const state: InstalledState = {
      version: "1",
      installedAt: "",
      pipelines: {
        specify: { name: "specify", version: "1.0.0", installedAt: "", requiredBy: [], checksum: "" },
      },
      clis: {},
    };
    expect(isPipelineInstalled(state, "specify")).toBe(true);
  });

  test("returns false when not installed", () => {
    const state: InstalledState = {
      version: "1",
      installedAt: "",
      pipelines: {},
      clis: {},
    };
    expect(isPipelineInstalled(state, "specify")).toBe(false);
  });
});
