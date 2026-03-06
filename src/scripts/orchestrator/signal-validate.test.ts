import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { openMetricsDb } from "../../../minds/observability/metrics";
import {
  parseSignal,
  validateSignal,
  type ParsedSignal,
  type ValidationResult,
} from "./signal-validate";

// ============================================================================
// Test fixtures
// ============================================================================

const PIPELINE = {
  version: "3.0",
  phases: [
    {
      id: "clarify",
      signals: ["CLARIFY_COMPLETE", "CLARIFY_QUESTION", "CLARIFY_ERROR"],
    },
    { id: "plan", signals: ["PLAN_COMPLETE", "PLAN_ERROR"] },
    {
      id: "blindqa",
      signals: [
        "BLINDQA_COMPLETE",
        "BLINDQA_FAILED",
        "BLINDQA_ERROR",
        "BLINDQA_QUESTION",
        "BLINDQA_WAITING",
      ],
    },
    { id: "done", terminal: true, signals: [] },
  ],
  transitions: [],
};

const REGISTRY = {
  ticket_id: "BRE-158",
  nonce: "abc12",
  current_step: "clarify",
  status: "running",
};

// ============================================================================
// parseSignal
// ============================================================================

describe("parseSignal", () => {
  test("parses valid signal string", () => {
    const result = parseSignal(
      "[SIGNAL:BRE-158:abc12] CLARIFY_COMPLETE | All questions answered"
    );
    expect(result).toEqual({
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "CLARIFY_COMPLETE",
      detail: "All questions answered",
    });
  });

  test("parses signal with complex detail containing pipes", () => {
    const result = parseSignal(
      "[SIGNAL:BRE-200:ff00aa] PLAN_COMPLETE | Plan looks good | reviewed by team"
    );
    // The regex captures everything after " | " as detail
    // Since our regex uses (.+)$ for detail, it captures "Plan looks good | reviewed by team"
    expect(result).not.toBeNull();
    expect(result!.ticketId).toBe("BRE-200");
    expect(result!.signalType).toBe("PLAN_COMPLETE");
  });

  test("returns null for invalid format - missing brackets", () => {
    expect(parseSignal("SIGNAL:BRE-158:abc12 CLARIFY_COMPLETE | done")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseSignal("")).toBeNull();
  });

  test("returns null for plain text", () => {
    expect(parseSignal("hello world")).toBeNull();
  });

  test("returns null for signal with uppercase nonce", () => {
    expect(
      parseSignal("[SIGNAL:BRE-158:ABC12] CLARIFY_COMPLETE | done")
    ).toBeNull();
  });

  test("returns null for signal with lowercase signal type", () => {
    expect(
      parseSignal("[SIGNAL:BRE-158:abc12] clarify_complete | done")
    ).toBeNull();
  });

  test("returns null for missing detail section", () => {
    expect(
      parseSignal("[SIGNAL:BRE-158:abc12] CLARIFY_COMPLETE")
    ).toBeNull();
  });

  test("parses signal with long hex nonce", () => {
    const result = parseSignal(
      "[SIGNAL:BRE-999:deadbeef0123] PLAN_COMPLETE | done"
    );
    expect(result).not.toBeNull();
    expect(result!.nonce).toBe("deadbeef0123");
  });
});

// ============================================================================
// validateSignal
// ============================================================================

