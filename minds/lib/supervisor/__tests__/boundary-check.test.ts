/**
 * boundary-check.test.ts — Tests for deterministic boundary enforcement.
 */

import { describe, test, expect } from "bun:test";
import { checkBoundary, parseDiffPaths } from "../boundary-check.ts";

// ---------------------------------------------------------------------------
// parseDiffPaths
// ---------------------------------------------------------------------------

describe("parseDiffPaths", () => {
  test("extracts file paths from a multi-file diff", () => {
    const diff = `diff --git a/minds/transport/publish.ts b/minds/transport/publish.ts
index abc1234..def5678 100644
--- a/minds/transport/publish.ts
+++ b/minds/transport/publish.ts
@@ -1,3 +1,5 @@
+// new code
diff --git a/minds/transport/types.ts b/minds/transport/types.ts
index 111..222 100644
--- a/minds/transport/types.ts
+++ b/minds/transport/types.ts
@@ -1 +1,2 @@
+// more code`;

    const paths = parseDiffPaths(diff);
    expect(paths).toEqual([
      "minds/transport/publish.ts",
      "minds/transport/types.ts",
    ]);
  });

  test("returns empty array for empty diff", () => {
    expect(parseDiffPaths("")).toEqual([]);
  });

  test("returns empty array for diff with no file headers", () => {
    expect(parseDiffPaths("+// some added line\n-// some removed line")).toEqual([]);
  });

  test("handles renamed files (extracts b/ path)", () => {
    const diff = `diff --git a/old/path.ts b/new/path.ts
--- a/old/path.ts
+++ b/new/path.ts`;
    const paths = parseDiffPaths(diff);
    expect(paths).toEqual(["new/path.ts"]);
  });
});

// ---------------------------------------------------------------------------
// checkBoundary — infrastructure exclusion
// ---------------------------------------------------------------------------

