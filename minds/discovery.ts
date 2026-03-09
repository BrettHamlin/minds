/**
 * discovery.ts — Convention-based Mind discovery and child process lifecycle.
 *
 * A parent Mind calls discoverChildren(parentDir) at startup.
 * It scans "minds/{name}/server.ts" relative to parentDir, starts each as a Bun
 * subprocess, waits for MIND_READY port=XXXX on stdout, connects, and
 * registers each child with the routing engine.
 *
 * Process lifecycle:
 * - Children are owned by the parent that started them.
 * - Parent monitors health via periodic describe() calls (optional).
 * - On parent shutdown, all children are terminated (SIGTERM → SIGKILL after 5s).
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { MindDescription } from "./mind.js";
import { MindRouter } from "./router.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChildProcess {
  /** The child Mind's MCP HTTP server port */
  port: number;
  /** The child Mind's description (from describe()) */
  description: MindDescription;
  /** Call handle() on the child via HTTP (MCP protocol) */
  handle(request: string, context?: unknown): Promise<unknown>;
  /** Terminate the child process */
  kill(): void;
}

export interface DiscoveryResult {
  children: ChildProcess[];
  router: MindRouter;
  /** Shut down all child processes */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time (ms) to wait for a child to emit MIND_READY */
const STARTUP_TIMEOUT_MS = 10_000;
/** Directory name pattern for child Minds */
const SERVER_FILE = "server.ts";

// ---------------------------------------------------------------------------
// Core: scan for child server files
// ---------------------------------------------------------------------------

/**
 * Finds all "{name}/server.ts" files within mindsDir.
 * If mindsDir is not provided, defaults to "minds/" relative to parentDir.
 * Returns absolute paths to each server.ts.
 */
export function findChildServerFiles(parentDir: string, mindsDir?: string): string[] {
  const resolvedMindsDir = mindsDir ?? join(parentDir, "minds");
  if (!existsSync(resolvedMindsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(resolvedMindsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  return entries
    .map((name) => join(resolvedMindsDir, name, SERVER_FILE))
    .filter((p) => existsSync(p));
}

// ---------------------------------------------------------------------------
// Core: spawn a single child and wait for MIND_READY
// ---------------------------------------------------------------------------

export interface SpawnedChild {
  proc: ReturnType<typeof Bun.spawn>;
  port: number;
}

/**
 * Spawns a Mind server script as a Bun subprocess.
 * Waits for `MIND_READY port=XXXX` on stdout.
 * Rejects after STARTUP_TIMEOUT_MS if not ready.
 */
export function spawnChild(serverPath: string): Promise<SpawnedChild> {
  return new Promise((resolve, reject) => {
    const proc = Bun.spawn(["bun", serverPath], {
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env },
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Child at ${serverPath} did not emit MIND_READY within ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);

    // Read stdout line by line looking for MIND_READY
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Check each complete line
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const match = line.match(/^MIND_READY port=(\d+)/);
            if (match) {
              clearTimeout(timeout);
              resolve({ proc, port: parseInt(match[1], 10) });
              return;
            }
          }
        }
        // EOF without MIND_READY
        clearTimeout(timeout);
        reject(new Error(`Child at ${serverPath} exited without emitting MIND_READY`));
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// Core: call describe() on a child via MCP HTTP
// ---------------------------------------------------------------------------

/**
 * Calls the describe tool on a child Mind's MCP server.
 * Returns the parsed MindDescription.
 */
export async function callDescribe(port: number): Promise<MindDescription> {
  const url = `http://localhost:${port}`;

  // Step 1: initialize
  const initRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "discovery", version: "1.0.0" },
      },
    }),
  });

  if (!initRes.ok) {
    throw new Error(`MCP initialize failed: ${initRes.status}`);
  }

  // Step 2: call describe tool
  const callRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "describe", arguments: {} },
    }),
  });

  if (!callRes.ok) {
    throw new Error(`MCP tools/call describe failed: ${callRes.status}`);
  }

  const body = (await callRes.json()) as {
    result?: { content?: Array<{ type: string; text: string }> };
    error?: { message: string };
  };

  if (body.error) {
    throw new Error(`describe tool error: ${body.error.message}`);
  }

  const text = body.result?.content?.[0]?.text;
  if (!text) throw new Error("describe returned no content");

  return JSON.parse(text) as MindDescription;
}

// ---------------------------------------------------------------------------
// Core: call handle() on a child via MCP HTTP
// ---------------------------------------------------------------------------

/**
 * Sends a WorkUnit to a child Mind's handle tool via MCP HTTP.
 */
export async function callHandle(
  port: number,
  request: string,
  context?: unknown
): Promise<unknown> {
  const url = `http://localhost:${port}`;

  // Initialize
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "discovery", version: "1.0.0" },
      },
    }),
  });

  // Call handle
  const callRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "handle",
        arguments: { request, context },
      },
    }),
  });

  const body = (await callRes.json()) as {
    result?: { content?: Array<{ type: string; text: string }> };
    error?: { message: string };
  };

  if (body.error) throw new Error(`handle tool error: ${body.error.message}`);

  const text = body.result?.content?.[0]?.text;
  if (!text) throw new Error("handle returned no content");

  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Top-level discovery
// ---------------------------------------------------------------------------

/**
 * Discovers and starts all child Minds found under parentDir/minds/.
 * Waits for each child to be ready, calls describe(), and registers with router.
 * Returns a DiscoveryResult with children array, router, and shutdown function.
 */
export async function discoverChildren(parentDir: string): Promise<DiscoveryResult> {
  const serverFiles = findChildServerFiles(parentDir);
  const router = new MindRouter();

  const children: ChildProcess[] = [];
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];

  for (const serverPath of serverFiles) {
    let spawned: SpawnedChild;
    try {
      spawned = await spawnChild(serverPath);
    } catch (err) {
      console.error(`Failed to start child at ${serverPath}:`, err);
      continue;
    }

    procs.push(spawned.proc);
    const { port } = spawned;

    let description: MindDescription;
    try {
      description = await callDescribe(port);
    } catch (err) {
      console.error(`Failed to describe child at port ${port}:`, err);
      spawned.proc.kill();
      continue;
    }

    await router.addChild(description);

    children.push({
      port,
      description,
      async handle(request, context) {
        return callHandle(port, request, context);
      },
      kill() {
        spawned.proc.kill();
      },
    });
  }

  async function shutdown(): Promise<void> {
    const killPromises = procs.map((proc) => {
      proc.kill();
      // Give it 5s to exit gracefully, then it's already SIGKILL'd by Bun
      return new Promise<void>((res) => setTimeout(res, 100));
    });
    await Promise.all(killPromises);
  }

  return { children, router, shutdown };
}