describe("validateSignal", () => {
  test("valid signal returns full output object", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "CLARIFY_COMPLETE",
      detail: "All questions answered",
    };
    const result = validateSignal(parsed, REGISTRY, PIPELINE);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.ticket_id).toBe("BRE-158");
      expect(result.signal_type).toBe("CLARIFY_COMPLETE");
      expect(result.detail).toBe("All questions answered");
      expect(result.current_step).toBe("clarify");
      expect(result.nonce).toBe("abc12");
    }
  });

  test("nonce mismatch returns valid:false", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "wrong_nonce",
      signalType: "CLARIFY_COMPLETE",
      detail: "done",
    };
    const result = validateSignal(parsed, REGISTRY, PIPELINE);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Nonce mismatch");
      expect(result.expected_nonce).toBe("abc12");
      expect(result.received_nonce).toBe("wrong_nonce");
    }
  });

  test("signal type not in allowed list returns valid:false", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "PLAN_COMPLETE",
      detail: "done",
    };
    // PLAN_COMPLETE is not valid for the "clarify" phase
    const result = validateSignal(parsed, REGISTRY, PIPELINE);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Signal type not valid for current phase");
      expect(result.current_step).toBe("clarify");
      expect(result.allowed_signals).toContain("CLARIFY_COMPLETE");
    }
  });

  test("unknown current_step returns valid:false", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "CLARIFY_COMPLETE",
      detail: "done",
    };
    const badRegistry = { ...REGISTRY, current_step: "nonexistent_phase" };
    const result = validateSignal(parsed, badRegistry, PIPELINE);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Unknown current_step in registry");
    }
  });

  test("BLINDQA_QUESTION is valid for blindqa phase", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "BLINDQA_QUESTION",
      detail: "What framework?",
    };
    const blindqaRegistry = { ...REGISTRY, current_step: "blindqa" };
    const result = validateSignal(parsed, blindqaRegistry, PIPELINE);

    expect(result.valid).toBe(true);
  });

  test("CLARIFY_QUESTION is valid for clarify phase", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "CLARIFY_QUESTION",
      detail: "Need clarification",
    };
    const result = validateSignal(parsed, REGISTRY, PIPELINE);

    expect(result.valid).toBe(true);
  });

  test("multi-repo: pipeline from different repo is used when registry has repo_path", () => {
    // A registry entry with repo_path pointing to a repo with a different pipeline
    // validateSignal itself is pure — the CLI uses repo_path to resolve configPath.
    // This test verifies that validateSignal accepts a pipeline from a different repo.
    const altPipeline = {
      version: "3.0",
      phases: [{ id: "build", signals: ["BUILD_COMPLETE", "BUILD_ERROR"] }],
      transitions: [],
    };
    const altRegistry = {
      ticket_id: "BRE-999",
      nonce: "xyz99",
      current_step: "build",
      status: "running",
      repo_path: "/repos/backend",
    };
    const parsed: ParsedSignal = {
      ticketId: "BRE-999",
      nonce: "xyz99",
      signalType: "BUILD_COMPLETE",
      detail: "Build finished",
    };
    const result = validateSignal(parsed, altRegistry, altPipeline);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.current_step).toBe("build");
    }
  });
});

// ============================================================================
// Variant pipeline config resolution
// ============================================================================

describe("variant pipeline config resolution", () => {
  const VARIANT_PIPELINE = {
    version: "3.0",
    phases: [
      { id: "clarify", signals: ["CLARIFY_COMPLETE", "CLARIFY_ERROR"] },
      { id: "verify_execute", signals: ["VERIFY_EXECUTE_COMPLETE", "VERIFY_EXECUTE_ERROR"] },
      { id: "done", terminal: true, signals: [] },
    ],
    transitions: [],
  };

  test("unit: VERIFY_EXECUTE_COMPLETE is valid when variant pipeline has verify_execute phase", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-393",
      nonce: "abc12",
      signalType: "VERIFY_EXECUTE_COMPLETE",
      detail: "Verification passed",
    };
    const variantRegistry = {
      ticket_id: "BRE-393",
      nonce: "abc12",
      current_step: "verify_execute",
      status: "running",
      pipeline_variant: "verify",
    };
    const result = validateSignal(parsed, variantRegistry, VARIANT_PIPELINE);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.current_step).toBe("verify_execute");
    }
  });

  test("unit: VERIFY_EXECUTE_COMPLETE fails against default pipeline (no verify_execute phase)", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-393",
      nonce: "abc12",
      signalType: "VERIFY_EXECUTE_COMPLETE",
      detail: "Verification passed",
    };
    const defaultRegistry = {
      ticket_id: "BRE-393",
      nonce: "abc12",
      current_step: "verify_execute",
      status: "running",
    };
    // PIPELINE fixture has no verify_execute phase → unknown current_step
    const result = validateSignal(parsed, defaultRegistry, PIPELINE);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Unknown current_step in registry");
    }
  });
});

