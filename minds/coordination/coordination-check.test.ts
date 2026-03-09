import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { buildAdjacency, detectCycles, buildDependencyHolds, detectImplicitDependencies } from "./coordination-check";

let specsDir: string;
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-coord-"));
  specsDir = path.join(tmpDir, "specs");
  fs.mkdirSync(specsDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeCoord(ticketId: string, waitFor: Array<{ id: string; phase: string }>): void {
  const dir = path.join(specsDir, ticketId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "coordination.json"), JSON.stringify({ wait_for: waitFor }));
}

describe("coordination-check: buildAdjacency()", () => {
  test("1. no coordination.json → empty adjacency, no errors", () => {
    const { adjacency, errors } = buildAdjacency(["BRE-1", "BRE-2"], specsDir);
    expect(errors).toHaveLength(0);
    expect(adjacency.get("BRE-1")).toEqual([]);
    expect(adjacency.get("BRE-2")).toEqual([]);
  });

  test("2. valid dependency → edges in adjacency", () => {
    writeCoord("BRE-10", [{ id: "BRE-11", phase: "plan" }]);
    const { adjacency, errors } = buildAdjacency(["BRE-10", "BRE-11"], specsDir);
    expect(errors).toHaveLength(0);
    expect(adjacency.get("BRE-10")).toContain("BRE-11");
  });

  test("3. reference to unknown ticket → error", () => {
    writeCoord("BRE-20", [{ id: "BRE-UNKNOWN", phase: "plan" }]);
    const { adjacency, errors } = buildAdjacency(["BRE-20"], specsDir);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("unknown ticket");
  });
});

