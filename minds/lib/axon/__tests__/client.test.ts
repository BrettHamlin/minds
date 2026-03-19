/**
 * client.test.ts -- Tests for the AxonClient.
 *
 * Uses a mock socket server to test handshake, request-response correlation,
 * error handling, event reading, and subscription streaming.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AxonClient } from "../client.ts";
import { AxonError } from "../types.ts";

/**
 * Create a mock Axon server that handles handshake and echoes responses.
 * Returns the socket path and a cleanup function.
 */
function createMockServer(
  handler?: (line: string, write: (msg: object) => void) => void,
): { socketPath: string; server: net.Server; cleanup: () => void } {
  const socketPath = path.join(
    os.tmpdir(),
    `axon-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
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
            c: { version: "0.1.0", session_id: "test-session-1" },
          });
          continue;
        }

        // Handle messages with the custom handler or default echo
        if (handler) {
          handler(line, writeLine);
        } else {
          // Default: respond based on message kind
          handleDefault(parsed, writeLine);
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

function handleDefault(
  parsed: { id: number; kind: { t: string; c?: unknown } },
  write: (msg: object) => void,
): void {
  const { id, kind } = parsed;
  switch (kind.t) {
    case "List":
      write({ id, kind: { t: "ListOk", c: { processes: [] } } });
      break;
    case "Spawn":
      write({
        id,
        kind: {
          t: "SpawnOk",
          c: { process_id: (kind.c as { process_id: string }).process_id },
        },
      });
      break;
    case "Kill":
      write({ id, kind: { t: "KillOk" } });
      break;
    case "GetProcess":
      write({
        id,
        kind: {
          t: "GetProcessOk",
          c: {
            process: {
              id: (kind.c as { process_id: string }).process_id,
              command: "echo",
              args: [],
              state: "Running",
              pid: 1234,
              started_at: 1000,
            },
          },
        },
      });
      break;
    case "Subscribe":
      write({ id, kind: { t: "SubscribeOk", c: { subscription_id: 1 } } });
      break;
    case "Unsubscribe":
      write({ id, kind: { t: "UnsubscribeOk" } });
      break;
    case "Shutdown":
      write({ id, kind: { t: "ShutdownOk" } });
      break;
    default:
      write({
        id,
        kind: { t: "Error", c: { code: "UNKNOWN", message: "unknown command" } },
      });
  }
}

describe("AxonClient", () => {
  let mock: { socketPath: string; server: net.Server; cleanup: () => void };

  beforeEach(() => {
    mock = createMockServer();
  });

  afterEach(() => {
    mock.cleanup();
  });

  describe("connect", () => {
    test("connects and performs handshake", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      expect(client).toBeDefined();
      expect(client.sessionId).toBe("test-session-1");
      client.close();
    });

    test("fails on non-existent socket", async () => {
      await expect(
        AxonClient.connect("/tmp/nonexistent-axon-test.sock"),
      ).rejects.toThrow();
    });

    test("fails on handshake error", async () => {
      mock.cleanup();
      const errorMock = createMockServer();
      // Override - close and create a server that rejects handshake
      errorMock.cleanup();

      const rejectSocketPath = path.join(
        os.tmpdir(),
        `axon-reject-${Date.now()}.sock`,
      );
      const rejectServer = net.createServer((conn) => {
        conn.on("data", () => {
          conn.write(
            JSON.stringify({
              t: "Error",
              c: { code: "VERSION_MISMATCH", message: "bad version" },
            }) + "\n",
          );
        });
      });
      rejectServer.listen(rejectSocketPath);

      try {
        await expect(AxonClient.connect(rejectSocketPath)).rejects.toThrow(
          /handshake/i,
        );
      } finally {
        rejectServer.close();
        try {
          fs.unlinkSync(rejectSocketPath);
        } catch {
          // ignore
        }
      }
    });
  });

  describe("list", () => {
    test("returns process list", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      const processes = await client.list();
      expect(processes).toEqual([]);
      client.close();
    });
  });

  describe("spawn", () => {
    test("returns process ID", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      const id = await client.spawn("my-proc", "/bin/echo", ["hello"]);
      expect(id).toBe("my-proc");
      client.close();
    });
  });

  describe("kill", () => {
    test("resolves on success", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      await expect(client.kill("my-proc")).resolves.toBeUndefined();
      client.close();
    });
  });

  describe("info", () => {
    test("returns process info", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      const info = await client.info("my-proc");
      expect(info.id).toBe("my-proc");
      expect(info.command).toBe("echo");
      expect(info.state).toBe("Running");
      client.close();
    });
  });

  describe("subscribe", () => {
    test("returns subscription with ID", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      const sub = await client.subscribe();
      expect(sub.id).toBe(1);
      client.close();
    });
  });

  describe("unsubscribe", () => {
    test("resolves on success", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      await expect(client.unsubscribe(1)).resolves.toBeUndefined();
      client.close();
    });
  });

  describe("shutdown", () => {
    test("resolves on success", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      await expect(client.shutdown()).resolves.toBeUndefined();
      client.close();
    });
  });

  describe("error handling", () => {
    test("server Error response becomes AxonError", async () => {
      mock.cleanup();
      mock = createMockServer((line, write) => {
        const parsed = JSON.parse(line);
        write({
          id: parsed.id,
          kind: {
            t: "Error",
            c: { code: "PROCESS_NOT_FOUND", message: "not found: foo" },
          },
        });
      });

      const client = await AxonClient.connect(mock.socketPath);
      try {
        await client.list();
        expect(true).toBe(false); // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(AxonError);
        expect((e as AxonError).code).toBe("PROCESS_NOT_FOUND");
      }
      client.close();
    });
  });

  describe("message ID correlation", () => {
    test("increments message IDs", async () => {
      const receivedIds: number[] = [];

      mock.cleanup();
      mock = createMockServer((line, write) => {
        const parsed = JSON.parse(line);
        receivedIds.push(parsed.id);
        write({ id: parsed.id, kind: { t: "ListOk", c: { processes: [] } } });
      });

      const client = await AxonClient.connect(mock.socketPath);
      await client.list();
      await client.list();
      await client.list();
      client.close();

      // IDs should be monotonically increasing
      expect(receivedIds[1]!).toBeGreaterThan(receivedIds[0]!);
      expect(receivedIds[2]!).toBeGreaterThan(receivedIds[1]!);
    });
  });

  describe("readEvent", () => {
    test("reads a pushed event from the server", async () => {
      mock.cleanup();
      mock = createMockServer((line, write) => {
        const parsed = JSON.parse(line);
        // First respond to Subscribe, then push an event
        if (parsed.kind.t === "Subscribe") {
          write({ id: parsed.id, kind: { t: "SubscribeOk", c: { subscription_id: 42 } } });
          // Push an event after subscribing
          setTimeout(() => {
            write({
              id: 0,
              kind: {
                t: "Event",
                c: {
                  subscription_id: 42,
                  event: {
                    t: "Spawned",
                    c: { process_id: "proc-1", command: "echo", timestamp: 1000 },
                  },
                },
              },
            });
          }, 10);
        } else {
          handleDefault(parsed, write);
        }
      });

      const client = await AxonClient.connect(mock.socketPath);
      await client.subscribe();
      const event = await client.readEvent();
      expect(event.subscription_id).toBe(42);
      expect(event.event.t).toBe("Spawned");
      if (event.event.t === "Spawned") {
        expect(event.event.c.process_id).toBe("proc-1");
      }
      client.close();
    });

    test("event interleaved between request and response is correctly separated", async () => {
      mock.cleanup();
      let requestCount = 0;
      mock = createMockServer((line, write) => {
        const parsed = JSON.parse(line);
        requestCount++;

        if (parsed.kind.t === "List") {
          // Push an event BEFORE sending the response
          write({
            id: 0,
            kind: {
              t: "Event",
              c: {
                subscription_id: 7,
                event: {
                  t: "Exited",
                  c: { process_id: "bg-proc", exit_code: 0, timestamp: 2000 },
                },
              },
            },
          });
          // Then send the actual List response
          write({ id: parsed.id, kind: { t: "ListOk", c: { processes: [] } } });
        } else {
          handleDefault(parsed, write);
        }
      });

      const client = await AxonClient.connect(mock.socketPath);

      // list() should succeed despite the interleaved event
      const processes = await client.list();
      expect(processes).toEqual([]);

      // The interleaved event should be available via readEvent
      const event = await client.readEvent();
      expect(event.subscription_id).toBe(7);
      expect(event.event.t).toBe("Exited");
      if (event.event.t === "Exited") {
        expect(event.event.c.process_id).toBe("bg-proc");
        expect(event.event.c.exit_code).toBe(0);
      }

      client.close();
    });
  });
});
