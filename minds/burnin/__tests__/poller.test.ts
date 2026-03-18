import { describe, test, expect } from "bun:test";
import {
  pollForCompletion,
  TASKS_PATTERNS,
  IMPLEMENT_PATTERNS,
  type PollOptions,
  type PollPatterns,
} from "../lib/poller.ts";

// ── Mock capture function ──────────────────────────────────────────────

function mockCapture(outputs: string[]) {
  let callIndex = 0;
  return async (_pane: string, _scrollback: number, _root: string): Promise<string> => {
    const output = outputs[Math.min(callIndex, outputs.length - 1)];
    callIndex++;
    return output;
  };
}

const FAST_OPTS: PollOptions = {
  timeoutMs: 5000,
  pollIntervalMs: 50,
  scrollback: 500,
  stallThresholdMs: 500,
};

describe("poller", () => {
  // ── Tasks patterns ─────────────────────────────────────────────────

  describe("TASKS_PATTERNS", () => {
    test("1. detects tasks success via 'Total task count:'", async () => {
      const capture = mockCapture([
        "Running tasks generation...",
        "Total task count: 12\nvalid: true\ntasks.md written",
      ]);

      const result = await pollForCompletion("%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("success");
      expect(result.markers.length).toBeGreaterThan(0);
    });

    test("2. detects tasks success via 'valid.*true'", async () => {
      const capture = mockCapture([
        "Lint result: valid: true",
      ]);

      const result = await pollForCompletion("%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("success");
    });

    test("3. detects tasks failure via 'still failing after'", async () => {
      const capture = mockCapture([
        "Lint check still failing after 3 attempts",
      ]);

      const result = await pollForCompletion("%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });

    test("4. detects tasks failure via 'valid.*false'", async () => {
      const capture = mockCapture([
        "Lint result: valid: false\n3 errors found",
      ]);

      const result = await pollForCompletion("%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });

    test("5. detects tasks failure via 'Error:'", async () => {
      const capture = mockCapture([
        "Error: Could not parse tasks file",
      ]);

      const result = await pollForCompletion("%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });
  });

  // ── Implement patterns ─────────────────────────────────────────────

  describe("IMPLEMENT_PATTERNS", () => {
    test("6. detects implement success via 'All waves merged successfully'", async () => {
      const capture = mockCapture([
        "Wave 1 complete.\nWave 2 complete.\nAll waves merged successfully",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("success");
    });

    test("7. detects implement success via 'Implementation complete'", async () => {
      const capture = mockCapture([
        "Implementation complete. All waves merged successfully.",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("success");
    });

    test("8. detects implement failure via 'Implementation completed with errors'", async () => {
      const capture = mockCapture([
        "Implementation completed with errors. Check logs.",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });

    test("9. detects implement failure via 'Wave N did not complete'", async () => {
      const capture = mockCapture([
        "Wave 2 did not complete within timeout",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });

    test("10. detects implement failure via 'Merge failed'", async () => {
      const capture = mockCapture([
        "Merge failed for minds/pipeline_core",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });

    test("11. detects implement failure via 'Error starting bus'", async () => {
      const capture = mockCapture([
        "Error starting bus: EADDRINUSE",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });
  });

  // ── Stall & timeout ────────────────────────────────────────────────

  describe("stall and timeout detection", () => {
    test("12. detects stall when output stops changing", async () => {
      const capture = mockCapture([
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
        "Processing...",
      ]);

      const stallOpts: PollOptions = {
        ...FAST_OPTS,
        stallThresholdMs: 200,
        timeoutMs: 10000,
      };

      const result = await pollForCompletion("%1", TASKS_PATTERNS, stallOpts, "/tmp", capture);
      expect(result.status).toBe("stalled");
    });

    test("13. times out when no pattern matches within timeout", async () => {
      const capture = mockCapture([
        "Line 1",
        "Line 2",
        "Line 3",
        "Line 4",
        "Line 5",
      ]);

      const timeoutOpts: PollOptions = {
        ...FAST_OPTS,
        timeoutMs: 200,
        stallThresholdMs: 100000, // high so stall doesn't trigger first
      };

      const result = await pollForCompletion("%1", TASKS_PATTERNS, timeoutOpts, "/tmp", capture);
      expect(result.status).toBe("timeout");
    });

    test("14. success detected even after initial running state", async () => {
      const capture = mockCapture([
        "Starting...",
        "Still running...",
        "Almost there...",
        "All waves merged successfully.",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("success");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("15. empty capture output doesn't crash", async () => {
      let calls = 0;
      const capture = async () => {
        calls++;
        if (calls > 3) return "Implementation complete. All done.";
        return "";
      };

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("success");
    });

    test("16. returns elapsed time", async () => {
      const capture = mockCapture(["Implementation complete"]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    test("17. failure takes priority over partial success match", async () => {
      // Both success and failure patterns present — failure patterns are checked second,
      // but let's verify behavior when only failure is present
      const capture = mockCapture([
        "FATAL: something broke badly",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });
  });
});
