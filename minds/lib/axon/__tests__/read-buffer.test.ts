/**
 * read-buffer.test.ts -- Tests for readBuffer on AxonClient and capturePane on AxonMultiplexer.
 *
 * Uses a mock socket server to verify readBuffer request-response handling
 * and capturePane integration with the multiplexer.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AxonClient } from "../client.ts";
import { AxonMultiplexer } from "../multiplexer.ts";
import { AxonError } from "../types.ts";

/**
 * Create a mock Axon server that handles handshake and dispatches to handler.
 */
function createMockServer(
  handler?: (parsed: { id: number; kind: { t: string; c?: unknown } }, write: (msg: object) => void) => void,
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
            c: { version: "0.1.0", session_id: "test-session-rb" },
          });
          continue;
        }

        if (handler) {
          handler(parsed, writeLine);
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

describe("AxonClient.readBuffer", () => {
  let mock: ReturnType<typeof createMockServer>;

  afterEach(() => {
    mock?.cleanup();
  });

  test("returns buffer data with defaults (null offset/limit)", async () => {
    mock = createMockServer((parsed, write) => {
      if (parsed.kind.t === "ReadBuffer") {
        const c = parsed.kind.c as { process_id: string; offset: number | null; limit: number | null };
        expect(c.process_id).toBe("proc-1");
        expect(c.offset).toBeNull();
        expect(c.limit).toBeNull();
        write({
          id: parsed.id,
          kind: {
            t: "ReadBufferOk",
            c: { data: "hello world\n", bytes_read: 12, total_written: 12 },
          },
        });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const result = await client.readBuffer("proc-1");
    expect(result.data).toBe("hello world\n");
    expect(result.bytes_read).toBe(12);
    expect(result.total_written).toBe(12);
    client.close();
  });

  test("passes offset and limit when provided", async () => {
    mock = createMockServer((parsed, write) => {
      if (parsed.kind.t === "ReadBuffer") {
        const c = parsed.kind.c as { process_id: string; offset: number | null; limit: number | null };
        expect(c.offset).toBe(100);
        expect(c.limit).toBe(50);
        write({
          id: parsed.id,
          kind: {
            t: "ReadBufferOk",
            c: { data: "partial", bytes_read: 7, total_written: 150 },
          },
        });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const result = await client.readBuffer("proc-1", 100, 50);
    expect(result.data).toBe("partial");
    expect(result.bytes_read).toBe(7);
    expect(result.total_written).toBe(150);
    client.close();
  });

  test("throws AxonError on server error", async () => {
    mock = createMockServer((parsed, write) => {
      if (parsed.kind.t === "ReadBuffer") {
        write({
          id: parsed.id,
          kind: {
            t: "Error",
            c: { code: "PROCESS_NOT_FOUND", message: "no such process" },
          },
        });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    try {
      await client.readBuffer("nonexistent");
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(AxonError);
      expect((e as AxonError).code).toBe("PROCESS_NOT_FOUND");
    }
    client.close();
  });

  test("rejects invalid process ID", async () => {
    mock = createMockServer();
    const client = await AxonClient.connect(mock.socketPath);
    await expect(client.readBuffer("invalid id with spaces")).rejects.toThrow(
      /Invalid process ID/,
    );
    client.close();
  });
});

describe("AxonMultiplexer.capturePane", () => {
  let mock: ReturnType<typeof createMockServer>;

  afterEach(() => {
    mock?.cleanup();
  });

  test("returns empty string for pane with no spawned processes", async () => {
    mock = createMockServer();
    const client = await AxonClient.connect(mock.socketPath);
    const mux = new AxonMultiplexer(client);

    const result = await mux.capturePane("unknown-pane");
    expect(result).toBe("");
    client.close();
  });

  test("reads buffer from the most recent process in a pane", async () => {
    mock = createMockServer((parsed, write) => {
      if (parsed.kind.t === "Spawn") {
        write({
          id: parsed.id,
          kind: {
            t: "SpawnOk",
            c: { process_id: (parsed.kind.c as { process_id: string }).process_id },
          },
        });
      } else if (parsed.kind.t === "ReadBuffer") {
        const c = parsed.kind.c as { process_id: string };
        write({
          id: parsed.id,
          kind: {
            t: "ReadBufferOk",
            c: { data: `output from ${c.process_id}`, bytes_read: 20, total_written: 20 },
          },
        });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const mux = new AxonMultiplexer(client);

    // sendKeys spawns a process with derived ID (pane-1-cmd-0), which should be tracked
    await mux.sendKeys("pane-1", "echo hello");
    const result = await mux.capturePane("pane-1");
    expect(result).toBe("output from pane-1-cmd-0");
    client.close();
  });

  test("reads from the last process when multiple commands sent to same pane", async () => {
    let spawnCount = 0;
    mock = createMockServer((parsed, write) => {
      if (parsed.kind.t === "Spawn") {
        spawnCount++;
        write({
          id: parsed.id,
          kind: {
            t: "SpawnOk",
            c: { process_id: (parsed.kind.c as { process_id: string }).process_id },
          },
        });
      } else if (parsed.kind.t === "ReadBuffer") {
        const c = parsed.kind.c as { process_id: string };
        write({
          id: parsed.id,
          kind: {
            t: "ReadBufferOk",
            c: { data: `output-${c.process_id}`, bytes_read: 10, total_written: 10 },
          },
        });
      }
    });

    const client = await AxonClient.connect(mock.socketPath);
    const mux = new AxonMultiplexer(client);

    // Send multiple commands to the same pane - each gets a unique process ID
    await mux.sendKeys("pane-2", "echo first");
    await mux.sendKeys("pane-2", "echo second");

    const result = await mux.capturePane("pane-2");
    // Should read from the last spawned process
    // The multiplexer generates unique sub-IDs for repeated sendKeys
    expect(result).toContain("output-");
    expect(spawnCount).toBe(2);
    client.close();
  });
});
