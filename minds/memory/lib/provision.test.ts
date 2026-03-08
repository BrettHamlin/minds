/**
 * Unit tests for provision.ts — idempotent memory provisioning.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { provisionMind, provisionAllMinds } from "./provision";
import { memoryDir, memoryMdPath } from "./paths";

// provisionMind uses memoryDir() from paths.ts (repo-relative), so provisioned
// directories are created in the real repo. We clean them up in afterEach.

let tempDir: string;
const provisioned: string[] = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "memory-test-"));
  provisioned.length = 0;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  // Clean up any real repo mind directories we provisioned during tests
  for (const mindName of provisioned) {
    const dir = memoryDir(mindName);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// Helper: create a fake Mind directory with a server.ts
function createFakeMind(mindsDir: string, name: string): string {
  const mindDir = join(mindsDir, name);
  mkdirSync(mindDir, { recursive: true });
  writeFileSync(join(mindDir, "server.ts"), "// fake server", "utf8");
  return mindDir;
}

describe("provisionMind", () => {
  test("creates memory dir and seeds MEMORY.md for real mind", async () => {
    const fakeName = `_test_provision_${Date.now()}`;
    const fakeMindsDir = tempDir;
    createFakeMind(fakeMindsDir, fakeName);
    provisioned.push(fakeName);

    const result = await provisionAllMinds(fakeMindsDir);
    expect(result.provisioned).toHaveLength(1);
    expect(result.provisioned[0].mindName).toBe(fakeName);
    expect(result.provisioned[0].status).toBe("created");
  });

  test("already_exists when memory dir and MEMORY.md present", async () => {
    // The memory mind itself has its memory dir provisioned (minds/memory/memory/MEMORY.md).
    // We can test this by provisioning it a second time.
    const result = await provisionMind("memory");
    expect(result.status).toBe("already_exists");
    expect(result.mindName).toBe("memory");
  });

  test("creates MEMORY.md with seeded content", async () => {
    const fakeName = `_test_seed_${Date.now()}`;
    const fakeMindsDir = tempDir;
    createFakeMind(fakeMindsDir, fakeName);
    provisioned.push(fakeName);
    const result = await provisionAllMinds(fakeMindsDir);

    const mdPath = join(result.provisioned[0].memoryDir, "MEMORY.md");
    const content = await Bun.file(mdPath).text();
    expect(content).toContain(fakeName);
    expect(content).toContain("Curated Memory");
  });

  test("returns correct memoryDir path", async () => {
    const fakeName = `_test_path_${Date.now()}`;
    const fakeMindsDir = tempDir;
    createFakeMind(fakeMindsDir, fakeName);
    provisioned.push(fakeName);
    const result = await provisionAllMinds(fakeMindsDir);

    expect(result.provisioned[0].memoryDir).toContain(fakeName);
    expect(result.provisioned[0].memoryDir).toContain("memory");
    // The dir should have been created
    expect(existsSync(result.provisioned[0].memoryDir)).toBe(true);
  });
});

describe("provisionAllMinds", () => {
  test("provisions all Minds with server.ts", async () => {
    const fakeMindsDir = tempDir;
    const names = [`_ta_${Date.now()}`, `_tb_${Date.now() + 1}`, `_tc_${Date.now() + 2}`];
    for (const n of names) {
      createFakeMind(fakeMindsDir, n);
      provisioned.push(n);
    }

    const result = await provisionAllMinds(fakeMindsDir);
    const resultNames = result.provisioned.map((r) => r.mindName).sort();
    expect(resultNames).toEqual(names.sort());
  });

  test("skips entries without server.ts", async () => {
    const fakeName = `_test_real_${Date.now()}`;
    const fakeMindsDir = tempDir;
    createFakeMind(fakeMindsDir, fakeName);
    provisioned.push(fakeName);
    // Non-Mind directory (no server.ts)
    mkdirSync(join(fakeMindsDir, "lib"), { recursive: true });
    // Non-Mind file
    writeFileSync(join(fakeMindsDir, "README.md"), "# readme", "utf8");

    const result = await provisionAllMinds(fakeMindsDir);
    expect(result.provisioned).toHaveLength(1);
    expect(result.provisioned[0].mindName).toBe(fakeName);
    expect(result.skipped).toContain("lib");
    expect(result.skipped).toContain("README.md");
  });

  test("idempotent — second run produces already_exists", async () => {
    const fakeName = `_test_idem_${Date.now()}`;
    const fakeMindsDir = tempDir;
    createFakeMind(fakeMindsDir, fakeName);
    provisioned.push(fakeName);

    const first = await provisionAllMinds(fakeMindsDir);
    expect(first.provisioned[0].status).toBe("created");

    const second = await provisionAllMinds(fakeMindsDir);
    expect(second.provisioned[0].status).toBe("already_exists");
  });

  test("throws with context on unreadable directory", async () => {
    await expect(provisionAllMinds("/nonexistent-path-xyz")).rejects.toThrow(
      /provisionAllMinds: cannot read minds directory/
    );
  });

  test("empty mindsDir produces empty results", async () => {
    const result = await provisionAllMinds(tempDir);
    expect(result.provisioned).toHaveLength(0);
  });
});
