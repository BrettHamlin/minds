/**
 * Router Mind — Root node (node 0) for the Minds architecture.
 *
 * Discovers all sibling Minds, builds a hybrid search index from their
 * descriptions, and routes incoming work units to the correct child.
 * This is the single entry point for all external requests.
 *
 * Unlike child Minds, the Router does NOT use createMind() from server-base.ts.
 * It IS the root MCP server, running on a fixed port (COLLAB_MIND_PORT or 3100).
 *
 * Startup sequence:
 *   1. Start Bun HTTP server on fixed port
 *   2. Discover all sibling Minds (minds/*\/server.ts, excluding self)
 *   3. Announce MIND_READY port=XXXX to stdout
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { resolve } from "path";
import type { MindDescription, WorkUnit, WorkResult } from "../mind.js";
import { validateWorkUnit } from "../mind.js";
import {
  findChildServerFiles,
  spawnChild,
  callDescribe,
  callHandle,
} from "../discovery.js";
import type { ChildProcess, SpawnedChild } from "../discovery.js";
import { MindRouter } from "../router.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.COLLAB_MIND_PORT ?? "3100", 10);
const ROUTER_NAME = "router";

// ---------------------------------------------------------------------------
// Description (exported so tests can validate it without booting the server)
// ---------------------------------------------------------------------------

export const ROUTER_DESCRIPTION: MindDescription = {
  name: ROUTER_NAME,
  domain:
    "Root routing node. Discovers all Minds and routes work units to the correct child using hybrid BM25+vector search.",
  keywords: [
    "route",
    "dispatch",
    "discover",
    "direct",
    "forward",
    "delegate",
    "find",
    "which mind",
    "who owns",
  ],
  owns_files: ["minds/router/"],
  capabilities: [
    "discover all child Minds at startup",
    "build hybrid BM25+vector search index from Mind descriptions",
    "route work units to the best-matched child Mind",
    "escalate unroutable requests",
  ],
};

// ---------------------------------------------------------------------------
// Discovery — sibling Minds (all minds/*/server.ts, excluding router itself)
// ---------------------------------------------------------------------------

interface RouterState {
  children: ChildProcess[];
  mindRouter: MindRouter;
  procs: Array<SpawnedChild["proc"]>;
}

async function discoverSiblings(): Promise<RouterState> {
  // repo root is two levels up from minds/router/
  const repoRoot = resolve(import.meta.dir, "../..");
  const allServerFiles = findChildServerFiles(repoRoot);

  // Exclude the router's own server.ts to prevent self-spawn
  const selfPath = resolve(import.meta.dir, "server.ts");
  const siblingFiles = allServerFiles.filter((p) => resolve(p) !== selfPath);

  const mindRouter = new MindRouter();
  const children: ChildProcess[] = [];
  const procs: Array<SpawnedChild["proc"]> = [];

  for (const serverPath of siblingFiles) {
    let spawned: SpawnedChild;
    try {
      spawned = await spawnChild(serverPath);
    } catch (err) {
      console.warn(`[router] WARNING: Failed to start child at ${serverPath}:`, err);
      continue;
    }

    procs.push(spawned.proc);
    const { port } = spawned;

    let description: MindDescription;
    try {
      description = await callDescribe(port);
    } catch (err) {
      console.warn(`[router] WARNING: Failed to describe child at port ${port}:`, err);
      spawned.proc.kill();
      continue;
    }

    await mindRouter.addChild(description);

    const capturedPort = port;
    const capturedProc = spawned.proc;
    children.push({
      port: capturedPort,
      description,
      async handle(request, context) {
        return callHandle(capturedPort, request, context);
      },
      kill() {
        capturedProc.kill();
      },
    });
  }

  return { children, mindRouter, procs };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

let _state: RouterState | null = null;

/** Returns the router state — must be called after startup completes. */
export function getRouterState(): RouterState | null {
  return _state;
}

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  if (!validateWorkUnit(workUnit)) {
    return { status: "handled", error: "Invalid WorkUnit" };
  }

  if (!_state) {
    return { status: "handled", error: "Router not yet initialized" };
  }

  const { mindRouter, children } = _state;
  const matches = await mindRouter.route(workUnit.request);

  if (matches.length === 0) {
    return { status: "escalate" };
  }

  const best = matches[0];
  const child = children.find((c) => c.description.name === best.mind.name);
  if (!child) {
    return { status: "escalate" };
  }

  try {
    const result = await child.handle(workUnit.request, workUnit.context);
    const workResult = result as WorkResult;
    // Merge routing observability from router level — preserves child's _routing.intent
    return {
      ...workResult,
      _routing: {
        ...workResult._routing,
        mind: best.mind.name,
        score: best.score,
      },
    };
  } catch (err) {
    return {
      status: "handled",
      error: err instanceof Error ? err.message : String(err),
      _routing: {
        mind: best.mind.name,
        score: best.score,
      },
    };
  }
}

function describe(): MindDescription {
  return ROUTER_DESCRIPTION;
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const WorkUnitSchema = z.object({
  request: z.string().describe("Natural language request"),
  context: z.unknown().optional().describe("Optional structured context"),
  from: z.string().optional().describe("Sender Mind name"),
});

function buildMcpServer(): McpServer {
  const mcp = new McpServer({ name: ROUTER_NAME, version: "1.0.0" });

  mcp.registerTool(
    "handle",
    {
      description: "Route a work unit to the appropriate child Mind",
      inputSchema: WorkUnitSchema,
    },
    async (input) => {
      const workUnit: WorkUnit = {
        request: input.request,
        context: input.context,
        from: input.from,
      };
      const result = await handle(workUnit);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  mcp.registerTool(
    "describe",
    { description: "Get the Router Mind description" },
    async () => {
      return {
        content: [{ type: "text", text: JSON.stringify(describe()) }],
      };
    }
  );

  return mcp;
}

// ---------------------------------------------------------------------------
// Start (only when executed directly, not when imported by tests)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      if (req.method === "GET" && new URL(req.url).pathname === "/health") {
        return Response.json({
          ok: true,
          name: ROUTER_NAME,
          children: _state?.children.length ?? 0,
          ready: _state !== null,
        });
      }

      const mcp = buildMcpServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      return transport.handleRequest(req);
    },
  });

  // Discover siblings eagerly, then announce readiness
  _state = await discoverSiblings();
  process.stdout.write(`MIND_READY port=${server.port}\n`);

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  const shutdown = async (): Promise<void> => {
    if (_state) {
      for (const proc of _state.procs) {
        proc.kill();
      }
    }
    await server.stop();
  };

  process.on("SIGTERM", () => {
    shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
  });
  process.on("SIGINT", () => {
    shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}
