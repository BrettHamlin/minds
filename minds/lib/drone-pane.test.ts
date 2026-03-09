import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { publishDroneSpawned } from "./drone-pane.ts";
import { MindsEventType } from "../transport/minds-events.ts";

// ---------------------------------------------------------------------------
// drone-pane.ts — DRONE_SPAWNED publish tests
// ---------------------------------------------------------------------------

describe("drone-pane: publishDroneSpawned()", () => {
  let publishedCalls: Array<{ url: string; body: { channel: string; type: string; payload: unknown } }> = [];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    publishedCalls = [];
    originalFetch = global.fetch;
    global.fetch = mock(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}");
      publishedCalls.push({ url: url as string, body });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("1. publishes DRONE_SPAWNED with correct event type", async () => {
    await publishDroneSpawned({
      busUrl: "http://localhost:7777",
      channel: "minds-BRE-456",
      waveId: "wave-1234",
      mindName: "transport",
      paneId: "%42",
      worktree: "/tmp/collab-BRE-456-transport",
      branch: "minds/BRE-456-transport",
    });

    expect(publishedCalls).toHaveLength(1);
    expect(publishedCalls[0].body.type).toBe(MindsEventType.DRONE_SPAWNED);
  });

  test("2. DRONE_SPAWNED payload includes all required fields", async () => {
    await publishDroneSpawned({
      busUrl: "http://localhost:7777",
      channel: "minds-BRE-456",
      waveId: "wave-5678",
      mindName: "signals",
      paneId: "%99",
      worktree: "/tmp/collab-BRE-456-signals",
      branch: "minds/BRE-456-signals",
    });

    const payload = publishedCalls[0].body.payload as Record<string, string>;
    expect(payload.mindName).toBe("signals");
    expect(payload.waveId).toBe("wave-5678");
    expect(payload.paneId).toBe("%99");
    expect(payload.worktree).toBe("/tmp/collab-BRE-456-signals");
    expect(payload.branch).toBe("minds/BRE-456-signals");
  });

  test("3. publishes to the correct channel", async () => {
    await publishDroneSpawned({
      busUrl: "http://localhost:7777",
      channel: "minds-BRE-456",
      waveId: "wave-1234",
      mindName: "transport",
      paneId: "%42",
      worktree: "/tmp/collab-BRE-456-transport",
      branch: "minds/BRE-456-transport",
    });

    expect(publishedCalls[0].body.channel).toBe("minds-BRE-456");
  });

  test("4. bus failure does not throw (fire-and-forget with .catch)", async () => {
    global.fetch = mock(async () => {
      throw new Error("Bus unreachable");
    }) as typeof fetch;

    let threw = false;
    try {
      await publishDroneSpawned({
        busUrl: "http://localhost:9999",
        channel: "minds-BRE-456",
        waveId: "wave-1234",
        mindName: "transport",
        paneId: "%42",
        worktree: "/tmp/worktree",
        branch: "minds/BRE-456-transport",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
