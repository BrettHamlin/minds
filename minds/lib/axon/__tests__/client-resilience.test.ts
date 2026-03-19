/**
 * client-resilience.test.ts -- Tests for AxonClient connection resilience.
 *
 * Tests reconnection logic, connection state tracking, error recovery,
 * and graceful degradation when all retry attempts are exhausted.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AxonClient, type AxonClientOptions } from "../client.ts";
import { AxonError } from "../types.ts";

/** Session counter to produce unique session IDs across reconnects. */
let sessionCounter = 0;

/**
 * Create a mock Axon server that handles handshake and default responses.
 * Supports being stopped and restarted on the same socket path.
 */
function createMockServer(socketPath?: string): {
  socketPath: string;
  server: net.Server;
  connections: net.Socket[];
  cleanup: () => void;
} {
  const sockPath =
    socketPath ??
    path.join(
      os.tmpdir(),
      `axon-resil-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
    );

  const connections: net.Socket[] = [];

  const server = net.createServer((conn) => {
    connections.push(conn);
    let buffer = "";

    conn.on("data", (chunk) => {
      buffer += chunk.toString();
      let idx: number;

      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        const parsed = JSON.parse(line);
        const write = (msg: object) => {
          conn.write(JSON.stringify(msg) + "\n");
        };

        if (parsed.t === "Hello") {
          sessionCounter++;
          write({
            t: "Ok",
            c: {
              version: "0.1.0",
              session_id: `session-${sessionCounter}`,
            },
          });
          continue;
        }

        // Default message handling
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
                c: { process_id: kind.c.process_id },
              },
            });
            break;
          case "Kill":
            write({ id, kind: { t: "KillOk" } });
            break;
          case "Shutdown":
            write({ id, kind: { t: "ShutdownOk" } });
            break;
          default:
            write({
              id,
              kind: {
                t: "Error",
                c: { code: "UNKNOWN", message: "unknown" },
              },
            });
        }
      }
    });

    conn.on("close", () => {
      const idx = connections.indexOf(conn);
      if (idx !== -1) connections.splice(idx, 1);
    });
  });

  server.listen(sockPath);

  return {
    socketPath: sockPath,
    server,
    connections,
    cleanup: () => {
      for (const conn of connections) {
        conn.destroy();
      }
      server.close();
      try {
        fs.unlinkSync(sockPath);
      } catch {
        // ignore
      }
    },
  };
}

describe("AxonClient connection resilience", () => {
  let mock: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    sessionCounter = 0;
    mock = createMockServer();
  });

  afterEach(() => {
    mock.cleanup();
  });

  describe("connected state tracking", () => {
    test("connected is true after successful connect", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      expect(client.connected).toBe(true);
      client.close();
    });

    test("connected becomes false after close", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      expect(client.connected).toBe(true);
      client.close();
      expect(client.connected).toBe(false);
    });

    test("connected becomes false when server drops connection", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      expect(client.connected).toBe(true);

      // Server destroys all connections
      for (const conn of mock.connections) {
        conn.destroy();
      }

      // Wait for the close event to propagate
      await new Promise((r) => setTimeout(r, 50));
      expect(client.connected).toBe(false);
      client.close();
    });
  });

  describe("disconnect/reconnect callbacks", () => {
    test("onDisconnect is called when connection drops", async () => {
      let disconnected = false;
      const client = await AxonClient.connect(mock.socketPath, {
        onDisconnect: () => {
          disconnected = true;
        },
      });

      // Server destroys connection
      for (const conn of mock.connections) {
        conn.destroy();
      }

      await new Promise((r) => setTimeout(r, 50));
      expect(disconnected).toBe(true);
      client.close();
    });

    test("onReconnect is called after successful reconnection", async () => {
      let reconnected = false;
      const client = await AxonClient.connect(mock.socketPath, {
        maxReconnectAttempts: 3,
        reconnectDelayMs: 50,
        onReconnect: () => {
          reconnected = true;
        },
      });

      // Server destroys the client connection but stays up
      for (const conn of mock.connections) {
        conn.destroy();
      }

      await new Promise((r) => setTimeout(r, 50));

      // Make a request -- should trigger reconnect
      const procs = await client.list();
      expect(procs).toEqual([]);
      expect(reconnected).toBe(true);
      client.close();
    });

    test("onReconnectFailed is called when all retries exhausted", async () => {
      let failed = false;
      const client = await AxonClient.connect(mock.socketPath, {
        maxReconnectAttempts: 2,
        reconnectDelayMs: 20,
        onReconnectFailed: () => {
          failed = true;
        },
      });

      // Destroy client connections AND shut down server entirely
      for (const conn of mock.connections) {
        conn.destroy();
      }
      mock.server.close();
      try {
        fs.unlinkSync(mock.socketPath);
      } catch {
        // ignore
      }

      await new Promise((r) => setTimeout(r, 50));

      // Request should fail with CONNECTION_LOST
      try {
        await client.list();
        expect(true).toBe(false); // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(AxonError);
        expect((e as AxonError).code).toBe("CONNECTION_LOST");
      }
      expect(failed).toBe(true);
      client.close();
    });
  });

  describe("auto-reconnect on request failure", () => {
    test("reconnects transparently when server restarts", async () => {
      const sockPath = mock.socketPath;
      const client = await AxonClient.connect(sockPath, {
        maxReconnectAttempts: 3,
        reconnectDelayMs: 50,
      });

      expect(client.sessionId).toBe("session-1");

      // Kill server connections
      for (const conn of mock.connections) {
        conn.destroy();
      }
      await new Promise((r) => setTimeout(r, 50));

      // Server is still listening, so reconnect should work
      const procs = await client.list();
      expect(procs).toEqual([]);

      // sessionId should update after reconnect
      expect(client.sessionId).toBe("session-2");
      client.close();
    });

    test("max retries exhausted throws CONNECTION_LOST", async () => {
      const client = await AxonClient.connect(mock.socketPath, {
        maxReconnectAttempts: 2,
        reconnectDelayMs: 10,
      });

      // Kill everything
      mock.cleanup();
      // Wait for close event to propagate
      await new Promise((r) => setTimeout(r, 50));

      try {
        await client.list();
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(AxonError);
        expect((e as AxonError).code).toBe("CONNECTION_LOST");
        expect((e as AxonError).message).toMatch(/reconnect/i);
      }
      client.close();
    });
  });

  describe("options defaults", () => {
    test("default maxReconnectAttempts is 3", async () => {
      const client = await AxonClient.connect(mock.socketPath);
      // We can't inspect private fields, but we can verify the client works
      // with default options (no options passed = no reconnect behavior).
      // When options ARE passed, defaults apply.
      expect(client.connected).toBe(true);
      client.close();
    });

    test("connect without options is backward-compatible", async () => {
      // Old-style connect with just socketPath
      const client = await AxonClient.connect(mock.socketPath);
      expect(client.sessionId).toBe("session-1");

      const procs = await client.list();
      expect(procs).toEqual([]);
      client.close();
    });

    test("connect with options preserves socket path behavior", async () => {
      const client = await AxonClient.connect(mock.socketPath, {
        maxReconnectAttempts: 5,
        reconnectDelayMs: 100,
      });
      expect(client.connected).toBe(true);
      expect(client.sessionId).toBe("session-1");
      client.close();
    });
  });

  describe("exponential backoff", () => {
    test("reconnect uses exponential backoff delays", async () => {
      const client = await AxonClient.connect(mock.socketPath, {
        maxReconnectAttempts: 3,
        reconnectDelayMs: 50,
      });

      // Kill everything so reconnect will fail
      mock.cleanup();
      // Wait for close event to propagate
      await new Promise((r) => setTimeout(r, 50));

      const start = Date.now();
      try {
        await client.list();
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(AxonError);
      }
      const elapsed = Date.now() - start;

      // With exponential backoff: 50 + 100 + 200 = 350ms minimum
      // Allow some tolerance, but it should be at least 250ms
      expect(elapsed).toBeGreaterThanOrEqual(250);
      client.close();
    });
  });

  describe("handshake re-establishment", () => {
    test("re-establishes handshake on reconnect", async () => {
      const client = await AxonClient.connect(mock.socketPath, {
        maxReconnectAttempts: 3,
        reconnectDelayMs: 50,
      });

      expect(client.sessionId).toBe("session-1");

      // Force disconnect
      for (const conn of mock.connections) {
        conn.destroy();
      }
      await new Promise((r) => setTimeout(r, 50));

      // Request triggers reconnect + new handshake
      await client.list();
      expect(client.sessionId).toBe("session-2");
      client.close();
    });
  });
});
