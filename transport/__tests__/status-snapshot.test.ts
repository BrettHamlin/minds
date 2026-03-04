// Tests for status-snapshot.ts (BRE-397)
//
// Unit tests for buildSnapshot() and formatSnapshotEvent().
// Uses temp directories with mock registry JSON files.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, rmSync } from "fs";
import { join } from "path";
import { buildSnapshot, formatSnapshotEvent } from "../status-snapshot";
import type { StatusSnapshot } from "../status-snapshot";
import { createMockRegistry, createTempRegistryDir, cleanupTempDir } from "./helpers";

// ── Test helpers ─────────────────────────────────────────────────────────────

let tempDir: string;

function writeRegistry(dir: string, filename: string, data: Record<string, unknown>): void {
  writeFileSync(join(dir, filename), JSON.stringify(data), "utf8");
}

beforeEach(() => {
  tempDir = createTempRegistryDir([]);
});

afterEach(() => {
  cleanupTempDir(tempDir);
});

// ── buildSnapshot() ──────────────────────────────────────────────────────────

describe("buildSnapshot()", () => {
  test("returns empty pipelines array for empty directory", () => {
    const snapshot = buildSnapshot(tempDir);
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.pipelines).toEqual([]);
    expect(typeof snapshot.timestamp).toBe("string");
    // Verify timestamp is valid ISO
    expect(new Date(snapshot.timestamp).toISOString()).toBe(snapshot.timestamp);
  });

  test("returns empty pipelines array for missing directory", () => {
    const snapshot = buildSnapshot(join(tempDir, "nonexistent"));
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.pipelines).toEqual([]);
  });

  test("returns correct PipelineSnapshot for single registry file", () => {
    writeRegistry(tempDir, "BRE-100.json", createMockRegistry({
      ticket_id: "BRE-100",
      current_step: "implement",
      bus_url: "http://localhost:9999",
      started_at: "2026-03-04T10:00:00Z",
      updated_at: "2026-03-04T11:00:00Z",
      phase_history: [
        { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-03-04T10:30:00Z" },
      ],
    }));

    const snapshot = buildSnapshot(tempDir);
    expect(snapshot.pipelines).toHaveLength(1);

    const p = snapshot.pipelines[0];
    expect(p.ticketId).toBe("BRE-100");
    expect(p.phase).toBe("implement");
    expect(p.status).toBe("running"); // deriveStatus: no last_signal → "running"
    expect(typeof p.detail).toBe("string");
    expect(p.busUrl).toBe("http://localhost:9999");
    expect(p.startedAt).toBe("2026-03-04T10:00:00Z");
    expect(p.updatedAt).toBe("2026-03-04T11:00:00Z");
    expect(p.phaseHistory).toHaveLength(1);
    expect(p.phaseHistory![0].phase).toBe("clarify");
    expect(p.implProgress).toBeUndefined();
  });

  test("returns multiple pipelines for multiple registry files", () => {
    writeRegistry(tempDir, "BRE-101.json", createMockRegistry({
      ticket_id: "BRE-101",
      current_step: "clarify",
    }));
    writeRegistry(tempDir, "BRE-102.json", createMockRegistry({
      ticket_id: "BRE-102",
      current_step: "implement",
      implement_phase_plan: { current_impl_phase: 2, total_phases: 5 },
    }));
    writeRegistry(tempDir, "BRE-103.json", createMockRegistry({
      ticket_id: "BRE-103",
      current_step: "done",
      last_signal: "IMPLEMENT_COMPLETE",
      last_signal_at: "2026-03-04T12:00:00Z",
    }));

    const snapshot = buildSnapshot(tempDir);
    expect(snapshot.pipelines).toHaveLength(3);

    const ids = snapshot.pipelines.map((p) => p.ticketId).sort();
    expect(ids).toEqual(["BRE-101", "BRE-102", "BRE-103"]);

    // Verify impl progress for BRE-102
    const p102 = snapshot.pipelines.find((p) => p.ticketId === "BRE-102")!;
    expect(p102.implProgress).toEqual({ current: 2, total: 5 });

    // Verify derived status for BRE-103
    const p103 = snapshot.pipelines.find((p) => p.ticketId === "BRE-103")!;
    expect(p103.status).toBe("completed"); // last_signal ends with _COMPLETE
  });

  test("skips corrupt JSON files gracefully", () => {
    writeRegistry(tempDir, "BRE-200.json", createMockRegistry({
      ticket_id: "BRE-200",
      current_step: "plan",
    }));
    // Write corrupt file
    writeFileSync(join(tempDir, "BRE-201.json"), "{ invalid json !!!", "utf8");

    const snapshot = buildSnapshot(tempDir);
    expect(snapshot.pipelines).toHaveLength(1);
    expect(snapshot.pipelines[0].ticketId).toBe("BRE-200");
  });

  test("handles registry file with missing fields using defaults", () => {
    writeRegistry(tempDir, "BRE-300.json", {});

    const snapshot = buildSnapshot(tempDir);
    expect(snapshot.pipelines).toHaveLength(1);

    const p = snapshot.pipelines[0];
    expect(p.ticketId).toBe("BRE-300"); // fallback to filename
    expect(p.phase).toBe("unknown"); // default
    expect(typeof p.status).toBe("string");
    expect(typeof p.detail).toBe("string");
  });

  test("ignores non-JSON files in registry directory", () => {
    writeRegistry(tempDir, "BRE-400.json", createMockRegistry({
      ticket_id: "BRE-400",
      current_step: "clarify",
    }));
    writeFileSync(join(tempDir, "README.md"), "# Not a registry", "utf8");
    writeFileSync(join(tempDir, ".gitkeep"), "", "utf8");

    const snapshot = buildSnapshot(tempDir);
    expect(snapshot.pipelines).toHaveLength(1);
  });

  test("derives status=held and detail includes waiting_for for held pipeline", () => {
    writeRegistry(tempDir, "BRE-450.json", createMockRegistry({
      ticket_id: "BRE-450",
      current_step: "implement",
      status: "held",
      waiting_for: "BRE-449",
      held_at: "implement",
    }));

    const snapshot = buildSnapshot(tempDir);
    expect(snapshot.pipelines).toHaveLength(1);

    const p = snapshot.pipelines[0];
    expect(p.ticketId).toBe("BRE-450");
    expect(p.phase).toBe("implement");
    expect(p.status).toBe("held");
    expect(p.detail).toContain("waiting for BRE-449");
  });

  test("handles 5 concurrent registries returning correct count and data", () => {
    for (let i = 1; i <= 5; i++) {
      writeRegistry(tempDir, `BRE-50${i}.json`, createMockRegistry({
        ticket_id: `BRE-50${i}`,
        current_step: i <= 2 ? "clarify" : i <= 4 ? "implement" : "done",
        last_signal: i === 5 ? "IMPLEMENT_COMPLETE" : undefined,
      }));
    }

    const snapshot = buildSnapshot(tempDir);
    expect(snapshot.pipelines).toHaveLength(5);

    const ids = snapshot.pipelines.map((p) => p.ticketId).sort();
    expect(ids).toEqual(["BRE-501", "BRE-502", "BRE-503", "BRE-504", "BRE-505"]);

    // Verify phase distribution
    const phases = snapshot.pipelines.reduce<Record<string, number>>((acc, p) => {
      acc[p.phase] = (acc[p.phase] || 0) + 1;
      return acc;
    }, {});
    expect(phases["clarify"]).toBe(2);
    expect(phases["implement"]).toBe(2);
    expect(phases["done"]).toBe(1);

    // Verify the done pipeline has completed status
    const donePipeline = snapshot.pipelines.find((p) => p.ticketId === "BRE-505")!;
    expect(donePipeline.status).toBe("completed");
  });
});

