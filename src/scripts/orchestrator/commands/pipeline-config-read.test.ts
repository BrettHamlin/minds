import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
  cwd: import.meta.dir,
}).trim();

const CONFIG_DIR = path.join(REPO_ROOT, ".collab/config");
const SCRIPT = path.join(import.meta.dir, "pipeline-config-read.ts");

// Backup + restore the real pipeline.json
let originalConfig: string | null = null;
const configPath = path.join(CONFIG_DIR, "pipeline.json");

function writeTestConfig(obj: object): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(obj, null, 2));
}

beforeAll(() => {
  if (fs.existsSync(configPath)) {
    originalConfig = fs.readFileSync(configPath, "utf-8");
  }
});

afterAll(() => {
  if (originalConfig !== null) {
    fs.writeFileSync(configPath, originalConfig);
  } else if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
});

function runScript(args: string): string {
  return execSync(`bun ${SCRIPT} ${args}`, {
    encoding: "utf-8",
    cwd: REPO_ROOT,
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
      codeReview: { enabled: true, model: "claude-haiku-4-5", maxAttempts: 5, file: "arch.md" },
    });
    const out = runScript("codereview");
    expect(out).toContain("CR_ENABLED=true");
    expect(out).toContain("CR_MODEL=claude-haiku-4-5");
    expect(out).toContain("CR_MAX=5");
    expect(out).toContain("CR_FILE=arch.md");
  });

  test("3. CR_ENABLED=false when codeReview.enabled is false", () => {
    writeTestConfig({ codeReview: { enabled: false } });
    const out = runScript("codereview");
    expect(out).toContain("CR_ENABLED=false");
  });

  test("4. PHASE_CR=false when phase overrides to false", () => {
    writeTestConfig({
      codeReview: { enabled: true },
      phases: { implement: { codeReview: { enabled: false } } },
    });
    const out = runScript("codereview --phase implement");
    expect(out).toContain("PHASE_CR=false");
  });

  test("5. PHASE_CR=true when phase overrides to true", () => {
    writeTestConfig({
      codeReview: { enabled: false },
      phases: { implement: { codeReview: { enabled: true } } },
    });
    const out = runScript("codereview --phase implement");
    expect(out).toContain("PHASE_CR=true");
  });

  test("6. PHASE_CR=inherit when phase has no codeReview override", () => {
    writeTestConfig({
      codeReview: { enabled: true },
      phases: { implement: {} },
    });
    const out = runScript("codereview --phase implement");
    expect(out).toContain("PHASE_CR=inherit");
  });

  test("7. PHASE_CR=inherit when --phase not specified", () => {
    writeTestConfig({ codeReview: { enabled: true } });
    const out = runScript("codereview");
    expect(out).toContain("PHASE_CR=inherit");
  });

  test("8. exits 1 for unknown command", () => {
    let threw = false;
    try {
      execSync(`bun ${SCRIPT} unknown-command`, { encoding: "utf-8", cwd: REPO_ROOT });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