describe("coordination-check: detectCycles()", () => {
  test("4. no edges → no cycles", () => {
    const adj = new Map([
      ["A", [] as string[]],
      ["B", [] as string[]],
    ]);
    expect(detectCycles(adj)).toHaveLength(0);
  });

  test("5. linear chain → no cycle", () => {
    const adj = new Map([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", [] as string[]],
    ]);
    expect(detectCycles(adj)).toHaveLength(0);
  });

  test("6. direct cycle A→B→A → cycle detected", () => {
    const adj = new Map([
      ["A", ["B"]],
      ["B", ["A"]],
    ]);
    const cycles = detectCycles(adj);
    expect(cycles.length).toBeGreaterThan(0);
    const cyclePaths = cycles.map((c) => c.path.join("→"));
    expect(cyclePaths.some((p) => p.includes("A") && p.includes("B"))).toBe(true);
  });

  test("7. longer cycle A→B→C→A → cycle detected", () => {
    const adj = new Map([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    const cycles = detectCycles(adj);
    expect(cycles.length).toBeGreaterThan(0);
  });

  test("8. diamond (no cycle) → no cycles detected", () => {
    // A→B, A→C, B→D, C→D (diamond - not a cycle)
    const adj = new Map([
      ["A", ["B", "C"]],
      ["B", ["D"]],
      ["C", ["D"]],
      ["D", [] as string[]],
    ]);
    expect(detectCycles(adj)).toHaveLength(0);
  });
});

// ============================================================================
// Helper for buildDependencyHolds tests
// ============================================================================

let holdSpecsDir: string;
let holdTmpDir: string;

function setupHoldSpecs(): void {
  holdTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-dep-holds-"));
  holdSpecsDir = path.join(holdTmpDir, "specs");
  fs.mkdirSync(holdSpecsDir, { recursive: true });
}

function teardownHoldSpecs(): void {
  fs.rmSync(holdTmpDir, { recursive: true, force: true });
}

function writeMetadata(ticketId: string, data: Record<string, unknown>): void {
  const dir = path.join(holdSpecsDir, ticketId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(data));
}

describe("coordination-check: buildDependencyHolds()", () => {
  beforeAll(() => setupHoldSpecs());
  afterAll(() => teardownHoldSpecs());

  test("9. no metadata.json → no holds", () => {
    const holds = buildDependencyHolds(["BRE-300", "BRE-301"], holdSpecsDir);
    expect(holds).toHaveLength(0);
  });

  test("10. metadata.json with no blockedBy → no holds", () => {
    writeMetadata("BRE-310", { ticket_id: "BRE-310", worktree_path: "/tmp/wt" });
    const holds = buildDependencyHolds(["BRE-310"], holdSpecsDir);
    expect(holds).toHaveLength(0);
  });

  test("11. metadata.json with empty blockedBy array → no holds", () => {
    writeMetadata("BRE-320", { ticket_id: "BRE-320", blockedBy: [] });
    const holds = buildDependencyHolds(["BRE-320"], holdSpecsDir);
    expect(holds).toHaveLength(0);
  });

  test("12. blockedBy with internal blocker (in session) → hold with external=false", () => {
    writeMetadata("BRE-330", { ticket_id: "BRE-330", blockedBy: ["BRE-331"] });
    const holds = buildDependencyHolds(["BRE-330", "BRE-331"], holdSpecsDir);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      held_ticket: "BRE-330",
      blocked_by: "BRE-331",
      release_when: "done",
      reason: "Linear blockedBy",
      external: false,
    });
  });

  test("13. blockedBy with external blocker (not in session) → hold with external=true", () => {
    writeMetadata("BRE-340", { ticket_id: "BRE-340", blockedBy: ["BRE-EXTERNAL"] });
    const holds = buildDependencyHolds(["BRE-340"], holdSpecsDir);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      held_ticket: "BRE-340",
      blocked_by: "BRE-EXTERNAL",
      external: true,
    });
  });

  test("14. multiple blockers → multiple hold records", () => {
    writeMetadata("BRE-350", { ticket_id: "BRE-350", blockedBy: ["BRE-351", "BRE-352"] });
    const holds = buildDependencyHolds(["BRE-350", "BRE-351"], holdSpecsDir);
    expect(holds).toHaveLength(2);
    const internal = holds.find((h) => h.blocked_by === "BRE-351");
    const external = holds.find((h) => h.blocked_by === "BRE-352");
    expect(internal?.external).toBe(false);
    expect(external?.external).toBe(true);
  });

  test("15. ticket with no blockedBy in session with others that do → only affected ticket holds", () => {
    writeMetadata("BRE-360", { ticket_id: "BRE-360", blockedBy: ["BRE-361"] });
    writeMetadata("BRE-362", { ticket_id: "BRE-362" }); // no blockedBy
    const holds = buildDependencyHolds(["BRE-360", "BRE-361", "BRE-362"], holdSpecsDir);
    expect(holds).toHaveLength(1);
    expect(holds[0].held_ticket).toBe("BRE-360");
  });

  test("16. release_when defaults to 'done'", () => {
    writeMetadata("BRE-370", { ticket_id: "BRE-370", blockedBy: ["BRE-371"] });
    const holds = buildDependencyHolds(["BRE-370", "BRE-371"], holdSpecsDir);
    expect(holds[0].release_when).toBe("done");
  });

  test("17. non-string entries in blockedBy are ignored", () => {
    writeMetadata("BRE-380", { ticket_id: "BRE-380", blockedBy: [null, 42, "BRE-381", ""] });
    const holds = buildDependencyHolds(["BRE-380", "BRE-381"], holdSpecsDir);
    expect(holds).toHaveLength(1);
    expect(holds[0].blocked_by).toBe("BRE-381");
  });
});

// ============================================================================
// detectImplicitDependencies() tests
// ============================================================================

