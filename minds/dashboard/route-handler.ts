// route-handler.ts — HTTP route handler for Minds dashboard (BRE-445 T003)
//
// Returns a function (req: Request) => Response | null.
// Pure TypeScript, no React dependency. Serves static files from dist/.

import { join } from "path";
import type { MindsStateTracker } from "./state-tracker.js";

const DIST_DIR = join(import.meta.dir, "dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function mimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export function createMindsRouteHandler(
  tracker: MindsStateTracker
): (req: Request) => Response | null {
  return (req: Request): Response | null => {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- API routes ---

    if (path === "/api/minds/active") {
      return Response.json(tracker.getAllActive());
    }

    if (path === "/api/minds/waves") {
      const ticketId = url.searchParams.get("ticket");
      if (!ticketId) {
        return Response.json({ error: "Missing ticket param" }, { status: 400 });
      }
      const state = tracker.getState(ticketId);
      if (!state) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      return Response.json({ waves: state.waves });
    }

    if (path === "/api/minds/contracts") {
      const ticketId = url.searchParams.get("ticket");
      if (!ticketId) {
        return Response.json({ error: "Missing ticket param" }, { status: 400 });
      }
      const state = tracker.getState(ticketId);
      if (!state) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      return Response.json({ contracts: state.contracts });
    }

    // --- SSE endpoint ---

    if (path === "/subscribe/minds-status") {
      let unsubscribe: (() => void) | null = null;

      const stream = new ReadableStream({
        start(controller) {
          unsubscribe = tracker.subscribe((state) => {
            try {
              const data = JSON.stringify(state);
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            } catch {
              // Client disconnected
            }
          });
        },
        cancel() {
          if (unsubscribe) unsubscribe();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // --- SPA / static files ---

    if (path === "/minds" || path === "/minds/") {
      const filePath = join(DIST_DIR, "index.html");
      const file = Bun.file(filePath);
      return new Response(file, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path.startsWith("/minds/")) {
      const relativePath = path.slice("/minds/".length);
      const filePath = join(DIST_DIR, relativePath);
      const file = Bun.file(filePath);
      return new Response(file, {
        headers: { "Content-Type": mimeType(filePath) },
      });
    }

    return null;
  };
}
