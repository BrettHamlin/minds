// Shared test fixtures for transport tests (BRE-400)
//
// Provides reusable helpers for creating mock registries, temp directories
// with registry JSON files, and collecting SSE events from endpoints.

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { BusMessage } from "../bus-server";

// ── Mock registry ────────────────────────────────────────────────────────────

export interface MockRegistryOverrides {
  ticket_id?: string;
  current_step?: string;
  status?: string;
  bus_url?: string;
  started_at?: string;
  updated_at?: string;
  last_signal?: string;
  last_signal_at?: string;
  held_at?: string | null;
  waiting_for?: string | null;
  phase_history?: Array<{ phase: string; signal: string; ts: string }>;
  implement_phase_plan?: { current_impl_phase: number; total_phases: number };
  [key: string]: unknown;
}

/**
 * Returns a mock pipeline registry object with sensible defaults.
 * All fields can be overridden.
 */
export function createMockRegistry(overrides?: MockRegistryOverrides): Record<string, unknown> {
  return {
    ticket_id: "BRE-TEST",
    current_step: "implement",
    bus_url: "http://localhost:9999",
    started_at: "2026-03-04T10:00:00Z",
    updated_at: "2026-03-04T11:00:00Z",
    ...overrides,
  };
}

// ── Temp registry directory ──────────────────────────────────────────────────

/**
 * Creates a temp directory populated with registry JSON files.
 * Returns the directory path. Caller is responsible for cleanup via rmSync.
 */
export function createTempRegistryDir(
  registries: Array<{ filename: string; data: Record<string, unknown> }>,
): string {
  const dir = join(
    tmpdir(),
    `test-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });

  for (const { filename, data } of registries) {
    const name = filename.endsWith(".json") ? filename : `${filename}.json`;
    writeFileSync(join(dir, name), JSON.stringify(data), "utf8");
  }

  return dir;
}

/**
 * Remove a temp directory created by createTempRegistryDir.
 */
export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ── SSE event collector ──────────────────────────────────────────────────────

export interface SseFrame {
  event?: string;
  id?: string;
  data?: string;
}

/**
 * Connects to an SSE endpoint and collects `count` events, then disconnects.
 * Returns parsed SSE frames. Rejects on timeout (default 3000ms).
 */
export async function collectSSEEvents(
  url: string,
  count: number,
  timeout = 3000,
): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  const ac = new AbortController();

  const done = (async () => {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const rawFrames = buf.split("\n\n");
      buf = rawFrames.pop() ?? "";
      for (const raw of rawFrames) {
        const frame: SseFrame = {};
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) frame.event = line.slice(7);
          else if (line.startsWith("id: ")) frame.id = line.slice(4);
          else if (line.startsWith("data: ")) frame.data = line.slice(6);
        }
        frames.push(frame);
        if (frames.length >= count) {
          ac.abort();
          return frames;
        }
      }
    }
    return frames;
  })().catch(() => frames);

  await Promise.race([done, Bun.sleep(timeout).then(() => ac.abort())]);
  return frames;
}
