import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { writeJsonAtomic } from "../pipeline_core";

const SCRIPT = path.join(import.meta.dir, "pipeline-config-read.ts");
const TICKET_ID = "TEST-PCR";

let tmpDir: string;
let configDir: string;
let registryDir: string;
let configPath: string;

function writeTestConfig(obj: object): void {
  fs.writeFileSync(configPath, JSON.stringify(obj, null, 2));
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-pcr-"));
  configDir = path.join(tmpDir, ".collab", "config");
  registryDir = path.join(tmpDir, ".collab", "state", "pipeline-registry");
  configPath = path.join(configDir, "pipeline.json");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(registryDir, { recursive: true });

  // Create registry entry (no variant — uses default pipeline.json)
  writeJsonAtomic(path.join(registryDir, `${TICKET_ID}.json`), {
    ticket_id: TICKET_ID,
    current_step: "clarify",
  });

  // Initialize git so getRepoRoot() works
  execSync("git init", { cwd: tmpDir, stdio: "pipe" });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runScript(args: string): string {
  return execSync(`bun ${SCRIPT} ${TICKET_ID} ${args}`, {
    encoding: "utf-8",
    cwd: tmpDir,
  }).trim();
}

describe("pipeline-config-read: codereview command", () => {
  test("1. outputs defaults when codeReview is absent", () => {
    writeTestConfig({ phases: {} });
    const out = runScript("codereview");
    expect(out).toContain("CR_ENABLED=true");
    expect(out).toContain("CR_MODEL=claude-opus-4-6");
    expect(out).toContain("CR_MAX=3");
    expect(out).toContain("CR_FILE=");
    expect(out).toContain("PHASE_CR=inherit");
  });

  test("2. reflects explicit codeReview config", () => {
    writeTestConfig({
      phases: {},
      codeReview: { enabled: true, model: "claude-haiku-4-5", maxAttempts: 5, file: "arch.md" },
    });
    const out = runScript("codereview");
    expect(out).toContain("CR_ENABLED=true");
    expect(out).toContain("CR_MODEL=claude-haiku-4-5");
    expect(out).toContain("CR_MAX=5");
    expect(out).toContain("CR_FILE=arch.md");
  });

  test("3. CR_ENABLED=false when codeReview.enabled is false", () => {
    writeTestConfig({ phases: {}, codeReview: { enabled: false } });
    const out = runScript("codereview");
    expect(out).toContain("CR_ENABLED=false");
  });

  test("4. PHASE_CR=false when phase overrides to false", () => {
    writeTestConfig({
      phases: { implement: { codeReview: { enabled: false } } },
      codeReview: { enabled: true },
    });
    const out = runScript("codereview --phase implement");
    expect(out).toContain("PHASE_CR=false");
  });

  test("5. PHASE_CR=true when phase overrides to true", () => {
    writeTestConfig({
      phases: { implement: { codeReview: { enabled: true } } },
      codeReview: { enabled: false },
    });
    const out = runScript("codereview --phase implement");
    expect(out).toContain("PHASE_CR=true");
  });

  test("6. PHASE_CR=inherit when phase has no codeReview override", () => {
    writeTestConfig({
      phases: { implement: {} },
      codeReview: { enabled: true },
    });
    const out = runScript("codereview --phase implement");
    expect(out).toContain("PHASE_CR=inherit");
  });

  test("7. PHASE_CR=inherit when --phase not specified", () => {
    writeTestConfig({ phases: {}, codeReview: { enabled: true } });
    const out = runScript("codereview");
    expect(out).toContain("PHASE_CR=inherit");
  });

  test("8. exits 1 for unknown command", () => {
    let threw = false;
    try {
      execSync(`bun ${SCRIPT} ${TICKET_ID} unknown-command`, { encoding: "utf-8", cwd: tmpDir });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("9. flag as first arg prints clear error and exits 1", async () => {
    const proc = Bun.spawn(
      ["bun", SCRIPT, "--codereview"],
      { cwd: tmpDir, stderr: "pipe", stdout: "pipe" }
    );
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error: First argument must be a ticket ID, not a flag.");
    expect(stderr).toContain('Got: "--codereview"');
  });
});
