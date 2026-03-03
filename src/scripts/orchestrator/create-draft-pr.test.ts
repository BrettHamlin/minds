// BRE-284: create_draft_pr — GitHub draft PR creation and metrics stamping
import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  openMetricsDb,
  openInMemoryMetricsDb,
  ensureRun,
  stampPrOnRun,
} from "../../lib/pipeline/metrics";
import {
  extractPrNumber,
  buildPrTitle,
  buildPrBody,
} from "../../lib/pipeline/draft-pr";

// ============================================================================
// Unit tests: extractPrNumber
// ============================================================================

describe("extractPrNumber", () => {
  test("extracts 42 from standard GitHub PR URL", () => {
    expect(extractPrNumber("https://github.com/owner/repo/pull/42")).toBe(42);
  });

  test("extracts 123 from GitHub PR URL", () => {
    expect(extractPrNumber("https://github.com/owner/repo/pull/123")).toBe(123);
  });

  test("throws for non-URL string", () => {
    expect(() => extractPrNumber("not-a-url")).toThrow();
  });

  test("throws for URL without /pull/ segment", () => {
    expect(() =>
      extractPrNumber("https://github.com/owner/repo/issues/42")
    ).toThrow();
  });

  test("extracts PR number from URL with trailing newline", () => {
    expect(
      extractPrNumber("https://github.com/owner/repo/pull/99\n")
    ).toBe(99);
  });
});

// ============================================================================
// Unit tests: buildPrTitle
// ============================================================================

describe("buildPrTitle", () => {
  test("contains ticketId and branch", () => {
    const title = buildPrTitle("BRE-284", "284-draft-pr");
    expect(title).toContain("BRE-284");
    expect(title).toContain("284-draft-pr");
  });
});

// ============================================================================
// Unit tests: buildPrBody
// ============================================================================

describe("buildPrBody", () => {
  test("contains ticketId and branch", () => {
    const body = buildPrBody("BRE-284", "284-draft-pr");
    expect(body).toContain("BRE-284");
    expect(body).toContain("284-draft-pr");
  });
});

// ============================================================================
// Unit tests: stampPrOnRun (metrics)
// ============================================================================

describe("stampPrOnRun", () => {
  test("stamps pr_url, pr_number, pr_branch on existing run", () => {
    const db = openInMemoryMetricsDb();
    ensureRun(db, "STAMP-1");

    stampPrOnRun(
      db,
      "STAMP-1",
      "https://github.com/test/repo/pull/42",
      42,
      "feat-branch"
    );

    const row = db
      .query(
        "SELECT pr_url, pr_number, pr_branch FROM runs WHERE id = 'STAMP-1'"
      )
      .get() as any;
    expect(row.pr_url).toBe("https://github.com/test/repo/pull/42");
    expect(row.pr_number).toBe(42);
    expect(row.pr_branch).toBe("feat-branch");
    db.close();
  });

  test("no-ops on non-existent run (UPDATE matches nothing, no throw)", () => {
    const db = openInMemoryMetricsDb();

    // Should not throw
    expect(() =>
      stampPrOnRun(
        db,
        "GHOST-RUN",
        "https://github.com/test/repo/pull/99",
        99,
        "ghost-branch"
      )
    ).not.toThrow();

    db.close();
  });
});

// ============================================================================
// Schema: PR columns exist after openInMemoryMetricsDb
// ============================================================================

describe("Schema — PR columns", () => {
  test("runs table has pr_url, pr_number, pr_branch columns", () => {
    const db = openInMemoryMetricsDb();

    const columns = db.query("PRAGMA table_info(runs)").all() as Array<{
      name: string;
      type: string;
    }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("pr_url");
    expect(colNames).toContain("pr_number");
    expect(colNames).toContain("pr_branch");

    db.close();
  });
});

// ============================================================================
// CLI integration tests: create-draft-pr.ts via Bun.spawn with mocked gh
// ============================================================================