// ── formatSnapshotEvent() ────────────────────────────────────────────────────

describe("formatSnapshotEvent()", () => {
  test("returns Uint8Array with correct SSE format", () => {
    const snapshot: StatusSnapshot = {
      type: "snapshot",
      pipelines: [],
      timestamp: "2026-03-04T15:00:00Z",
    };

    const result = formatSnapshotEvent(snapshot, 42);
    expect(result).toBeInstanceOf(Uint8Array);

    const text = new TextDecoder().decode(result);
    expect(text).toContain("event: snapshot\n");
    expect(text).toContain("id: 42\n");
    expect(text).toContain("data: ");
    expect(text).toEndWith("\n\n");

    // Parse the data line
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice(6));
    expect(parsed.type).toBe("snapshot");
    expect(parsed.pipelines).toEqual([]);
    expect(parsed.timestamp).toBe("2026-03-04T15:00:00Z");
  });

  test("includes pipeline data in SSE event", () => {
    const snapshot: StatusSnapshot = {
      type: "snapshot",
      pipelines: [
        {
          ticketId: "BRE-500",
          phase: "implement",
          status: "running",
          detail: "Working on implement phase",
        },
      ],
      timestamp: "2026-03-04T16:00:00Z",
    };

    const result = formatSnapshotEvent(snapshot, 1);
    const text = new TextDecoder().decode(result);
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice(6));

    expect(parsed.pipelines).toHaveLength(1);
    expect(parsed.pipelines[0].ticketId).toBe("BRE-500");
    expect(parsed.pipelines[0].phase).toBe("implement");
  });
});
