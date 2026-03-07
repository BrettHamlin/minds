# @router Mind Profile

## Domain

Root node (node 0) of the Minds architecture. Discovers all sibling Minds at startup, builds a hybrid BM25+vector search index from their descriptions, and routes incoming work units to the best-matched child. The single entry point for all external requests.

## Conventions

- The Router is **the only** MCP server that runs on a fixed port (`COLLAB_MIND_PORT` or 3100). Child Minds use `createMind()` from `server-base.ts` and run on ephemeral ports.
- Discovery uses `findChildServerFiles()` + `spawnChild()` + `callDescribe()` from `minds/discovery.ts` — never hardcode child Mind paths or ports.
- Routing uses `MindRouter` from `minds/router.ts` — do not implement custom ranking or scoring in `server.ts`.
- The Router merges `_routing` metadata (mind name + score) onto the child's result — preserve the child's existing `_routing.intent` if present.
- Graceful shutdown kills all child processes — always register `SIGTERM` and `SIGINT` handlers.
- The `/health` endpoint returns `{ ok, name, children, ready }` — do not add other HTTP routes here.

## Key Files

- `minds/router/server.ts` — startup, discovery, MCP server, routing, graceful shutdown
- `minds/router.ts` — `MindRouter` class (BM25 + optional vector search)
- `minds/discovery.ts` — `findChildServerFiles()`, `spawnChild()`, `callDescribe()`, `callHandle()`
- `minds/bm25.ts` — BM25 index implementation
- `minds/embeddings.ts` — embedding model loader for hybrid search

## Anti-Patterns

- Calling a child Mind's server directly (bypass the router) — all requests go through `handle()`.
- Adding business logic to `server.ts` — routing decisions belong in `MindRouter`.
- Hardcoding child Mind names or ports (discovery is always dynamic).
- Not killing child processes on shutdown (resource leak).

## Review Focus

- All routing goes through `MindRouter.route()` — no manual mind selection.
- `_routing` metadata merged without losing the child's `intent` field.
- Child discovery is purely dynamic — no hardcoded paths.
- SIGTERM/SIGINT handlers kill all child processes before exit.