describe("create-draft-pr CLI integration", () => {
  let tmpDir: string;

  const PIPELINE_JSON = {
    version: "3.1",
    metrics: { enabled: true },
    phases: {
      impl: {
        signals: ["IMPL_COMPLETE"],
        transitions: { IMPL_COMPLETE: { to: "done" } },
      },
      done: { terminal: true },
    },
  };

  function setupTmpRepo(ticketId: string): {
    metricsPath: string;
    binDir: string;
    patchedPath: string;
  } {
    tmpDir = join(
      tmpdir(),
      `pr-int-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const stateDir = join(tmpDir, ".collab", "state", "pipeline-registry");
    const configDir = join(tmpDir, ".collab", "config");
    const binDir = join(tmpDir, "bin");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    writeFileSync(
      join(configDir, "pipeline.json"),
      JSON.stringify(PIPELINE_JSON, null, 2)
    );
    writeFileSync(
      join(stateDir, `${ticketId}.json`),
      JSON.stringify({ ticket_id: ticketId, status: "running" }, null, 2)
    );

    // Initialize git repo with a commit so git rev-parse --abbrev-ref HEAD works
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync("git checkout -b 284-test-feature", {
      cwd: tmpDir,
      stdio: "ignore",
    });
    execSync('git commit --allow-empty -m "init"', {
      cwd: tmpDir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    });

    // Write fake gh that outputs a PR URL
    const fakeGh = join(binDir, "gh");
    writeFileSync(
      fakeGh,
      '#!/bin/bash\necho "https://github.com/test/repo/pull/42"\n'
    );
    chmodSync(fakeGh, 0o755);

    // Seed metrics DB with a run row
    const metricsPath = join(tmpDir, ".collab", "state", "metrics.db");
    const db = openMetricsDb(metricsPath);
    ensureRun(db, ticketId);
    db.close();

    const patchedPath = `${binDir}:${process.env.PATH}`;
    return { metricsPath, binDir, patchedPath };
  }

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("exits 0, outputs JSON with prUrl/prNumber/prBranch", async () => {
    const { patchedPath } = setupTmpRepo("BRE-PR-CLI-1");

    const proc = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "create-draft-pr.ts"),
        "BRE-PR-CLI-1",
      ],
      {
        cwd: tmpDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: patchedPath },
      }
    );
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    const out = JSON.parse(await new Response(proc.stdout).text());
    expect(out.prUrl).toBe("https://github.com/test/repo/pull/42");
    expect(out.prNumber).toBe(42);
    expect(out.prBranch).toBe("284-test-feature");
  });

  test("stamps DB with PR info after success", async () => {
    const { metricsPath, patchedPath } = setupTmpRepo("BRE-PR-CLI-2");

    const proc = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "create-draft-pr.ts"),
        "BRE-PR-CLI-2",
      ],
      {
        cwd: tmpDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PATH: patchedPath },
      }
    );
    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const row = db
      .query(
        "SELECT pr_url, pr_number, pr_branch FROM runs WHERE id = 'BRE-PR-CLI-2'"
      )
      .get() as any;
    db.close();

    expect(row.pr_url).toBe("https://github.com/test/repo/pull/42");
    expect(row.pr_number).toBe(42);
    expect(row.pr_branch).toBe("284-test-feature");
  });

  test("exits 1 when no TICKET_ID given", async () => {
    tmpDir = join(tmpdir(), `pr-noid-${Date.now()}`);
    mkdirSync(join(tmpDir, ".collab", "config"), { recursive: true });
    writeFileSync(join(tmpDir, ".collab", "config", "pipeline.json"), "{}");

    const proc = Bun.spawn(
      ["bun", join(import.meta.dir, "create-draft-pr.ts")],
      {
        cwd: tmpDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;

    expect(proc.exitCode).toBe(1);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain("Usage:");
  });

  test("exits 3 when @metrics disabled", async () => {
    tmpDir = join(tmpdir(), `pr-disabled-${Date.now()}`);
    mkdirSync(join(tmpDir, ".collab", "config"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".collab", "config", "pipeline.json"),
      JSON.stringify({ metrics: { enabled: false } })
    );

    const proc = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "create-draft-pr.ts"),
        "BRE-PR-CLI-SKIP",
      ],
      {
        cwd: tmpDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;

    expect(proc.exitCode).toBe(3);
    const out = JSON.parse(await new Response(proc.stdout).text());
    expect(out.skipped).toBe(true);
  });

  test("exits 2 when gh command fails", async () => {
    const failDir = join(
      tmpdir(),
      `pr-ghfail-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const stateDir = join(failDir, ".collab", "state", "pipeline-registry");
    const configDir = join(failDir, ".collab", "config");
    const binDir = join(failDir, "bin");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    writeFileSync(
      join(configDir, "pipeline.json"),
      JSON.stringify(PIPELINE_JSON, null, 2)
    );
    writeFileSync(
      join(stateDir, "BRE-PR-CLI-FAIL.json"),
      JSON.stringify({ ticket_id: "BRE-PR-CLI-FAIL", status: "running" })
    );

    // Initialize git repo with a commit
    execSync("git init", { cwd: failDir, stdio: "ignore" });
    execSync("git checkout -b 284-fail-branch", {
      cwd: failDir,
      stdio: "ignore",
    });
    execSync('git commit --allow-empty -m "init"', {
      cwd: failDir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    });

    // Fake gh that exits 1 (simulating failure)
    const fakeGh = join(binDir, "gh");
    writeFileSync(
      fakeGh,
      '#!/bin/bash\necho "error: not logged in" >&2\nexit 1\n'
    );
    chmodSync(fakeGh, 0o755);

    // Seed metrics
    const metricsPath = join(failDir, ".collab", "state", "metrics.db");
    const db = openMetricsDb(metricsPath);
    ensureRun(db, "BRE-PR-CLI-FAIL");
    db.close();

    const patchedPath = `${binDir}:${process.env.PATH}`;

    try {
      const proc = Bun.spawn(
        [
          "bun",
          join(import.meta.dir, "create-draft-pr.ts"),
          "BRE-PR-CLI-FAIL",
        ],
        {
          cwd: failDir,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, PATH: patchedPath },
        }
      );
      await proc.exited;

      expect(proc.exitCode).toBe(2);
    } finally {
      if (existsSync(failDir)) rmSync(failDir, { recursive: true });
    }
  });
});