describe("signal-validate integration (variant pipeline config)", () => {
  let tmpDir: string;

  const DEFAULT_PIPELINE = {
    version: "3.0",
    phases: [
      { id: "clarify", signals: ["CLARIFY_COMPLETE", "CLARIFY_ERROR"] },
      { id: "done", terminal: true, signals: [] },
    ],
    transitions: [],
  };

  const VARIANT_PIPELINE = {
    version: "3.0",
    phases: [
      { id: "clarify", signals: ["CLARIFY_COMPLETE", "CLARIFY_ERROR"] },
      { id: "verify_execute", signals: ["VERIFY_EXECUTE_COMPLETE", "VERIFY_EXECUTE_ERROR"] },
      { id: "done", terminal: true, signals: [] },
    ],
    transitions: [],
  };

  function setupVariantRepo(opts: {
    ticketId: string;
    nonce: string;
    currentStep: string;
    pipelineVariant?: string;
  }): void {
    tmpDir = join(tmpdir(), `sig-variant-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const registryDir = join(tmpDir, ".collab", "state", "pipeline-registry");
    const configDir = join(tmpDir, ".collab", "config");
    const variantsDir = join(configDir, "pipeline-variants");

    mkdirSync(registryDir, { recursive: true });
    mkdirSync(variantsDir, { recursive: true });

    const registry: Record<string, unknown> = {
      ticket_id: opts.ticketId,
      nonce: opts.nonce,
      current_step: opts.currentStep,
      status: "running",
    };
    if (opts.pipelineVariant) {
      registry.pipeline_variant = opts.pipelineVariant;
    }

    writeFileSync(
      join(registryDir, `${opts.ticketId}.json`),
      JSON.stringify(registry, null, 2) + "\n"
    );
    writeFileSync(join(configDir, "pipeline.json"), JSON.stringify(DEFAULT_PIPELINE, null, 2) + "\n");
    writeFileSync(join(variantsDir, "verify.json"), JSON.stringify(VARIANT_PIPELINE, null, 2) + "\n");
  }

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("variant signal valid: VERIFY_EXECUTE_COMPLETE accepted when registry has pipeline_variant=verify", async () => {
    setupVariantRepo({
      ticketId: "BRE-501",
      nonce: "abc123",
      currentStep: "verify_execute",
      pipelineVariant: "verify",
    });

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-501:abc123] VERIFY_EXECUTE_COMPLETE | All checks passed"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(0);
    const out = await new Response(result.stdout).text();
    const parsed = JSON.parse(out);
    expect(parsed.valid).toBe(true);
    expect(parsed.current_step).toBe("verify_execute");
  });

  test("variant signal invalid: VERIFY_EXECUTE_COMPLETE rejected when no pipeline_variant set (uses default pipeline)", async () => {
    setupVariantRepo({
      ticketId: "BRE-502",
      nonce: "abc123",
      currentStep: "verify_execute",
      // no pipelineVariant → uses default pipeline.json which has no verify_execute
    });

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-502:abc123] VERIFY_EXECUTE_COMPLETE | All checks passed"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(2);
    // stderr may include git "fatal" line; parse last JSON line
    const err = await new Response(result.stderr).text();
    const jsonLine = err.trim().split("\n").find((l) => l.startsWith("{"));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBe("Unknown current_step in registry");
  });

  test("variant fallback: missing variant file falls back to default pipeline.json", async () => {
    setupVariantRepo({
      ticketId: "BRE-503",
      nonce: "abc123",
      currentStep: "clarify",
      pipelineVariant: "nonexistent-variant",
    });

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-503:abc123] CLARIFY_COMPLETE | Done"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    // Should succeed using default pipeline.json (which has clarify phase)
    expect(result.exitCode).toBe(0);
    const out = await new Response(result.stdout).text();
    const parsed = JSON.parse(out);
    expect(parsed.valid).toBe(true);
    expect(parsed.current_step).toBe("clarify");
  });
});

// ============================================================================
// Integration: signal logging written to SQLite signals table
// ============================================================================

describe("signal-validate integration (SQLite signal logging)", () => {
  let tmpDir: string;

  const PIPELINE_JSON = {
    version: "3.0",
    phases: [
      { id: "clarify", signals: ["CLARIFY_COMPLETE", "CLARIFY_QUESTION", "CLARIFY_ERROR"] },
      { id: "plan", signals: ["PLAN_COMPLETE", "PLAN_ERROR"] },
    ],
    transitions: [],
  };

  function setupTmpRepo(ticketId: string, nonce: string, currentStep: string): { metricsPath: string } {
    tmpDir = join(tmpdir(), `sig-val-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const registryDir = join(tmpDir, ".collab", "state", "pipeline-registry");
    const configDir = join(tmpDir, ".collab", "config");
    mkdirSync(registryDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    writeFileSync(
      join(registryDir, `${ticketId}.json`),
      JSON.stringify({ ticket_id: ticketId, nonce, current_step: currentStep, status: "running" }, null, 2) + "\n"
    );
    writeFileSync(join(configDir, "pipeline.json"), JSON.stringify(PIPELINE_JSON, null, 2) + "\n");

    return { metricsPath: join(tmpDir, ".collab", "state", "metrics.db") };
  }

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("valid signal: signals table row with parsed_ok=1, no error", async () => {
    const { metricsPath } = setupTmpRepo("BRE-101", "abc123", "clarify");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-101:abc123] CLARIFY_COMPLETE | All questions answered"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const row = db.query("SELECT * FROM signals LIMIT 1").get() as any;
    db.close();

    expect(row).not.toBeNull();
    expect(row.parsed_ok).toBe(1);
    expect(row.error).toBeNull();
    expect(row.signal_type).toBe("CLARIFY_COMPLETE");
    expect(row.phase).toBe("clarify");
    expect(row.run_id).toBe("BRE-101");
  });

  test("invalid format: signals table row with parsed_ok=0, error present", async () => {
    const { metricsPath } = setupTmpRepo("BRE-102", "abc123", "clarify");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"), "not a valid signal"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(2);

    const db = openMetricsDb(metricsPath);
    const row = db.query("SELECT * FROM signals LIMIT 1").get() as any;
    db.close();

    expect(row).not.toBeNull();
    expect(row.parsed_ok).toBe(0);
    expect(row.error).toBe("Signal format invalid");
    expect(row.run_id).toBe("unknown");
  });

  test("validation failure (wrong nonce): signals table row with parsed_ok=1, error present", async () => {
    // Registry has nonce abc123; signal uses def456 — both valid hex, but mismatch
    const { metricsPath } = setupTmpRepo("BRE-103", "abc123", "clarify");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-103:def456] CLARIFY_COMPLETE | done"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(2);

    const db = openMetricsDb(metricsPath);
    const row = db.query("SELECT * FROM signals LIMIT 1").get() as any;
    db.close();

    expect(row).not.toBeNull();
    expect(row.parsed_ok).toBe(1);
    expect(row.error).toBe("Nonce mismatch");
    expect(row.run_id).toBe("BRE-103");
  });

  test("emitted_at and processed_at are set on every row", async () => {
    const { metricsPath } = setupTmpRepo("BRE-104", "abc123", "clarify");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-104:abc123] CLARIFY_COMPLETE | done"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    const db = openMetricsDb(metricsPath);
    const row = db.query("SELECT * FROM signals LIMIT 1").get() as any;
    db.close();

    expect(row.emitted_at).toBeDefined();
    expect(row.processed_at).toBeDefined();
    // Both should be ISO 8601 timestamps
    expect(new Date(row.emitted_at).getTime()).not.toBeNaN();
    expect(new Date(row.processed_at).getTime()).not.toBeNaN();
  });

  test("latency_ms is >= 0", async () => {
    const { metricsPath } = setupTmpRepo("BRE-105", "abc123", "clarify");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-105:abc123] CLARIFY_COMPLETE | done"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    const db = openMetricsDb(metricsPath);
    const row = db.query("SELECT * FROM signals LIMIT 1").get() as any;
    db.close();

    expect(typeof row.latency_ms).toBe("number");
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
  });

  test("nonce mismatch: intervention logged to interventions table (type=manual_signal)", async () => {
    // Registry has nonce abc123; signal uses deadc0 — valid hex but wrong nonce
    const { metricsPath } = setupTmpRepo("BRE-106", "abc123", "clarify");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-106:deadc0] CLARIFY_COMPLETE | Manual attempt"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(2);

    const db = openMetricsDb(metricsPath);
    const intervention = db
      .query("SELECT type, phase FROM interventions WHERE run_id = 'BRE-106'")
      .get() as any;
    db.close();

    expect(intervention).not.toBeNull();
    expect(intervention.type).toBe("manual_signal");
    expect(intervention.phase).toBe("clarify");
  });

  test("valid signal: no intervention logged", async () => {
    const { metricsPath } = setupTmpRepo("BRE-107", "abc123", "clarify");

    const result = await Bun.spawn(
      ["bun", join(import.meta.dir, "signal-validate.ts"),
        "[SIGNAL:BRE-107:abc123] CLARIFY_COMPLETE | All good"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe" }
    );
    await result.exited;

    expect(result.exitCode).toBe(0);

    const db = openMetricsDb(metricsPath);
    const count = db
      .query("SELECT COUNT(*) as c FROM interventions WHERE run_id = 'BRE-107'")
      .get() as any;
    db.close();

    expect(count.c).toBe(0);
  });
});
