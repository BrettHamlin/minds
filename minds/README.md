# Minds Architecture

The Minds system is a hierarchical MCP-based agent architecture that decomposes the collab pipeline into autonomous, domain-focused services. Each Mind exposes exactly two tools — `handle()` and `describe()` — and communicates exclusively via those interfaces.

Work enters the system through the Router Mind (root node), which discovers all children at startup, builds a hybrid BM25+vector search index from their descriptions, and routes each incoming work unit to the best-matched child.

---

## Mind Inventory

| Name | Type | Domain | Files |
|------|------|--------|-------|
| **router** | root | Root routing node. Discovers all Minds and routes work units via hybrid BM25+vector search. | `minds/router/` |
| **pipeline_core** | leaf | Pipeline types, registry CRUD, signal definitions, phase transitions, paths, repo-registry. | `minds/pipeline_core/` |
| **execution** | leaf | Phase dispatch, gate evaluation, orchestrator init, phase executors, hooks, retry config, execution mode. | `minds/execution/` |
| **coordination** | leaf | Dependency holds, group management, batch Q&A, held-release scan, ticket resolution. | `minds/coordination/` |
| **observability** | leaf | Metrics, run classification, draft PR, gate accuracy, autonomy rate, dashboard, statusline. | `minds/observability/` |
| **signals** | leaf | Signal emission handlers, transport dispatch, token resolution, emit-findings. | `minds/signals/` |
| **transport** | leaf | Transport interface, TmuxTransport, BusTransport, bus server, status aggregation, resolve-transport. | `minds/transport/` |
| **cli** | leaf | collab binary, arg parsing, package registry, repo management, semver. | `minds/cli/` |
| **installer** | leaf | File mapping, distribution logic, install hooks, upgrade paths. | `minds/installer/` |
| **templates** | leaf | All distributable config, scripts, schemas, gate prompts (pure data). | `minds/templates/` |
| **spec_api** | parent | HTTP REST API gateway for spec creation workflows. Delegates to SpecEngine child. | `minds/spec_api/` |
| **integrations** | leaf | Slack adapter and future Discord, Teams integrations. | `minds/integrations/` |
| **pipelang** | leaf | DSL lexer, parser, compiler, validator, LSP for pipeline language. | `minds/pipelang/` |

**Total: 13 Minds** (1 root, 1 parent, 11 leaf)

---

## Start the Router Mind

```bash
# Default port 3100
bun minds/router/server.ts

# Custom port
COLLAB_MIND_PORT=4000 bun minds/router/server.ts
```

The Router emits `MIND_READY port=3100` on stdout once all children are discovered and indexed. Startup discovers and starts all 12 child Minds automatically.

---

## Run the Boundary Linter

```bash
bun minds/lint-boundaries.ts
```

Exit code 0 = clean. Exit code 1 = boundary violations found. Violations indicate a Mind is importing directly from another Mind's directory without the `// CROSS-MIND` annotation.

---

## Run Tests

```bash
# All minds tests
bun test minds/

# Router Mind only
bun test minds/router/

# Full project suite
bun test
```

---

## Protocol Infrastructure

Files at the `minds/` root are shared protocol infrastructure — not Minds:

| File | Purpose |
|------|---------|
| `mind.ts` | Core interfaces: `WorkUnit`, `WorkResult`, `MindDescription`, `Mind` |
| `server-base.ts` | `createMind()` factory — used by all leaf/parent Minds |
| `discovery.ts` | Child process lifecycle: spawn, describe, handle, discoverChildren |
| `router.ts` | `MindRouter` — BM25+vector hybrid search routing engine |
| `bm25.ts` | BM25 index implementation |
| `embeddings.ts` | Vector embedding interface and cosine similarity |
| `lint-boundaries.ts` | Architectural boundary enforcement tool |
