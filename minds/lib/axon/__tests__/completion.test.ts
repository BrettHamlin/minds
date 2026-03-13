/**
 * completion.test.ts -- Tests for event-based process completion detection.
 *
 * Uses a mock socket server to simulate Axon daemon event streaming.
 * Validates clean exit, failure exit, timeout, and cleanup behavior.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AxonClient } from "../client.ts";
import { waitForProcessCompletion } from "../completion.ts";

// ---------------------------------------------------------------------------
// Mock server helper (same pattern as client.test.ts)
// ---------------------------------------------------------------------------

function createMockServer(
  handler?: (
    line: string,
    write: (msg: object) => void,
    conn: net.Socket,
  ) => void,
): { socketPath: string; server: net.Server; cleanup: () => void } {
  const socketPath = path.join(
    os.tmpdir(),
    `axon-completion-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
  );

  const server = net.createServer((conn) => {
    let buffer = "";

    conn.on("data", (chunk) => {
      buffer += chunk.toString();
      let newlineIdx: number;

      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        const parsed = JSON.parse(line);
        const writeLine = (msg: object) => {
          conn.write(JSON.stringify(msg) + "\n");
        };

        // Handle handshake
        if (parsed.t === "Hello") {
          writeLine({
            t: "Ok",
            c: { version: "0.1.0", session_id: "test-session-completion" },
          });
          continue;
        }

        if (handler) {
          handler(line, writeLine, conn);
        }
      }
    });
  });

  server.listen(socketPath);

  return {
    socketPath,
    server,
    cleanup: () => {
      server.close();
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("waitForProcessCompletion", () => {
  let mock: ReturnType<typeof createMockServer>;

  afterEach(() => {
    mock?.cleanup();
  });

  test("resolves with exitCode 0 on clean exit", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 1 } },
        });
        // Push Exited event after a short delay
        setTimeout(() => {
          write({
            id: 0,
            kind: {
              t: "Event",
              c: {
                subscription_id: 1,
                event: {
                  t: "Exited",
                  c: { process_id: "test-proc", exit_code: 0, timestamp: 1000 },
                },
              },
            },
          });
        }, 20);
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "test-proc", 5000);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    client.close();
  });

  test("resolves with exitCode 1 on failure", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 2 } },
        });
        setTimeout(() => {
          write({
            id: 0,
            kind: {
              t: "Event",
              c: {
                subscription_id: 2,
                event: {
                  t: "Exited",
                  c: { process_id: "fail-proc", exit_code: 1, timestamp: 2000 },
                },
              },
            },
          });
        }, 20);
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "fail-proc", 5000);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeUndefined();
    client.close();
  });

  test("handles timeout", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 3 } },
        });
        // Deliberately do NOT send an Exited event
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "slow-proc", 200);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
    client.close();
  });

  test("unsubscribes after completion", async () => {
    let unsubscribeCalled = false;

    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 4 } },
        });
        setTimeout(() => {
          write({
            id: 0,
            kind: {
              t: "Event",
              c: {
                subscription_id: 4,
                event: {
                  t: "Exited",
                  c: { process_id: "cleanup-proc", exit_code: 0, timestamp: 3000 },
                },
              },
            },
          });
        }, 20);
      } else if (kind.t === "Unsubscribe") {
        unsubscribeCalled = true;
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    await waitForProcessCompletion(client, "cleanup-proc", 5000);

    expect(unsubscribeCalled).toBe(true);
    client.close();
  });

  test("ignores events for other processes", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 5 } },
        });
        // Send exit for a DIFFERENT process first
        setTimeout(() => {
          write({
            id: 0,
            kind: {
              t: "Event",
              c: {
                subscription_id: 5,
                event: {
                  t: "Exited",
                  c: { process_id: "other-proc", exit_code: 0, timestamp: 4000 },
                },
              },
            },
          });
        }, 10);
        // Then send exit for the target process
        setTimeout(() => {
          write({
            id: 0,
            kind: {
              t: "Event",
              c: {
                subscription_id: 5,
                event: {
                  t: "Exited",
                  c: { process_id: "target-proc", exit_code: 42, timestamp: 4500 },
                },
              },
            },
          });
        }, 30);
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "target-proc", 5000);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(42);
    client.close();
  });

  test("handles null exit_code as failure", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 6 } },
        });
        setTimeout(() => {
          write({
            id: 0,
            kind: {
              t: "Event",
              c: {
                subscription_id: 6,
                event: {
                  t: "Exited",
                  c: { process_id: "signal-proc", exit_code: null, timestamp: 5000 },
                },
              },
            },
          });
        }, 20);
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "signal-proc", 5000);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBeUndefined();
    client.close();
  });
});
