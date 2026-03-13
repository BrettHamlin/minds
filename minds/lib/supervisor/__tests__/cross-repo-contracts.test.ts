/**
 * cross-repo-contracts.test.ts — Tests for post-wave cross-repo contract verification (MR-019).
 *
 * Verifies:
 * - Producer file exists and exports interface → pass
 * - Producer file missing → violation
 * - Producer file exists but no export → violation
 * - Empty checks → pass
 * - Multiple checks, some pass some fail → correct violations
 * - buildCrossRepoChecks constructs checks from deferred annotations
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  verifyCrossRepoContracts,
  buildCrossRepoChecks,
  type CrossRepoContractCheck,
} from "../cross-repo-contracts.ts";
import type { ContractAnnotation } from "../../check-contracts-core.ts";
import { tempDir } from "../../../cli/commands/__tests__/helpers/multi-repo-setup.ts";

function makeAnnotation(overrides: Partial<ContractAnnotation> = {}): ContractAnnotation {
  return {
    type: "produces",
    interfaceName: "MyInterface",
    filePath: "backend:src/api/types.ts",
    taskId: "T001",
    ...overrides,
  };
}

function makeCheck(overrides: Partial<CrossRepoContractCheck> = {}): CrossRepoContractCheck {
  return {
    annotation: makeAnnotation(),
    producerMind: "(cross-repo)",
    producerRepo: "backend",
    consumerMind: "ui",
    consumerRepo: "frontend",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("verifyCrossRepoContracts (MR-019)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = tempDir();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("producer file exists and exports interface → pass", () => {
    const backendRoot = join(tmpRoot, "backend");
    mkdirSync(join(backendRoot, "src", "api"), { recursive: true });
    writeFileSync(
      join(backendRoot, "src", "api", "types.ts"),
      "export interface MyInterface { id: string; }\n",
    );

    const repoPaths = new Map([["backend", backendRoot]]);
    const checks = [makeCheck()];

    const result = verifyCrossRepoContracts(checks, repoPaths, tmpRoot);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("producer file missing → violation", () => {
    const backendRoot = join(tmpRoot, "backend");
    mkdirSync(backendRoot, { recursive: true });
    // No file created

    const repoPaths = new Map([["backend", backendRoot]]);
    const checks = [makeCheck()];

    const result = verifyCrossRepoContracts(checks, repoPaths, tmpRoot);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].reason).toContain("does not exist");
    expect(result.violations[0].reason).toContain("backend");
  });

  test("producer file exists but no export → violation", () => {
    const backendRoot = join(tmpRoot, "backend");
    mkdirSync(join(backendRoot, "src", "api"), { recursive: true });
    writeFileSync(
      join(backendRoot, "src", "api", "types.ts"),
      "interface MyInterface { id: string; }\n", // Not exported
    );

    const repoPaths = new Map([["backend", backendRoot]]);
    const checks = [makeCheck()];

    const result = verifyCrossRepoContracts(checks, repoPaths, tmpRoot);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].reason).toContain("NOT exported");
  });

  test("empty checks → pass", () => {
    const repoPaths = new Map<string, string>();
    const result = verifyCrossRepoContracts([], repoPaths, tmpRoot);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("multiple checks, some pass some fail → correct violations", () => {
    const backendRoot = join(tmpRoot, "backend");
    mkdirSync(join(backendRoot, "src", "api"), { recursive: true });
    writeFileSync(
      join(backendRoot, "src", "api", "types.ts"),
      "export interface MyInterface { id: string; }\n",
    );

    const repoPaths = new Map([["backend", backendRoot]]);
    const checks = [
      // Pass: file exists and exports MyInterface
      makeCheck(),
      // Fail: file exists but OtherInterface is not exported
      makeCheck({
        annotation: makeAnnotation({ interfaceName: "OtherInterface" }),
      }),
      // Fail: file doesn't exist
      makeCheck({
        annotation: makeAnnotation({ filePath: "backend:src/missing.ts", interfaceName: "Missing" }),
      }),
    ];

    const result = verifyCrossRepoContracts(checks, repoPaths, tmpRoot);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0].reason).toContain("OtherInterface");
    expect(result.violations[1].reason).toContain("does not exist");
  });

  test("falls back to defaultRepoRoot when repo not in repoPaths", () => {
    // Put the file under the default root
    mkdirSync(join(tmpRoot, "src", "api"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "src", "api", "types.ts"),
      "export interface MyInterface { id: string; }\n",
    );

    const repoPaths = new Map<string, string>(); // backend not mapped
    const checks = [makeCheck()];

    const result = verifyCrossRepoContracts(checks, repoPaths, tmpRoot);
    expect(result.pass).toBe(true);
  });
});

describe("buildCrossRepoChecks (MR-019)", () => {
  test("builds checks from deferred annotations", () => {
    const annotations: ContractAnnotation[] = [
      { type: "consumes", interfaceName: "ApiResponse", filePath: "backend:src/types.ts", taskId: "T002" },
      { type: "produces", interfaceName: "UiEvent", filePath: "frontend:src/events.ts", taskId: "T003" },
    ];

    const result = buildCrossRepoChecks([
      { mindName: "ui", repo: "frontend", annotations },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].consumerMind).toBe("ui");
    expect(result[0].consumerRepo).toBe("frontend");
    expect(result[0].producerRepo).toBe("backend");
    expect(result[1].producerRepo).toBe("frontend");
  });

  test("skips annotations without repo prefix", () => {
    const annotations: ContractAnnotation[] = [
      { type: "consumes", interfaceName: "Local", filePath: "src/local.ts", taskId: "T001" },
    ];

    const result = buildCrossRepoChecks([
      { mindName: "core", annotations },
    ]);

    expect(result).toHaveLength(0);
  });

  test("empty input returns empty checks", () => {
    expect(buildCrossRepoChecks([])).toHaveLength(0);
  });

  test("defaults consumerRepo to __default__ when repo not provided", () => {
    const annotations: ContractAnnotation[] = [
      { type: "consumes", interfaceName: "X", filePath: "other:src/x.ts", taskId: "T001" },
    ];

    const result = buildCrossRepoChecks([
      { mindName: "core", annotations },
    ]);

    expect(result[0].consumerRepo).toBe("__default__");
  });
});
