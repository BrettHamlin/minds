/**
 * server-base.ts — Zero-boilerplate Mind factory.
 *
 * Every Mind calls createMind() with a config and handler. This module handles:
 * - MCP server setup (Streamable HTTP transport via @modelcontextprotocol/sdk)
 * - Exposing handle + describe as MCP tools
 * - Announcing readiness to parent via stdout: MIND_READY port=XXXX
 * - Graceful shutdown
 *
 * Child discovery and process management live in discovery.ts (L1-4).
 * Routing lives in router.ts (L1-3).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Mind, MindDescription, WorkUnit, WorkResult } from "./mind.js";
import { validateWorkUnit } from "./mind.js";
import { matchIntent } from "./intent.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MindConfig {
  name: string;
  domain: string;
  keywords: string[];
  owns_files: string[];
  capabilities: string[];
  exposes?: string[];
  consumes?: string[];
  handle(workUnit: WorkUnit): Promise<WorkResult>;
}

export interface RunningMind extends Mind {
  /** The port this Mind's MCP HTTP server is listening on. */
  port: number;
  /** Stop the MCP server and release the port. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Zod schemas for MCP tool inputs
// ---------------------------------------------------------------------------

const WorkUnitSchema = z.object({
  request: z.string().describe("Natural language request"),
  context: z.unknown().optional().describe("Optional structured context"),
  from: z.string().optional().describe("Sender Mind name"),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds a fresh McpServer with handle + describe tools registered.
 * Called once per HTTP request for clean stateless isolation.
 */
function buildMcpServer(config: MindConfig, description: MindDescription): McpServer {
  const mcp = new McpServer({ name: config.name, version: "1.0.0" });

  mcp.registerTool(
    "handle",
    {
      description: "Send a work unit to this Mind for processing",
      inputSchema: WorkUnitSchema,
    },
    async (input) => {
      const intent = matchIntent(input.request, config.capabilities);
      const workUnit: WorkUnit = {
        request: input.request,
        context: input.context,
        from: input.from,
        ...(intent !== null && { intent }),
      };
      const result = await config.handle(workUnit);
      // Stamp routing observability (spread to avoid mutating handler's result)
      const stamped = {
        ...result,
        _routing: {
          ...result._routing,
          mind: config.name,
          ...(intent !== null && { intent }),
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(stamped) }],
      };
    }
  );

  mcp.registerTool(
    "describe",
    {
      description: "Get the Mind description (domain, keywords, capabilities)",
    },
    async () => {
      return {
        content: [{ type: "text", text: JSON.stringify(description) }],
      };
    }
  );

  return mcp;
}

/**
 * Creates a running Mind: MCP server on a dynamic port, tools registered,
 * and MIND_READY announcement emitted to stdout.
 */
export async function createMind(config: MindConfig): Promise<RunningMind> {
  const description: MindDescription = {
    name: config.name,
    domain: config.domain,
    keywords: config.keywords,
    owns_files: config.owns_files,
    capabilities: config.capabilities,
    ...(config.exposes !== undefined && { exposes: config.exposes }),
    ...(config.consumes !== undefined && { consumes: config.consumes }),
  };

  // Bun HTTP server — each request gets a fresh McpServer + transport (stateless)
  let resolvePort: (port: number) => void;
  const portPromise = new Promise<number>((res) => {
    resolvePort = res;
  });

  const server = Bun.serve({
    port: 0, // dynamic port
    async fetch(req) {
      // Health check
      if (req.method === "GET" && new URL(req.url).pathname === "/health") {
        return Response.json({ ok: true, name: config.name });
      }

      // Fresh McpServer + transport per request for safe stateless isolation
      const mcp = buildMcpServer(config, description);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      return transport.handleRequest(req);
    },
  });

  resolvePort!(server.port);
  const port = await portPromise;

  // Announce to parent process (discovery.ts reads this from stdout)
  process.stdout.write(`MIND_READY port=${port}\n`);

  // TypeScript-accessible handle + describe (no MCP round-trip needed for in-process use)
  const runningMind: RunningMind = {
    port,

    async handle(workUnit: WorkUnit): Promise<WorkResult> {
      if (!validateWorkUnit(workUnit)) {
        return { status: "handled", error: "Invalid WorkUnit" };
      }
      let intent: string | null = null;
      if (workUnit.intent === undefined) {
        intent = matchIntent(workUnit.request, config.capabilities);
        if (intent !== null) workUnit = { ...workUnit, intent };
      } else {
        intent = workUnit.intent;
      }
      const result = await config.handle(workUnit);
      // Stamp routing observability (spread to avoid mutating handler's result)
      return {
        ...result,
        _routing: {
          ...result._routing,
          mind: config.name,
          ...(intent !== null && { intent }),
        },
      };
    },

    describe(): MindDescription {
      return description;
    },

    async shutdown(): Promise<void> {
      await server.stop();
    },
  };

  return runningMind;
}
