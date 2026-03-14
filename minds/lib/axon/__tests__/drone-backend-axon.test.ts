/**
 * drone-backend-axon.test.ts -- Tests for AxonDroneBackend implementation.
 *
 * Uses a mock socket server (same pattern as completion.test.ts) to simulate
 * the Axon daemon. Validates spawn, kill, isAlive, captureOutput, and
 * waitForCompletion through the DroneBackend interface.
 */

import { describe, test, expect, afterEach } from "bun:test";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AxonDroneBackend } from "../drone-backend-axon.ts";
import type { DroneHandle } from "../../drone-backend.ts";

// ---------------------------------------------------------------------------
// Mock server helper (same pattern as completion.test.ts)
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
    `axon-drone-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
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
            c: { version: "0.1.0", session_id: "test-session-drone" },
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

describe("AxonDroneBackend", () => {
  let mock: ReturnType<typeof createMockServer>;
  let backend: AxonDroneBackend | undefined;

  afterEach(() => {
    try {
      backend?.close();
    } catch {
      // Best-effort cleanup
    }
    backend = undefined;
    mock?.cleanup();
  });

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  test("connect() creates a connected backend", async () => {
    mock = createMockServer();
    backend = await AxonDroneBackend.connect(mock.socketPath);
    expect(backend).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // spawn
  // -------------------------------------------------------------------------

  test("spawn() sends Spawn command and returns handle", async () => {
    let spawnReceived = false;
    let spawnedCwd: string | null = null;

    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Spawn") {
        spawnReceived = true;
        spawnedCwd = kind.c.cwd;
        write({
          id,
          kind: { t: "SpawnOk", c: { process_id: kind.c.process_id } },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle = await backend.spawn({
      processId: "drone-1",
      command: "claude",
      args: ["--print", "hello"],
      cwd: "/tmp/worktree-1",
      env: { BUS_URL: "http://localhost:3000" },
    });

    expect(handle.id).toBe("drone-1");
    expect(handle.backend).toBe("axon");
    expect(spawnReceived).toBe(true);
    expect(spawnedCwd).toBe("/tmp/worktree-1");
  });

  test("spawn() passes env variables to Axon", async () => {
    let spawnedEnv: Record<string, string> | null = null;

    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Spawn") {
        spawnedEnv = kind.c.env;
        write({
          id,
          kind: { t: "SpawnOk", c: { process_id: kind.c.process_id } },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    await backend.spawn({
      processId: "drone-env",
      command: "claude",
      args: [],
      cwd: "/tmp/worktree",
      env: { BUS_URL: "http://bus", TASK_ID: "42" },
    });

    expect(spawnedEnv).toEqual({ BUS_URL: "http://bus", TASK_ID: "42" });
  });

  test("spawn() sends null env when not provided", async () => {
    let spawnedEnv: unknown = "not-set";

    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Spawn") {
        spawnedEnv = kind.c.env;
        write({
          id,
          kind: { t: "SpawnOk", c: { process_id: kind.c.process_id } },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    await backend.spawn({
      processId: "drone-noenv",
      command: "claude",
      args: [],
      cwd: "/tmp/worktree",
    });

    expect(spawnedEnv).toBeNull();
  });

  // -------------------------------------------------------------------------
  // kill
  // -------------------------------------------------------------------------

  test("kill() sends Kill command", async () => {
    let killReceived = false;
    let killedId: string | null = null;

    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Kill") {
        killReceived = true;
        killedId = kind.c.process_id;
        write({ id, kind: { t: "KillOk" } });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-kill", backend: "axon" };
    await backend.kill(handle);

    expect(killReceived).toBe(true);
    expect(killedId).toBe("drone-kill");
  });

  test("kill() is idempotent -- ignores errors for dead processes", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Kill") {
        write({
          id,
          kind: {
            t: "Error",
            c: { code: "not_found", message: "Process not found" },
          },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-dead", backend: "axon" };

    // Should not throw
    await backend.kill(handle);
  });

  // -------------------------------------------------------------------------
  // isAlive
  // -------------------------------------------------------------------------

  test("isAlive() returns true for Running process", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "drone-alive",
                command: "claude",
                args: [],
                state: "Running",
                pid: 1234,
                started_at: 1000,
              },
            },
          },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-alive", backend: "axon" };
    const alive = await backend.isAlive(handle);

    expect(alive).toBe(true);
  });

  test("isAlive() returns true for Starting process", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "drone-starting",
                command: "claude",
                args: [],
                state: "Starting",
                pid: null,
                started_at: 1000,
              },
            },
          },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-starting", backend: "axon" };
    const alive = await backend.isAlive(handle);

    expect(alive).toBe(true);
  });

  test("isAlive() returns false for Exited process", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "drone-exited",
                command: "claude",
                args: [],
                state: { Exited: { exit_code: 0 } },
                pid: null,
                started_at: 1000,
              },
            },
          },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-exited", backend: "axon" };
    const alive = await backend.isAlive(handle);

    expect(alive).toBe(false);
  });

  test("isAlive() returns false for Stopping process", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "drone-stopping",
                command: "claude",
                args: [],
                state: "Stopping",
                pid: 1234,
                started_at: 1000,
              },
            },
          },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-stopping", backend: "axon" };
    const alive = await backend.isAlive(handle);

    expect(alive).toBe(false);
  });

  test("isAlive() returns false when process not found", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "GetProcess") {
        write({
          id,
          kind: {
            t: "Error",
            c: { code: "not_found", message: "Process not found" },
          },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-ghost", backend: "axon" };
    const alive = await backend.isAlive(handle);

    expect(alive).toBe(false);
  });

  // -------------------------------------------------------------------------
  // captureOutput
  // -------------------------------------------------------------------------

  test("captureOutput() returns buffer data", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "ReadBuffer") {
        write({
          id,
          kind: {
            t: "ReadBufferOk",
            c: {
              data: "Hello from drone\nTask complete\n",
              bytes_read: 30,
              total_written: 30,
            },
          },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-output", backend: "axon" };
    const output = await backend.captureOutput(handle);

    expect(output).toBe("Hello from drone\nTask complete\n");
  });

  test("captureOutput() returns empty string on error", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "ReadBuffer") {
        write({
          id,
          kind: {
            t: "Error",
            c: { code: "not_found", message: "Process not found" },
          },
        });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-nooutput", backend: "axon" };
    const output = await backend.captureOutput(handle);

    expect(output).toBe("");
  });

  // -------------------------------------------------------------------------
  // waitForCompletion
  // -------------------------------------------------------------------------

  test("waitForCompletion() returns ok:true on clean exit", async () => {
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
                id: "drone-wait",
                command: "claude",
                args: [],
                state: "Running",
                pid: 1234,
                started_at: 1000,
              },
            },
          },
        });
        // Push Exited event after short delay
        setTimeout(() => {
          write({
            id: 0,
            kind: {
              t: "Event",
              c: {
                subscription_id: 1,
                event: {
                  t: "Exited",
                  c: { process_id: "drone-wait", exit_code: 0, timestamp: 2000 },
                },
              },
            },
          });
        }, 20);
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-wait", backend: "axon" };
    const result = await backend.waitForCompletion(handle, "/tmp/worktree", 5000);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("waitForCompletion() returns ok:false on nonzero exit", async () => {
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
                id: "drone-fail",
                command: "claude",
                args: [],
                state: "Running",
                pid: 1235,
                started_at: 1000,
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
                  c: { process_id: "drone-fail", exit_code: 1, timestamp: 2000 },
                },
              },
            },
          });
        }, 20);
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-fail", backend: "axon" };
    const result = await backend.waitForCompletion(handle, "/tmp/worktree", 5000);

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("waitForCompletion() returns error on timeout", async () => {
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
                id: "drone-slow",
                command: "claude",
                args: [],
                state: "Running",
                pid: 1236,
                started_at: 1000,
              },
            },
          },
        });
        // No Exited event -- will timeout
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-slow", backend: "axon" };
    const result = await backend.waitForCompletion(handle, "/tmp/worktree", 200);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("waitForCompletion() handles already-exited process", async () => {
    mock = createMockServer((line, write) => {
      const parsed = JSON.parse(line);
      const { id, kind } = parsed;

      if (kind.t === "Subscribe") {
        write({
          id,
          kind: { t: "SubscribeOk", c: { subscription_id: 4 } },
        });
      } else if (kind.t === "GetProcess") {
        // Already exited
        write({
          id,
          kind: {
            t: "GetProcessOk",
            c: {
              process: {
                id: "drone-done",
                command: "claude",
                args: [],
                state: { Exited: { exit_code: 0 } },
                pid: null,
                started_at: 1000,
              },
            },
          },
        });
      } else if (kind.t === "Unsubscribe") {
        write({ id, kind: { t: "UnsubscribeOk" } });
      }
    });

    backend = await AxonDroneBackend.connect(mock.socketPath);
    const handle: DroneHandle = { id: "drone-done", backend: "axon" };
    const result = await backend.waitForCompletion(handle, "/tmp/worktree", 5000);

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  test("close() disconnects the underlying client", async () => {
    mock = createMockServer();
    backend = await AxonDroneBackend.connect(mock.socketPath);
    backend.close();

    // After closing, operations should fail
    const handle: DroneHandle = { id: "drone-closed", backend: "axon" };
    const alive = await backend.isAlive(handle);
    expect(alive).toBe(false);

    // Prevent afterEach from double-closing
    backend = undefined;
  });
});