describe("coordination-check: detectImplicitDependencies()", () => {
  let implicitTmpDir: string;
  let implicitRegistryDir: string;
  let implicitSpecsDir: string;

  beforeAll(() => {
    implicitTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-implicit-"));
    implicitRegistryDir = path.join(implicitTmpDir, "pipeline-registry");
    implicitSpecsDir = path.join(implicitTmpDir, "specs");
    fs.mkdirSync(implicitRegistryDir, { recursive: true });
    fs.mkdirSync(implicitSpecsDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(implicitTmpDir, { recursive: true, force: true });
  });

  function writeRegistry(ticketId: string, data: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(implicitRegistryDir, `${ticketId}.json`),
      JSON.stringify({ ticket_id: ticketId, ...data })
    );
  }

  function writeSpecMetadata(ticketId: string, data: Record<string, unknown>): void {
    const dir = path.join(implicitSpecsDir, ticketId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "metadata.json"),
      JSON.stringify({ ticket_id: ticketId, ...data })
    );
  }

  test("18. backend variant → returns empty (no spurious implicit deps)", () => {
    writeRegistry("BRE-BACKEND-100", { pipeline_variant: "backend" });
    const result = detectImplicitDependencies("BRE-BACKEND-101", "backend", implicitRegistryDir);
    expect(result).toEqual([]);
  });

  test("19. verification variant with backend in registry → detects backend as blocker", () => {
    writeRegistry("BRE-BACKEND-200", { pipeline_variant: "backend" });
    const result = detectImplicitDependencies(
      "BRE-VERIFY-200",
      "verification",
      implicitRegistryDir
    );
    expect(result).toContain("BRE-BACKEND-200");
  });

  test("20. non-backend variant with no registry entry → specs/ fallback detects backend", () => {
    // Use a fresh empty registry dir to isolate this test from registry writes above
    const emptyRegistry = path.join(implicitTmpDir, "empty-registry");
    fs.mkdirSync(emptyRegistry, { recursive: true });
    writeSpecMetadata("BRE-BACKEND-300", { pipeline_variant: "backend" });

    const result = detectImplicitDependencies(
      "BRE-VERIFY-300",
      "verification",
      emptyRegistry,
      implicitSpecsDir
    );
    expect(result).toContain("BRE-BACKEND-300");
  });

  test("21. explicit blockedBy in metadata still works — no regression (via buildDependencyHolds)", () => {
    writeSpecMetadata("BRE-EXPLICIT-401", { blockedBy: ["BRE-EXPLICIT-402"] });
    const holds = buildDependencyHolds(
      ["BRE-EXPLICIT-401", "BRE-EXPLICIT-402"],
      implicitSpecsDir
    );
    const hold = holds.find((h) => h.held_ticket === "BRE-EXPLICIT-401");
    expect(hold).not.toBeNull();
    expect(hold!.blocked_by).toBe("BRE-EXPLICIT-402");
    expect(hold!.reason).toBe("Linear blockedBy");
  });

  test("22. no variant → non-backend path, scans registry for backend", () => {
    writeRegistry("BRE-BACKEND-500", { pipeline_variant: "backend" });
    const result = detectImplicitDependencies(
      "BRE-NOTYPE-500",
      undefined,
      implicitRegistryDir
    );
    expect(result).toContain("BRE-BACKEND-500");
  });

  test("23. ticket does not block itself", () => {
    writeRegistry("BRE-BACKEND-600", { pipeline_variant: "backend" });
    // If the ticket IS the backend, it should not appear in its own implicit deps list
    const result = detectImplicitDependencies(
      "BRE-BACKEND-600",
      "backend",
      implicitRegistryDir
    );
    expect(result).not.toContain("BRE-BACKEND-600");
    expect(result).toHaveLength(0);
  });

  test("24. deduplicates backend ticket appearing in both registry and specs/", () => {
    const dedupRegistry = path.join(implicitTmpDir, "dedup-registry");
    fs.mkdirSync(dedupRegistry, { recursive: true });
    writeRegistry("BRE-BACKEND-700", { pipeline_variant: "backend" });
    writeSpecMetadata("BRE-BACKEND-700", { pipeline_variant: "backend" });

    // Registry finds it first; deduplicate via Set
    const result = detectImplicitDependencies(
      "BRE-VERIFY-700",
      "verification",
      implicitRegistryDir,
      implicitSpecsDir
    );
    const count = result.filter((id) => id === "BRE-BACKEND-700").length;
    expect(count).toBe(1);
  });
});
