import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { buildAdjacency, detectCycles } from "./coordination-check";

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