describe("checkBoundary — infrastructure exclusion", () => {
  test("rejects modification to package.json", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1,2 @@
+  "new-dep": "1.0.0"`;

    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe("package.json");
    expect(result.violations[0].message).toContain("protected infrastructure file");
  });

  test("rejects modification to bun.lock", () => {
    const diff = `diff --git a/bun.lock b/bun.lock
+++ b/bun.lock`;
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
    expect(result.violations[0].file).toBe("bun.lock");
  });

  test("rejects modification to tsconfig.json at root", () => {
    const diff = `diff --git a/tsconfig.json b/tsconfig.json
+++ b/tsconfig.json`;
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
  });

  test("rejects modification to CLAUDE.md", () => {
    const diff = `diff --git a/CLAUDE.md b/CLAUDE.md
+++ b/CLAUDE.md`;
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
  });

  test("rejects modification to .claude/ directory files", () => {
    const diff = `diff --git a/.claude/settings.json b/.claude/settings.json
+++ b/.claude/settings.json`;
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
    expect(result.violations[0].message).toContain("protected infrastructure file");
  });

  test("rejects modification to minds/minds.json", () => {
    const diff = `diff --git a/minds/minds.json b/minds/minds.json
+++ b/minds/minds.json`;
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
  });

  test("rejects modification to minds/STANDARDS.md", () => {
    const diff = `diff --git a/minds/STANDARDS.md b/minds/STANDARDS.md
+++ b/minds/STANDARDS.md`;
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
  });

  test("rejects modification to minds/tsconfig.json", () => {
    const diff = `diff --git a/minds/tsconfig.json b/minds/tsconfig.json
+++ b/minds/tsconfig.json`;
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
  });

  test("rejects modification to minds/STANDARDS-project.md", () => {
    const diff = `diff --git a/minds/STANDARDS-project.md b/minds/STANDARDS-project.md
+++ b/minds/STANDARDS-project.md`;
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkBoundary — ownership enforcement
// ---------------------------------------------------------------------------

describe("checkBoundary — ownership enforcement", () => {
  test("passes when all files are within owns_files", () => {
    const diff = `diff --git a/minds/transport/publish.ts b/minds/transport/publish.ts
+++ b/minds/transport/publish.ts
diff --git a/minds/transport/types.ts b/minds/transport/types.ts
+++ b/minds/transport/types.ts`;

    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("rejects files outside owns_files boundary", () => {
    const diff = `diff --git a/minds/transport/publish.ts b/minds/transport/publish.ts
+++ b/minds/transport/publish.ts
diff --git a/minds/signals/emit.ts b/minds/signals/emit.ts
+++ b/minds/signals/emit.ts`;

    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe("minds/signals/emit.ts");
    expect(result.violations[0].message).toContain("outside your boundary");
  });

  test("supports multiple owns_files prefixes", () => {
    const diff = `diff --git a/minds/transport/publish.ts b/minds/transport/publish.ts
+++ b/minds/transport/publish.ts
diff --git a/minds/shared/paths.ts b/minds/shared/paths.ts
+++ b/minds/shared/paths.ts`;

    const result = checkBoundary(diff, ["minds/transport/", "minds/shared/"], "transport");
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("handles glob-suffixed owns_files patterns (e.g. src/middleware/cors/**)", () => {
    const diff = `diff --git a/src/middleware/cors/index.ts b/src/middleware/cors/index.ts
+++ b/src/middleware/cors/index.ts
diff --git a/src/middleware/cors/index.test.ts b/src/middleware/cors/index.test.ts
+++ b/src/middleware/cors/index.test.ts`;

    const result = checkBoundary(diff, ["src/middleware/cors/**"], "cors");
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("rejects files outside glob-suffixed boundary", () => {
    const diff = `diff --git a/src/middleware/cors/index.ts b/src/middleware/cors/index.ts
+++ b/src/middleware/cors/index.ts
diff --git a/src/middleware/csrf/index.ts b/src/middleware/csrf/index.ts
+++ b/src/middleware/csrf/index.ts`;

    const result = checkBoundary(diff, ["src/middleware/cors/**"], "cors");
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe("src/middleware/csrf/index.ts");
  });

  test("skips ownership check when ownsFiles is empty", () => {
    const diff = `diff --git a/src/anything.ts b/src/anything.ts
+++ b/src/anything.ts
diff --git a/lib/other.ts b/lib/other.ts
+++ b/lib/other.ts`;

    const result = checkBoundary(diff, [], "unknown");
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("infrastructure files are rejected even with empty ownsFiles", () => {
    const diff = `diff --git a/package.json b/package.json
+++ b/package.json
diff --git a/src/anything.ts b/src/anything.ts
+++ b/src/anything.ts`;

    const result = checkBoundary(diff, [], "unknown");
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe("package.json");
  });
});

// ---------------------------------------------------------------------------
// checkBoundary — .minds/ vs minds/ normalization
// ---------------------------------------------------------------------------

describe("checkBoundary — prefix normalization", () => {
  test("normalizes .minds/ to minds/ for ownership matching", () => {
    const diff = `diff --git a/.minds/transport/publish.ts b/.minds/transport/publish.ts
+++ b/.minds/transport/publish.ts`;

    // owns_files uses minds/ prefix, but diff uses .minds/
    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("normalizes owns_files .minds/ prefix to minds/", () => {
    const diff = `diff --git a/minds/transport/publish.ts b/minds/transport/publish.ts
+++ b/minds/transport/publish.ts`;

    // owns_files uses .minds/ prefix, but diff uses minds/
    const result = checkBoundary(diff, [".minds/transport/"], "transport");
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("normalizes infrastructure check for .minds/ paths", () => {
    const diff = `diff --git a/.minds/minds.json b/.minds/minds.json
+++ b/.minds/minds.json`;

    const result = checkBoundary(diff, [".minds/transport/"], "transport");
    expect(result.pass).toBe(false);
    expect(result.violations[0].message).toContain("protected infrastructure file");
  });
});

// ---------------------------------------------------------------------------
// checkBoundary — combined scenarios
// ---------------------------------------------------------------------------

describe("checkBoundary — combined scenarios", () => {
  test("reports both infrastructure and boundary violations", () => {
    const diff = `diff --git a/minds/transport/publish.ts b/minds/transport/publish.ts
+++ b/minds/transport/publish.ts
diff --git a/package.json b/package.json
+++ b/package.json
diff --git a/minds/signals/emit.ts b/minds/signals/emit.ts
+++ b/minds/signals/emit.ts`;

    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(2);

    const messages = result.violations.map((v) => v.message);
    expect(messages.some((m) => m.includes("protected infrastructure file"))).toBe(true);
    expect(messages.some((m) => m.includes("outside your boundary"))).toBe(true);
  });

  test("passes with empty diff", () => {
    const result = checkBoundary("", ["minds/transport/"], "transport");
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("handles diff with only infrastructure violations", () => {
    const diff = `diff --git a/CLAUDE.md b/CLAUDE.md
+++ b/CLAUDE.md
diff --git a/bun.lock b/bun.lock
+++ b/bun.lock`;

    const result = checkBoundary(diff, ["minds/transport/"], "transport");
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(2);
    // Both should be infrastructure violations, not boundary violations
    for (const v of result.violations) {
      expect(v.message).toContain("protected infrastructure file");
    }
  });
});
