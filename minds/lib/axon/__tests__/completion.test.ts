/**
 * completion.test.ts -- Tests for event-based process completion detection.
 *
 * Uses a mock socket server to simulate Axon daemon event streaming.
 * Validates clean exit, failure exit, timeout, race conditions, and cleanup behavior.
 */

import { describe, test, expect, afterEach } from "bun:test";
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
  let client: AxonClient | undefined;

  afterEach(async () => {
    try {
      client?.close();
    } catch {
      // Best-effort client cleanup
    }
    client = undefined;
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
      } else if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "test-proc",
                command: "echo",
                args: ["hello"],
                state: "Running",
                pid: 1234,
                started_at: 1000,
              },
            },
          },
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

    client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "test-proc", 5000);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
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
      } else if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "fail-proc",
                command: "false",
                args: [],
                state: "Running",
                pid: 1235,
                started_at: 2000,
              },
            },
          },
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

    client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "fail-proc", 5000);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeUndefined();
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
      } else if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "slow-proc",
                command: "sleep",
                args: ["999"],
                state: "Running",
                pid: 1236,
                started_at: 3000,
              },
            },
          },
        });
        // Deliberately do NOT send an Exited event
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "slow-proc", 200);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
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
      } else if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "cleanup-proc",
                command: "echo",
                args: [],
                state: "Running",
                pid: 1237,
                started_at: 4000,
              },
            },
          },
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

    client = await AxonClient.connect(mock.socketPath);
    await waitForProcessCompletion(client, "cleanup-proc", 5000);

    expect(unsubscribeCalled).toBe(true);
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
      } else if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "target-proc",
                command: "echo",
                args: [],
                state: "Running",
                pid: 1238,
                started_at: 5000,
              },
            },
          },
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

    client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "target-proc", 5000);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(42);
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
      } else if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "signal-proc",
                command: "kill",
                args: [],
                state: "Running",
                pid: 1239,
                started_at: 6000,
              },
            },
          },
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

    client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "signal-proc", 5000);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBeUndefined();
  });

  test("returns immediately when process already exited before subscribe", async () => {
    let unsubscribeCalled = false;

    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 7 } },
        });
      } else if (kind.t === "GetProcess") {
        // Process already exited
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "done-proc",
                command: "echo",
                args: ["done"],
                state: { Exited: { exit_code: 0 } },
                pid: null,
                started_at: 7000,
              },
            },
          },
        });
      } else if (kind.t === "Unsubscribe") {
        unsubscribeCalled = true;
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "done-proc", 5000);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(unsubscribeCalled).toBe(true);
  });

  test("returns process_not_found when info call fails", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 8 } },
        });
      } else if (kind.t === "GetProcess") {
        // Process not found -- return error
        write({
          id,
          kind: {
            t: "Error",
            c: { code: "not_found", message: "Process not found" },
          },
        });
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    client = await AxonClient.connect(mock.socketPath);
    const result = await waitForProcessCompletion(client, "ghost-proc", 5000);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("process_not_found");
  });
});
