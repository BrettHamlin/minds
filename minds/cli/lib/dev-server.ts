/**
 * dev-server.ts — Start/stop a dev server for post-merge verification.
 *
 * The visual verification drone needs a running server to fetch the live page.
 * This module manages the server lifecycle: start on a free port, wait for
 * readiness, and clean shutdown.
 */

import { existsSync } from "fs";
import { join } from "path";

export interface DevServerHandle {
  proc: ReturnType<typeof Bun.spawn>;
  port: number;
  url: string;
}

/**
 * Start the project's dev server on a free port.
 *
 * Looks for the main entrypoint (packages/core/main.ts or similar),
 * spawns it with PORT env var, and polls for readiness.
 */
export async function startDevServer(
  repoRoot: string,
  opts?: { timeoutMs?: number },
): Promise<DevServerHandle> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;

  // Find the server entrypoint
  const candidates = [
    "packages/core/main.ts",
    "src/index.ts",
    "src/main.ts",
    "server.ts",
    "index.ts",
  ];
  const entrypoint = candidates.find((c) => existsSync(join(repoRoot, c)));
  if (!entrypoint) {
    throw new Error(
      `Cannot find server entrypoint in ${repoRoot}. Tried: ${candidates.join(", ")}`,
    );
  }

  // Pick a free port by binding to 0 and reading the assigned port
  const port = await findFreePort();

  // Spawn the server
  const proc = Bun.spawn(["bun", "run", entrypoint], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the server to be ready (poll health endpoint)
  const url = `http://localhost:${port}`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) {
        // Server is responding (any non-5xx means it's up)
        return { proc, port, url };
      }
    } catch {
      // Not ready yet — wait and retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Timeout — kill the process and throw
  proc.kill();
  throw new Error(
    `Dev server did not become ready within ${timeoutMs}ms on port ${port}`,
  );
}

/**
 * Stop a running dev server.
 */
export async function stopDevServer(handle: DevServerHandle): Promise<void> {
  try {
    handle.proc.kill();
  } catch {
    // Already dead — that's fine
  }
}

/**
 * Find a free TCP port by briefly binding to port 0.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("port-probe");
      },
    });
    const port = server.port;
    server.stop(true);
    resolve(port);
  });
}
