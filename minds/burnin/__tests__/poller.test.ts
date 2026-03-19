import { describe, test, expect } from "bun:test";
import {
  pollForCompletion,
  extractNewContent,
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

    test("17. failure takes priority when both success and failure patterns match", async () => {
      // Both success and failure patterns present in same output — failure wins
      const capture = mockCapture([
        "Implementation complete. But also FATAL: something broke badly",
      ]);

      const result = await pollForCompletion("%1", IMPLEMENT_PATTERNS, FAST_OPTS, "/tmp", capture);
      expect(result.status).toBe("failure");
    });
  });

  // ── extractNewContent ─────────────────────────────────────────────

  describe("extractNewContent", () => {
    test("18. returns full output when baseline is empty", () => {
      const result = extractNewContent("Hello world", "");
      expect(result).toBe("Hello world");
    });

    test("19. strips baseline prefix and returns only new content", () => {
      const baseline = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      const fullOutput = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nNew line 6\nNew line 7";
      const result = extractNewContent(fullOutput, baseline);
      expect(result).toBe("\nNew line 6\nNew line 7");
    });

    test("20. returns full output when baseline anchor not found (scrollback replaced)", () => {
      const baseline = "Old content A\nOld content B\nOld content C\nOld content D\nOld content E";
      const fullOutput = "Entirely new content\nNothing from baseline";
      const result = extractNewContent(fullOutput, baseline);
      expect(result).toBe("Entirely new content\nNothing from baseline");
    });

    test("21. handles baseline with fewer than 5 non-empty lines", () => {
      const baseline = "Line 1\nLine 2";
      const fullOutput = "Line 1\nLine 2\nNew stuff";
      const result = extractNewContent(fullOutput, baseline);
      expect(result).toBe("\nNew stuff");
    });

    test("22. handles baseline with trailing empty lines", () => {
      // Trailing empty lines in baseline are stripped before anchor computation.
      // The anchor "Line 2" (last non-empty line) is found in the output.
      const baseline = "Line 1\n\n\nLine 2\n\n";
      const fullOutput = "Line 1\n\n\nLine 2\n\nNew output here";
      const result = extractNewContent(fullOutput, baseline);
      expect(result).toBe("\n\nNew output here");
    });
  });

  // ── Baseline filtering (false positive prevention) ────────────────

  describe("baseline filtering", () => {
    test("23. ignores old Error: in scrollback when baseline is provided", async () => {
      // Simulate: scrollback contains old "Error: Exit code 1" from a prior run.
      // After the command is sent, new output is just "Processing..." — no error.
      const oldContent = "Previous session output\nError: Exit code 1\nSome other old stuff\nMore old lines\nEnd of old session";
      const capture = mockCapture([
        oldContent + "\nProcessing task generation...",
        oldContent + "\nProcessing task generation...\nStill working...",
        oldContent + "\nProcessing task generation...\nStill working...\nTotal task count: 5\nvalid: true",
      ]);

      const result = await pollForCompletion(
        "%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture,
        oldContent, // baseline captured before command was sent
      );
      // Should succeed — the old "Error:" is in the baseline and ignored
      expect(result.status).toBe("success");
    });

    test("24. still catches real Error: in new output after baseline", async () => {
      const oldContent = "Previous clean session\nNo errors here\nAll good\nReady\nWaiting for input";
      const capture = mockCapture([
        oldContent + "\nRunning tasks...",
        oldContent + "\nRunning tasks...\nError: Could not parse tasks file",
      ]);

      const result = await pollForCompletion(
        "%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture,
        oldContent,
      );
      expect(result.status).toBe("failure");
      expect(result.markers).toContain("Error:");
    });

    test("25. ignores old 'valid.*false' in scrollback with baseline", async () => {
      const oldContent = "Prior lint run\nLint result: valid: false\n3 errors\nFixed and re-ran\nDone with old session";
      const capture = mockCapture([
        oldContent + "\nNew lint run starting...",
        oldContent + "\nNew lint run starting...\nTotal task count: 8\nvalid: true",
      ]);

      const result = await pollForCompletion(
        "%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture,
        oldContent,
      );
      expect(result.status).toBe("success");
    });

    test("26. without baseline, old Error: causes false positive (demonstrates the bug)", async () => {
      // Same scenario as test 23 but WITHOUT baseline — shows the false positive
      const oldContent = "Previous session output\nError: Exit code 1\nSome other old stuff";
      const capture = mockCapture([
        oldContent + "\nProcessing task generation...",
      ]);

      const result = await pollForCompletion(
        "%1", TASKS_PATTERNS, FAST_OPTS, "/tmp", capture,
        // no baseline — old behavior
      );
      // Without baseline, the old "Error:" matches and causes a false failure
      expect(result.status).toBe("failure");
    });
  });
});
