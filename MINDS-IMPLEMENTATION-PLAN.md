# Minds Architecture — Implementation Plan

Concrete, ticket-ready plans for migrating the collab codebase to the Minds architecture defined in `DOMAIN-DECOMPOSITION.md`.

**Current state:** 162 TS source files, 126 test files, 2438 passing tests, ~24,000 lines of source. No `minds/` directory exists yet. All cross-Mind communication is via direct imports. Recent DRY consolidation (BRE-427 through BRE-431) extracted deterministic utilities from markdown into standalone CLI scripts, adding new files that need correct Mind ownership.

**Target state:** 14 Minds in a flat `minds/` tree under a Router Mind root node. All cross-Mind communication via `handle()` / `describe()` protocol. MCP-first, Streamable HTTP transport.

---

## Phase Dependencies

```
Layer 1 (Protocol Infrastructure)
    |
    v
Layer 2 (SpecAPI + SpecEngine proof-of-concept)
    |
    v
Wave A (Templates, Integrations, Transport, Pipelang)
    |
    v
Wave B (Signals, CLI, Installer)
    |
    v
Wave C (Coordination, Observability)
    |
    v
Wave D (Pipeline Core, Execution)
    |
    v
Wave E (Router Mind)
```

Each phase depends on the previous. Within each phase, tickets can often run in parallel.

---

## Layer 1: Protocol Infrastructure

> **Before starting:** Load `MINDS-CONSTITUTION.md` into context.

**Goal:** Build the Mind protocol that everything runs on. No application code moves. Pure infrastructure + tests.

**Estimated tickets:** 5

---

### L1-1: Mind Interface & Types

**Create:** `minds/mind.ts`

Define the core interfaces that every Mind implements:

```
WorkUnit         { request: string; context?: unknown; from?: string }
WorkResult       { status: "handled" | "escalate"; data?: unknown; error?: string }
MindDescription  { name: string; domain: string; keywords: string[]; owns_files: string[]; capabilities: string[] }
Mind             { handle(workUnit): Promise<WorkResult>; describe(): MindDescription }
```

**Acceptance criteria:**
- [ ] `minds/mind.ts` exports all 4 interfaces
- [ ] Interfaces are runtime-validated with a `validateWorkUnit()` guard
- [ ] No external dependencies (pure TypeScript types + validation)
- [ ] Unit tests for validation guards

**Files created:**
- `minds/mind.ts`
- `minds/mind.test.ts`

**Dependencies:** None
**Risk:** Low — pure types

---

### L1-2: Server Base (`createMind()`)

**Create:** `minds/server-base.ts`

The zero-boilerplate Mind factory. Every Mind calls `createMind()` with a description and handler. `server-base.ts` handles:

1. MCP server setup (Streamable HTTP transport)
2. Parent registration (announce self to whoever started this process)
3. Child discovery (scan `minds/*/server.ts` relative to own dir)
4. Escalation wiring (if `handle()` returns `{ status: "escalate" }`, forward to parent)
5. Health check endpoint

Each Mind's `server.ts` should be ~10 lines calling `createMind()`.

**Acceptance criteria:**
- [ ] `createMind(config)` returns a running Mind with MCP server on a dynamic port
- [ ] Mind exposes `handle` and `describe` as MCP tools
- [ ] Streamable HTTP transport (single HTTP endpoint per Mind)
- [ ] Child discovery: scans `minds/*/server.ts` relative to the Mind's own directory
- [ ] Parent registration: on startup, announces itself to the parent that started it
- [ ] Escalation: if `handle()` returns `escalate`, forwards to parent's `handle()`
- [ ] Graceful shutdown: stops child processes, closes MCP server
- [ ] Unit tests with mock Minds (no real child processes)

**Files created:**
- `minds/server-base.ts`
- `minds/server-base.test.ts`

**Dependencies:** L1-1
**Risk:** Medium — MCP server setup and Streamable HTTP transport are the most complex pieces. Need to decide on MCP SDK dependency (`@modelcontextprotocol/sdk` or custom lightweight implementation).

**Key decision:** Use `@modelcontextprotocol/sdk` for the MCP server implementation. It handles the protocol correctly and is the standard. The "zero external Go modules" rule in CLAUDE.md applies to Go code; TypeScript Minds use Bun and can take dependencies.

---

### L1-3: Routing Engine (Hybrid Search)

**Create:** `minds/router.ts`

The routing engine that any parent Mind uses to find the right child for a work unit.

**Components:**
1. **BM25 index** — exact keyword matching against Mind descriptions (30% weight)
2. **Vector similarity** — semantic search over embeddings (70% weight). Use `all-MiniLM-L6-v2` via `@xenova/transformers` (runs locally in Bun, ~22MB model)
3. **QMD-style reranking** — prevents central Minds from dominating every query
4. **Multi-match support** — returns ranked list of matches with scores + suggested roles

**Acceptance criteria:**
- [ ] `MindRouter.addChild(mind)` indexes a Mind's description
- [ ] `MindRouter.route(workUnit)` returns ranked matches `{ mind, score, role }[]`
- [ ] BM25 component matches exact keywords (e.g., "signal" matches Signals Mind)
- [ ] Vector component matches semantic intent (e.g., "change how phases transition" matches Execution Mind)
- [ ] QMD reranking prevents Pipeline Core from dominating every query
- [ ] Falls back to BM25-only if vector model fails to load (graceful degradation)
- [ ] Tiny corpus (< 20 Minds) — index builds in < 100ms
- [ ] Unit tests with 5+ mock Mind descriptions covering edge cases

**Files created:**
- `minds/router.ts`
- `minds/bm25.ts` (BM25 index implementation)
- `minds/embeddings.ts` (vector embedding wrapper)
- `minds/router.test.ts`

**Dependencies:** L1-1
**Risk:** Medium — vector embeddings add a dependency and model download. BM25-only fallback mitigates this. Could start BM25-only and add vectors in a follow-up if scope is too large.

**Scope control:** If vector embeddings add too much complexity for Layer 1, ship with BM25-only routing and add vector search as a separate ticket after Layer 2 validates the protocol. BM25 alone is sufficient for <20 Minds with good keyword coverage.

---

### L1-4: Process Management & Discovery

**Create:** `minds/discovery.ts`

Convention-based Mind discovery and child process lifecycle management.

**How it works:**
1. A parent Mind calls `discoverChildren(parentDir)` at startup
2. Scans `minds/*/server.ts` relative to `parentDir`
3. Starts each child as a `Bun.spawn()` child process
4. Waits for each child to announce its port (via stdout protocol line: `MIND_READY port=XXXX`)
5. Connects to each child's MCP server
6. Calls `describe()` on each child
7. Registers children with the routing engine

**Process lifecycle:**
- Child processes are owned by the parent that started them
- Parent monitors child health via periodic `describe()` calls
- If a child dies, parent logs the failure and removes it from the router
- On parent shutdown, all children are terminated (SIGTERM → SIGKILL after 5s)

**Acceptance criteria:**
- [ ] `discoverChildren(parentDir)` finds all `minds/*/server.ts` files
- [ ] Each child is started as a `Bun.spawn()` subprocess
- [ ] Parent waits for `MIND_READY` protocol line before connecting
- [ ] Startup timeout (10s per child) with clear error if child fails to start
- [ ] `describe()` is called on each child after connection
- [ ] Parent gracefully shuts down all children on exit
- [ ] Integration test: start 2 mock Minds, verify discovery + connection + describe

**Files created:**
- `minds/discovery.ts`
- `minds/discovery.test.ts`

**Dependencies:** L1-1, L1-2
**Risk:** Medium — child process management needs careful error handling (port conflicts, startup failures, zombie processes). Bun's `Bun.spawn()` handles most of this well.

---

### L1-5: Protocol Integration Tests

**Create:** Full integration test suite for the Mind protocol.

End-to-end tests that validate the complete protocol with real (but minimal) Minds:

1. **Delegation test:** Parent with 2 children. Send work unit matching child A's domain → A handles it. Send work unit matching child B → B handles it.
2. **Escalation test:** Child receives work outside its domain → returns `escalate` → parent tries next child → finds match.
3. **Deep escalation test:** 3 levels deep. Leaf Mind escalates → mid-level Mind can't handle → root Mind routes to sibling subtree.
4. **Multi-match test:** Work unit matches 2 children → parent sends to highest-scored match.
5. **No match test:** Work unit matches no child → root Mind returns error (no parent to escalate to).
6. **Describe accuracy test:** Each Mind's `describe()` output correctly represents its domain.
7. **Process lifecycle test:** Start children → kill a child → parent detects and removes from router → remaining children still work.

**Acceptance criteria:**
- [ ] All 7 test scenarios pass
- [ ] Tests use real `Bun.spawn()` child processes (not mocks)
- [ ] Tests clean up all child processes on completion (no zombies)
- [ ] Tests complete in < 10s total
- [ ] No flaky tests from port conflicts (use dynamic ports)

**Files created:**
- `minds/integration.test.ts`
- `minds/fixtures/mock-mind-a/server.ts` (test fixture)
- `minds/fixtures/mock-mind-b/server.ts` (test fixture)
- `minds/fixtures/mock-mind-c/server.ts` (test fixture, for deep escalation)

**Dependencies:** L1-1, L1-2, L1-3, L1-4
**Risk:** Low — this validates everything before any application code moves.

---

## Layer 2: Proof-of-Concept (SpecAPI + SpecEngine)

> **Before starting:** Load `MINDS-CONSTITUTION.md` into context. Verify Layer 1 gate passes.

**Goal:** Build the first real Mind pair to validate the protocol with actual application code. SpecAPI (parent) delegates to SpecEngine (child) via `handle()`.

**Why this pair:** Self-contained (own DB, own Express server), no Pipeline Core gravity well, genuine parent-child relationship, ~1,700 lines total.

**Estimated tickets:** 4

---

### L2-1: Create SpecEngine Mind

**Move files INTO:** `minds/spec_engine/`

| Source | Destination |
|--------|-------------|
| `src/services/*.ts` (10 files) | `minds/spec_engine/services/` |
| `src/db/schema.ts`, `src/db/index.ts` | `minds/spec_engine/db/` |
| `src/lib/errors.ts` | `minds/spec_engine/errors.ts` |
| `src/lib/validation.ts` | `minds/spec_engine/validation.ts` |
| `src/lib/markdown.ts` | `minds/spec_engine/markdown.ts` |

**Create:** `minds/spec_engine/server.ts`

```typescript
import { createMind } from "../server-base";
export default createMind({
  name: "spec_engine",
  domain: "Spec generation core: LLM calls, session state machine, Q&A, database persistence",
  keywords: ["spec", "generate", "session", "question", "answer", "llm", "drizzle", "database"],
  owns_files: ["minds/spec_engine/"],
  capabilities: ["create spec", "generate questions", "record answers", "manage sessions", "blind QA"],
  async handle(workUnit) {
    // Route to internal service functions based on workUnit.request
  },
});
```

**Acceptance criteria:**
- [ ] All 10 service files moved to `minds/spec_engine/services/`
- [ ] DB files moved to `minds/spec_engine/db/`
- [ ] Shared lib files (errors, validation, markdown) moved to `minds/spec_engine/`
- [ ] `server.ts` implements `handle()` that routes to internal service functions
- [ ] `describe()` returns accurate domain description
- [ ] Internal imports updated (relative paths within the Mind)
- [ ] SpecEngine's own tests pass in new location
- [ ] No file outside `minds/spec_engine/` imports from inside it

**Dependencies:** L1-1, L1-2
**Risk:** Low — SpecEngine has 0 outbound deps (it's a leaf). Moving files and updating relative imports is mechanical.

---

### L2-2: Create SpecAPI Mind (Parent of SpecEngine)

**Move files INTO:** `minds/spec_api/`

| Source | Destination |
|--------|-------------|
| `src/index.ts` | `minds/spec_api/index.ts` |
| `src/routes/*.ts` (3 files) | `minds/spec_api/routes/` |
| `src/routes/middleware.ts` | `minds/spec_api/middleware.ts` |

**Create:** `minds/spec_api/server.ts`

SpecAPI is a parent Mind — it has a `minds/` subdirectory containing SpecEngine:

```
minds/spec_api/
  server.ts
  index.ts          (Express server)
  routes/
  middleware.ts
  minds/
    spec_engine/    (child Mind — discovered automatically)
      server.ts
      services/
      db/
```

**Acceptance criteria:**
- [ ] Express server moved to `minds/spec_api/`
- [ ] Routes moved, internal imports updated
- [ ] `server.ts` creates Mind with child discovery (finds `minds/spec_engine/`)
- [ ] SpecAPI's `handle()` delegates to SpecEngine child for business logic
- [ ] All direct imports from `src/services/` in route files replaced with `handle()` calls to SpecEngine child
- [ ] HTTP API behavior identical to before (same endpoints, same responses)
- [ ] All existing API tests pass

**Dependencies:** L2-1
**Risk:** Medium — replacing direct imports with `handle()` calls in route handlers. Each route handler currently does something like `const spec = await specService.create(...)`. This becomes `const result = await this.delegateToChild("spec_engine", { request: "create spec", context: { ... } })`. Need to handle serialization correctly.

---

### L2-3: Update Top-Level Imports

**Modify:** Any file outside SpecAPI/SpecEngine that imported from `src/services/`, `src/db/`, `src/lib/errors.ts`, `src/lib/validation.ts`, or `src/lib/markdown.ts`.

Based on codebase analysis:
- `src/index.ts` → already moved (is SpecAPI)
- `src/routes/*.ts` → already moved (is SpecAPI)
- `src/plugins/slack/` → calls SpecAPI via HTTP (already clean, no direct imports)

**Acceptance criteria:**
- [ ] No file outside `minds/spec_api/` or `minds/spec_engine/` imports from inside them
- [ ] `bun test` passes — all 2438+ tests green
- [ ] Grep for old import paths returns zero results

**Dependencies:** L2-1, L2-2
**Risk:** Low — Integrations (Slack) already uses HTTP, so there should be minimal external importers.

---

### L2-4: Protocol Validation Tests for SpecAPI/SpecEngine

**Create:** Protocol-level tests specific to this Mind pair.

1. SpecAPI receives work unit "create a spec for X" → delegates to SpecEngine → returns generated spec
2. SpecAPI receives work unit "get session state" → delegates to SpecEngine → returns session
3. SpecEngine receives work unit outside its domain → returns `{ status: "escalate" }` → SpecAPI handles
4. `describe()` accuracy test for both Minds

**Acceptance criteria:**
- [ ] 4 protocol tests pass
- [ ] Tests use real MCP transport (not mocked)
- [ ] HTTP API still works end-to-end (integration test: HTTP request → SpecAPI Mind → SpecEngine Mind → DB → response)
- [ ] All pre-existing tests still pass

**Dependencies:** L2-2
**Risk:** Low

---

## Wave A: Already-Isolated Minds

> **Before starting:** Load `MINDS-CONSTITUTION.md` into context. Verify Layer 2 gate passes.

**Goal:** Move 4 already-isolated code areas into Minds. These have minimal cross-Mind imports and are the easiest moves.

**Estimated tickets:** 4 (one per Mind, can run in parallel)

---

### WA-1: Templates Mind

**Move:** `cli/src/templates/` + `src/config/` → `minds/templates/`

| Source | Destination |
|--------|-------------|
| `cli/src/templates/config/` (pipeline.json, schemas, gates, displays, contexts) | `minds/templates/config/` |
| `cli/src/templates/scripts/` | `minds/templates/scripts/` |
| `cli/src/templates/hooks/` | `minds/templates/hooks/` |
| `cli/src/templates/lib-pipeline/` | `minds/templates/lib-pipeline/` |
| `cli/src/templates/claude-settings.json` | `minds/templates/` |
| `cli/src/templates/specify-scripts/` | `minds/templates/specify-scripts/` |
| `src/config/pipeline-variants/` | `minds/templates/pipeline-variants/` |
| `src/config/defaults/` | `minds/templates/defaults/` |
| `src/config/test-fixtures/` | `minds/templates/test-fixtures/` |
| `cli/src/templates/lib-pipeline/paths.ts` (BRE-428, new) | `minds/templates/lib-pipeline/paths.ts` |
| `cli/src/templates/orchestrator/dispatch-phase-hooks.ts` (BRE-430) | `minds/templates/orchestrator/dispatch-phase-hooks.ts` |
| `cli/src/templates/orchestrator/check-dependency-hold.ts` (BRE-430, 151 lines) | `minds/templates/orchestrator/check-dependency-hold.ts` |
| `cli/src/templates/scripts/resolve-retry-config.ts` (BRE-430) | `minds/templates/scripts/resolve-retry-config.ts` |

**Create:** `minds/templates/server.ts`

Leaf Mind. `handle()` supports:
- "list templates" → returns template inventory
- "read template {path}" → returns template content
- "get schema {name}" → returns JSON schema

**Acceptance criteria:**
- [ ] All template/config files moved
- [ ] `server.ts` with `describe()` and `handle()`
- [ ] Leaf Mind — no children, no child discovery
- [ ] Installer Mind (currently `cli/src/utils/installer.ts`) updated to NOT directly read templates — instead requests through parent (handled in Wave B)
- [ ] Temporary: Installer can still directly read from `minds/templates/` until Wave B decouples it
- [ ] Tests pass

**Dependencies:** L1-1, L1-2, L2-4 (protocol proven)
**Risk:** Low — pure data files, no logic to break

---

### WA-2: Integrations Mind

**Move:** `src/plugins/slack/` → `minds/integrations/slack/`

| Source | Destination |
|--------|-------------|
| `src/plugins/slack/client.ts` | `minds/integrations/slack/client.ts` |
| `src/plugins/slack/commands.ts` | `minds/integrations/slack/commands.ts` |
| `src/plugins/slack/interactions.ts` | `minds/integrations/slack/interactions.ts` |
| `src/plugins/slack/blocks.ts` | `minds/integrations/slack/blocks.ts` |

Also move `src/plugins/linear/` and `src/plugins/jira/` if they exist.

**Create:** `minds/integrations/server.ts`

**Acceptance criteria:**
- [ ] All plugin adapters moved
- [ ] Leaf Mind with `handle()` and `describe()`
- [ ] Slack adapter still calls SpecAPI via HTTP (no change to communication pattern)
- [ ] Tests pass

**Dependencies:** L1-1, L1-2
**Risk:** Low — Integrations is already the most isolated Mind (uses HTTP, no direct imports)

---

### WA-3: Transport Mind

**Move:** `transport/` → `minds/transport/`

| Source | Destination |
|--------|-------------|
| `transport/Transport.ts` | `minds/transport/Transport.ts` |
| `transport/TmuxTransport.ts` | `minds/transport/TmuxTransport.ts` |
| `transport/BusTransport.ts` | `minds/transport/BusTransport.ts` |
| `transport/bus-server.ts` | `minds/transport/bus-server.ts` |
| `transport/bus-agent.ts` | `minds/transport/bus-agent.ts` |
| `transport/bus-signal-bridge.ts` | `minds/transport/bus-signal-bridge.ts` |
| `transport/bus-command-bridge.ts` | `minds/transport/bus-command-bridge.ts` |
| `transport/status-*.ts` (4 files) | `minds/transport/status-*.ts` |
| `transport/dashboard.html` | `minds/transport/dashboard.html` |
| `src/lib/resolve-transport.ts` | `minds/transport/resolve-transport.ts` **(absorbed)** |

**Create:** `minds/transport/server.ts`

**Key change:** `resolve-transport.ts` (currently orphaned in `src/lib/`) moves INTO Transport Mind. This is Transport's responsibility — deciding which transport implementation to use.

**Acceptance criteria:**
- [ ] All transport files moved
- [ ] `resolve-transport.ts` absorbed into Transport Mind
- [ ] `server.ts` with `handle()` supporting: "publish message", "subscribe to channel", "resolve transport", "get status"
- [ ] `bus-command-bridge.test.ts` circular import on `orchestrator-init.ts` eliminated (test uses mock instead)
- [ ] External importers of `resolve-transport.ts` updated to import from `minds/transport/` (temporary until they become Minds themselves)
- [ ] Tests pass

**Dependencies:** L1-1, L1-2
**Risk:** Low-Medium — `resolve-transport.ts` absorption is the only non-trivial change. External importers (Signals, Execution) need path updates.

---

### WA-4: Pipelang Mind

**Move:** `pipelang/` → `minds/pipelang/`

This is nearly a `mv` operation — Pipelang is already isolated in its own directory.

| Source | Destination |
|--------|-------------|
| `pipelang/src/*.ts` (all) | `minds/pipelang/src/*.ts` |
| `pipelang/tests/` | `minds/pipelang/tests/` |

**Create:** `minds/pipelang/server.ts`

**Cross-Mind imports to address:**
- `runner.ts` imports types (`CompiledPipeline`, `CompiledGate`) from `src/lib/pipeline/types.ts` → **Dev-time:** request through parent. **Runtime:** direct import stays (Rule 1)
- `runner.ts` imports `resolveGateResponse`, `resolveConditionalTransition` from `src/lib/pipeline/transitions.ts` → same treatment

**Acceptance criteria:**
- [ ] Pipelang files moved to `minds/pipelang/`
- [ ] `server.ts` with `handle()` supporting: "compile pipeline source", "validate pipeline", "diff pipelines"
- [ ] Type imports from Pipeline Core flagged with `// CROSS-MIND: runtime import only` comments
- [ ] Dev-time agents working in Pipelang Mind cannot grep/read Pipeline Core files
- [ ] All Pipelang tests pass in new location
- [ ] LSP server still works

**Dependencies:** L1-1, L1-2
**Risk:** Low — already isolated. The runtime type imports are architecturally acceptable per Rule 1.

---

## Wave B: Sibling Routing Validation

> **Before starting:** Load `MINDS-CONSTITUTION.md` into context. Verify Wave A gate passes.

**Goal:** First real test of cross-Mind communication through a parent. Signals, CLI, and Installer all currently import from Pipeline Core and Transport — those imports become `handle()` escalations through the parent.

**Estimated tickets:** 3

---

### WB-1: Signals Mind

**Move:** `src/handlers/` + `src/hooks/question-signal.hook.ts` → `minds/signals/`

| Source | Destination |
|--------|-------------|
| `src/handlers/pipeline-signal.ts` | `minds/signals/pipeline-signal.ts` |
| `src/handlers/emit-phase-signal.ts` | `minds/signals/emit-phase-signal.ts` |
| `src/handlers/emit-*-signal.ts` (8 files) | `minds/signals/emit-*-signal.ts` |
| `src/handlers/resolve-tokens.ts` | `minds/signals/resolve-tokens.ts` |
| `src/handlers/emit-signal.ts` | `minds/signals/emit-signal.ts` |
| `src/handlers/signal-contract.test.ts` | `minds/signals/signal-contract.test.ts` |
| `src/handlers/emit-phase-signal.test.ts` | `minds/signals/emit-phase-signal.test.ts` |
| `src/hooks/question-signal.hook.ts` | `minds/signals/question-signal.hook.ts` |

**Cross-Mind imports to decouple:**
1. `pipeline-signal.ts` imports `loadPipelineForTicket` from Pipeline Core → escalate to parent: `handle({ request: "load pipeline for ticket", context: { ticketId } })`
2. `emit-phase-signal.ts` imports `resolveTransportPath` from Transport → escalate to parent: `handle({ request: "resolve transport path" })`
3. `emit-phase-signal.ts` dynamically imports `BusTransport` and `TmuxTransport` → escalate to parent: `handle({ request: "publish message", context: { channel, message } })`

**This is the first real test of sibling routing:** Signals Mind escalates "load pipeline for ticket" to parent → parent routes to Pipeline Core Mind (not yet a Mind, so temporarily routes to Pipeline Core's files directly). Full decoupling completes in Wave D.

**Acceptance criteria:**
- [ ] All handler files moved
- [ ] `server.ts` with `handle()` and `describe()`
- [ ] Pipeline Core imports replaced with parent escalation calls
- [ ] Transport imports replaced with parent escalation calls
- [ ] Signal emission still works end-to-end (E2E test)
- [ ] Contract tests pass
- [ ] No file outside `minds/signals/` imports from inside it

**Dependencies:** WA-3 (Transport Mind exists)
**Risk:** Medium — first real cross-Mind decoupling. The parent routing for Pipeline Core data needs a temporary bridge since Pipeline Core isn't a Mind yet (Wave D). Solution: the parent (Router or a temporary shim) handles "load pipeline for ticket" by calling the function directly from `src/lib/pipeline/utils.ts` until Wave D.

---

### WB-2: CLI Mind

**Move:** `src/cli/` + `cli/bin/collab.ts` → `minds/cli/`

| Source | Destination |
|--------|-------------|
| `src/cli/index.ts` | `minds/cli/index.ts` |
| `src/cli/commands/` | `minds/cli/commands/` |
| `src/cli/lib/` | `minds/cli/lib/` |
| `src/cli/types/` | `minds/cli/types/` |
| `cli/bin/collab.ts` | `minds/cli/bin/collab.ts` |
| `cli/src/utils/fs.ts`, `git.ts`, `version.ts` | `minds/cli/utils/` |

**Cross-Mind imports to decouple:**
1. `cli/src/utils/` and `src/cli/commands/repo/` import `readRepos`, `writeRepos` from `src/lib/pipeline/repo-registry.ts` → escalate to parent

**Acceptance criteria:**
- [ ] Both CLI entry points moved
- [ ] `server.ts` with `handle()` supporting: "browse pipelines", "install pipeline", "resolve repo path"
- [ ] `repo-registry.ts` imports replaced with parent escalation
- [ ] Compiled binary (`collab`) still builds and works
- [ ] npm package entry point still works
- [ ] All CLI tests pass

**Dependencies:** L1-1, L1-2
**Risk:** Medium — two CLI entry points (compiled binary + npm package) need careful handling. The compiled binary imports must work at runtime (Rule 1).

---

### WB-3: Installer Mind

**Move:** Scattered installer files → `minds/installer/`

| Source | Destination |
|--------|-------------|
| `src/cli/commands/pipelines/install.ts` | `minds/installer/install.ts` |
| `cli/src/utils/installer.ts` | `minds/installer/core.ts` |
| `src/commands/collab.install.ts` | `minds/installer/collab-install.ts` |
| `scripts/install.sh` | `minds/installer/install.sh` |

**Cross-Mind imports to decouple:**
1. Template reads → escalate to parent: `handle({ request: "read template", context: { path } })`
2. CLI calls installer directly → escalate to parent: `handle({ request: "install pipeline", context: { ... } })`

**Acceptance criteria:**
- [ ] All installer files consolidated in one Mind
- [ ] `server.ts` with `handle()` supporting: "install pipeline", "check for updates", "get file mappings"
- [ ] Template reads go through parent (which routes to Templates Mind)
- [ ] Install flow works end-to-end (`collab install`)
- [ ] Tests pass

**Dependencies:** WA-1 (Templates Mind exists), WB-2 (CLI Mind exists)
**Risk:** Medium — installer is currently scattered across 4 files in 3 different directories. Consolidation is the hard part, not the Mind wrapping.

---

## Wave C: Orchestrator Untangle

> **Before starting:** Load `MINDS-CONSTITUTION.md` into context. Verify Wave B gate passes.

**Goal:** Separate Coordination and Observability files from the monolithic `src/scripts/orchestrator/` directory. These are currently interleaved with Execution files.

**Estimated tickets:** 2

---

### WC-1: Coordination Mind

**Move from** `src/scripts/orchestrator/` and `src/scripts/orchestrator/commands/`:

| Source | Destination |
|--------|-------------|
| `commands/coordination-check.ts` + `.test.ts` | `minds/coordination/coordination-check.ts` |
| `check-dependency-hold.ts` + `.test.ts` (BRE-430, 151 lines) | `minds/coordination/check-dependency-hold.ts` |
| `held-release-scan.ts` + `.test.ts` | `minds/coordination/held-release-scan.ts` |
| `commands/group-manage.ts` + `.test.ts` | `minds/coordination/group-manage.ts` |
| `commands/resolve-tickets.ts` | `minds/coordination/resolve-tickets.ts` |
| `commands/write-resolutions.ts` + `.test.ts` | `minds/coordination/write-resolutions.ts` |
| `commands/resolve-questions.ts` + `.test.ts` | `minds/coordination/resolve-questions.ts` |
| `commands/question-response.ts` | `minds/coordination/question-response.ts` |

**Cross-Mind imports to decouple:**
1. `coordination-check.ts` imports `readFeatureMetadata`, `scanFeaturesMetadata` from Pipeline Core → escalate to parent
2. `check-dependency-hold.ts` (BRE-430) imports `getRepoRoot`, `readJsonFile`, `validateTicketIdArg` from Pipeline Core `utils.ts` + `registryPath` from `paths.ts` → escalate to parent
3. `orchestrator-utils.ts` shared helpers used by Coordination → move relevant helpers into Coordination Mind or escalate

**Acceptance criteria:**
- [ ] All coordination files separated from orchestrator directory (including `check-dependency-hold.ts` from BRE-430)
- [ ] `server.ts` with `handle()` supporting: "check coordination", "check dependency hold", "manage group", "resolve questions", "release held tickets"
- [ ] Pipeline Core imports replaced with parent escalation
- [ ] Execution Mind imports of coordination functions updated (temporary: direct import from `minds/coordination/` until Wave D)
- [ ] All coordination tests pass in new location
- [ ] Multi-repo integration test passes

**Dependencies:** L1-1, L1-2
**Risk:** Medium — `coordination-check.ts` is imported by `orchestrator-init.ts` (Execution). Need a temporary bridge until Execution becomes a Mind in Wave D.

---

### WC-2: Observability Mind

**Move from** `src/scripts/orchestrator/`:

| Source | Destination |
|--------|-------------|
| `record-gate.ts` + `.test.ts` | `minds/observability/record-gate.ts` |
| `create-draft-pr.ts` + `.test.ts` | `minds/observability/create-draft-pr.ts` |
| `complete-run.ts` + `.test.ts` | `minds/observability/complete-run.ts` |
| `classify-run.ts` + `.test.ts` | `minds/observability/classify-run.ts` |
| `metrics-dashboard.ts` + `.test.ts` | `minds/observability/metrics-dashboard.ts` |
| `gate-accuracy-check.ts` + `.test.ts` | `minds/observability/gate-accuracy-check.ts` |
| `src/statusline/collab-statusline.ts` | `minds/observability/statusline.ts` |

**Cross-Mind imports to decouple:**
1. All scripts import from `src/lib/pipeline/` (metrics, classify, draft-pr, gate-accuracy, autonomy-rate) → escalate to parent
2. `orchestrator-utils.ts` shared helpers → move relevant helpers into Observability Mind

**Acceptance criteria:**
- [ ] All observability files separated from orchestrator directory
- [ ] `server.ts` with `handle()` supporting: "record gate result", "create draft PR", "complete run", "classify run", "show dashboard", "check gate accuracy"
- [ ] Pipeline Core imports replaced with parent escalation
- [ ] Execution Mind imports of observability functions updated (temporary bridge)
- [ ] All observability tests pass
- [ ] Metrics dashboard still renders correctly

**Dependencies:** L1-1, L1-2
**Risk:** Medium — same pattern as Coordination. The metrics/analytics functions in Pipeline Core (`src/lib/pipeline/metrics.ts`, `autonomy-rate.ts`, etc.) are Observability's domain but currently live in Pipeline Core. Decision: move them to Observability Mind (they're Observability's responsibility) or leave in Pipeline Core and access via parent? **Decision: move them to Observability Mind.** They're analytics logic, not core pipeline state.

**Files also moving to Observability from Pipeline Core:**
| Source | Destination |
|--------|-------------|
| `src/lib/pipeline/metrics.ts` | `minds/observability/metrics.ts` |
| `src/lib/pipeline/autonomy-rate.ts` | `minds/observability/autonomy-rate.ts` |
| `src/lib/pipeline/classify-run.ts` | `minds/observability/classify-run-lib.ts` |
| `src/lib/pipeline/dashboard.ts` | `minds/observability/dashboard-lib.ts` |
| `src/lib/pipeline/draft-pr.ts` | `minds/observability/draft-pr-lib.ts` |
| `src/lib/pipeline/gate-accuracy.ts` | `minds/observability/gate-accuracy-lib.ts` |

This reduces Pipeline Core's surface area significantly before Wave D.

---

## Wave D: The Gravity Well

> **Before starting:** Load `MINDS-CONSTITUTION.md` into context. Verify Wave C gate passes.

**Goal:** The biggest refactor. Decompose Pipeline Core's god files, make Execution a Mind, replace 80+ cross-Mind imports.

**Estimated tickets:** 4

---

### WD-1: Decompose Pipeline Core's `utils.ts`

**Before moving Pipeline Core to a Mind**, decompose its god files into focused internal modules.

`src/lib/pipeline/utils.ts` (301 lines, post-BRE-431 — `getRegistryPath` already consolidated to `registryPath` in `paths.ts`) → split into:

| New Module | Functions Moved |
|-----------|----------------|
| `minds/pipeline_core/repo.ts` | `getRepoRoot()` |
| `minds/pipeline_core/json-io.ts` | `readJsonFile()`, `writeJsonAtomic()` |
| `minds/pipeline_core/pipeline.ts` | `loadPipelineForTicket()`, `resolvePipelineConfigPath()`, `parsePipelineArgs()` |
| `minds/pipeline_core/feature.ts` | `findFeatureDir()`, `readFeatureMetadata()`, `readMetadataJson()`, `scanFeaturesMetadata()`, `normalizeMetadata()` |
| `minds/pipeline_core/validation.ts` | `validateTicketIdArg()` |

Also decompose `orchestrator-utils.ts` — move Execution-specific helpers to Execution Mind.

**Pre-work already done (reduces scope):**
- BRE-431 consolidated `getRegistryPath` → `registryPath` across 30+ call sites (paths.ts is now the single source of truth)
- BRE-429 extracted `task-phases.ts` as a shared module (used by `verify-and-complete.ts` + `analyze-task-phases.ts`)
- BRE-428 extracted `resolve-path.ts` for deterministic path resolution
- BRE-430 extracted `dispatch-phase-hooks.ts`, `check-dependency-hold.ts`, `resolve-retry-config.ts` from inline markdown logic

**Acceptance criteria:**
- [ ] `utils.ts` deleted — no file named `utils` survives
- [ ] `orchestrator-utils.ts` deleted
- [ ] Each function in exactly one focused module
- [ ] All internal callers within Pipeline Core updated
- [ ] All external callers (other Minds) updated to use parent escalation (or temporary direct import from new location)
- [ ] `bun test` — all tests pass
- [ ] Grep for `from.*utils` returns zero Pipeline Core util results

**Dependencies:** WC-1, WC-2 (Coordination and Observability already extracted their pieces)
**Risk:** High — 301 lines, 30+ call sites across the codebase. Must be done carefully with full test coverage. Run `bun test` after every file move.

---

### WD-2: Create Pipeline Core Mind

**Move:** `src/lib/pipeline/` → `minds/pipeline_core/`

After WD-1 decomposition, the remaining files:

| Source | Destination |
|--------|-------------|
| `src/lib/pipeline/types.ts` | `minds/pipeline_core/types.ts` |
| `src/lib/pipeline/registry.ts` | `minds/pipeline_core/registry.ts` |
| `src/lib/pipeline/signal.ts` | `minds/pipeline_core/signal.ts` |
| `src/lib/pipeline/transitions.ts` | `minds/pipeline_core/transitions.ts` |
| `src/lib/pipeline/paths.ts` (BRE-428/431: `registryPath` consolidated, `getRegistryPath` eliminated across 30+ call sites) | `minds/pipeline_core/paths.ts` |
| `src/lib/pipeline/questions.ts` | `minds/pipeline_core/questions.ts` |
| `src/lib/pipeline/task-phases.ts` (BRE-429, shared phase parsing) | `minds/pipeline_core/task-phases.ts` |
| `src/lib/pipeline/errors.ts` | `minds/pipeline_core/errors.ts` |
| `src/lib/pipeline/tmux-client.ts` | `minds/pipeline_core/tmux-client.ts` |
| `src/lib/pipeline/status-emitter.ts` | `minds/pipeline_core/status-emitter.ts` |
| `src/lib/pipeline/repo-registry.ts` | `minds/pipeline_core/repo-registry.ts` |
| `src/lib/pipeline/index.ts` | `minds/pipeline_core/index.ts` |
| All decomposed modules from WD-1 | Already in `minds/pipeline_core/` |

**Create:** `minds/pipeline_core/server.ts`

**Acceptance criteria:**
- [ ] All Pipeline Core files in `minds/pipeline_core/`
- [ ] `server.ts` with `handle()` supporting: "load pipeline for ticket", "resolve signal name", "get registry path", "resolve transition", "find feature dir", "read feature metadata", etc.
- [ ] `describe()` accurately represents the domain
- [ ] No file outside `minds/pipeline_core/` imports from inside it (except temporary bridges for Execution until WD-3)
- [ ] All Pipeline Core tests pass
- [ ] `bun test` — all tests pass

**Dependencies:** WD-1
**Risk:** High — Pipeline Core has 8 inbound importers. All must be updated. Most will be parent escalations by this point (Signals, CLI, Coordination, Observability already decoupled in earlier waves).

**Remaining importers after earlier waves:**
- Execution (80+ imports) → addressed in WD-3
- Pipelang (runtime type imports) → acceptable per Rule 1

---

### WD-3: Create Execution Mind

**Move:** Remaining `src/scripts/orchestrator/` files → `minds/execution/`

After Coordination (WC-1) and Observability (WC-2) extracted their files, the remaining files are Execution's:

| Source | Destination |
|--------|-------------|
| `commands/orchestrator-init.ts` + `.test.ts` | `minds/execution/orchestrator-init.ts` |
| `commands/phase-dispatch.ts` + `.test.ts` | `minds/execution/phase-dispatch.ts` |
| `commands/phase-advance.ts` + `.test.ts` | `minds/execution/phase-advance.ts` |
| `commands/registry-read.ts` + `.test.ts` | `minds/execution/registry-read.ts` |
| `commands/registry-update.ts` + `.test.ts` | `minds/execution/registry-update.ts` |
| `commands/pipeline-config-read.ts` + `.test.ts` | `minds/execution/pipeline-config-read.ts` |
| `commands/status-table.ts` + `.test.ts` | `minds/execution/status-table.ts` |
| `commands/teardown-bus.ts` | `minds/execution/teardown-bus.ts` |
| `transition-resolve.ts` + `.test.ts` | `minds/execution/transition-resolve.ts` |
| `signal-validate.ts` + `.test.ts` | `minds/execution/signal-validate.ts` |
| `evaluate-gate.ts` + `.test.ts` | `minds/execution/evaluate-gate.ts` |
| `goal-gate-check.ts` + `.test.ts` | `minds/execution/goal-gate-check.ts` |
| `Tmux.ts` | `minds/execution/Tmux.ts` |
| `resolve-path.ts` + `.test.ts` (BRE-428) | `minds/execution/resolve-path.ts` |
| `dispatch-phase-hooks.ts` + `.test.ts` (BRE-430) | `minds/execution/dispatch-phase-hooks.ts` |
| `test-helpers.ts` | `minds/execution/test-helpers.ts` |

Also move top-level scripts under `src/scripts/` to their owning Minds:

| Source | Destination | Notes |
|--------|-------------|-------|
| `src/scripts/resolve-feature.ts` | `minds/execution/resolve-feature.ts` | |
| `src/scripts/resolve-execution-mode.ts` + test (BRE-429, 101 lines) | `minds/execution/resolve-execution-mode.ts` | Deterministic interactive/autonomous detection |
| `src/scripts/resolve-retry-config.ts` + test (BRE-430, 149 lines) | `minds/execution/resolve-retry-config.ts` | Phase-history retry counting |
| `src/scripts/analyze-task-phases.ts` (BRE-429, 75 lines) | `minds/execution/analyze-task-phases.ts` | Deterministic phase structure analysis |
| `src/scripts/verify-and-complete.ts` | `minds/execution/verify-and-complete.ts` | Uses `task-phases.ts` from Pipeline Core |
| `src/scripts/pre-deploy-summary.ts` | `minds/execution/pre-deploy-summary.ts` | |
| `src/scripts/deploy-verify-executor.ts` | `minds/execution/deploy-verify-executor.ts` | Phase executor |
| `src/scripts/run-tests-executor.ts` | `minds/execution/run-tests-executor.ts` | Phase executor |
| `src/scripts/verify-execute-executor.ts` | `minds/execution/verify-execute-executor.ts` | Phase executor |
| `src/scripts/visual-verify-executor.ts` | `minds/execution/visual-verify-executor.ts` | Phase executor |
| `src/scripts/webhook-notify.ts` | `minds/execution/webhook-notify.ts` | |
| `src/scripts/emit-findings.ts` | `minds/signals/emit-findings.ts` | Belongs to Signals Mind |

**The 80+ Pipeline Core imports — decoupling strategy:**

These imports fall into categories:
1. **Type imports** (20+): `CompiledPipeline`, `CompiledPhase`, etc. → Keep as runtime imports (Rule 1)
2. **Pure function calls** (40+): `loadPipelineForTicket()`, `registryPath()`, `resolveSignalName()`, etc. → Replace with parent escalation: `handle({ request: "load pipeline for ticket", context: { ticketId } })`
3. **State mutations** (20+): `applyUpdates()`, `appendPhaseHistory()`, `advanceImplPhase()` → Replace with parent escalation: `handle({ request: "update registry", context: { ticketId, updates } })`

**Note on BRE-430 internal imports:** `dispatch-phase-hooks.ts` is now imported by `phase-dispatch.ts` (DRY extraction). Both files move together to Execution Mind — this is an internal import within the same Mind and stays as-is. Similarly, `check-dependency-hold.ts` uses `loadPipelineForTicket` from Pipeline Core — that cross-Mind import becomes a parent escalation.

**Acceptance criteria:**
- [ ] All Execution files moved (including BRE-427 `evaluate-gate.ts`, BRE-428 `resolve-path.ts`, BRE-429 `resolve-execution-mode.ts` + `analyze-task-phases.ts`, BRE-430 `dispatch-phase-hooks.ts` + `resolve-retry-config.ts`, and all `*-executor.ts` phase executors)
- [ ] `src/scripts/orchestrator/` directory is empty and deleted
- [ ] `src/scripts/` top-level scripts fully distributed to owning Minds (no orphans)
- [ ] `server.ts` with `handle()` supporting: "dispatch phase", "evaluate gate", "validate signal", "advance phase", "init orchestrator", "resolve execution mode", "resolve retry config", "analyze task phases"
- [ ] 80+ Pipeline Core imports replaced: types stay as runtime imports, function calls become parent escalation
- [ ] Coordination imports replaced with parent escalation
- [ ] Transport imports replaced with parent escalation
- [ ] `collab.run.md` updated with new file paths
- [ ] All Execution tests pass
- [ ] E2E pipeline run works end-to-end
- [ ] `bun test` — all tests pass

**Dependencies:** WD-2 (Pipeline Core is a Mind), WC-1 (Coordination extracted), WC-2 (Observability extracted)
**Risk:** **HIGH** — This is the single largest refactor. 80+ import replacements across ~20 files. Must be done incrementally:
1. Move files first (update relative imports only)
2. Replace Pipeline Core function calls with parent escalation one file at a time
3. Run tests after every file
4. Keep a "bridge" module that wraps Pipeline Core functions as `handle()` calls during transition

---

### WD-4: Verify No Cross-Mind Direct Imports

**Validation ticket.** After Wave D, verify the architectural invariant holds.

**Script:** Write a lint script (`minds/lint-boundaries.ts`) that:
1. Scans every `.ts` file in each `minds/{name}/` directory
2. Checks all import statements
3. Flags any import that crosses a Mind boundary (imports from another `minds/{other}/` directory)
4. Allows: imports within the same Mind, imports from `minds/mind.ts` (shared interface), runtime type imports marked with `// CROSS-MIND: runtime import only`
5. Fails CI if violations found

**Acceptance criteria:**
- [ ] `minds/lint-boundaries.ts` exists and runs via `bun minds/lint-boundaries.ts`
- [ ] Zero violations detected across all Minds
- [ ] Script can be added to CI/pre-commit
- [ ] Documents the allowed exceptions (runtime type imports)

**Dependencies:** WD-3
**Risk:** Low — pure validation

---

## Wave E: Router Mind (Root Node)

> **Before starting:** Load `MINDS-CONSTITUTION.md` into context. Verify Wave D gate passes.

**Goal:** The final piece. Wire up the Router Mind as the root node (node 0), registered as `mcp__collab` with Claude Code.

**Estimated tickets:** 2

---

### WE-1: Create Router Mind

**Create:** `minds/router/server.ts`

The Router Mind is a Mind whose domain expertise is knowing which Mind owns what. It:

1. Starts as the root node (no parent)
2. Discovers all child Minds via `minds/*/server.ts`
3. Builds hybrid search index from child descriptions
4. Routes incoming work units to the correct child
5. Is registered as `mcp__collab` in Claude Code's MCP config

**Acceptance criteria:**
- [ ] `minds/router/server.ts` exists
- [ ] Router discovers and starts all 13 child Minds on startup
- [ ] Hybrid search routes work units correctly (test with 10+ diverse queries)
- [ ] `describe()` returns routing domain description
- [ ] Claude Code can register `mcp__collab` pointing to Router Mind
- [ ] Startup time < 5s (all children started and indexed)
- [ ] Graceful shutdown terminates all children
- [ ] If a child fails to start, Router continues with remaining children + logs warning

**Dependencies:** WD-4 (all Minds exist and are boundary-clean)
**Risk:** Medium — first time all 13+ Minds run simultaneously. Port management, startup ordering, and resource usage need testing.

---

### WE-2: Claude Code Integration & E2E Validation

**Final integration ticket.** Make the Router Mind the entry point for Claude Code.

**Tasks:**
1. Update `.claude/settings.json` (or equivalent) to register `mcp__collab` → Router Mind
2. Remove old direct imports from any remaining non-Mind code
3. Run full E2E test suite with Router Mind as the entry point
4. Verify all `collab.run` pipeline flows work through the Mind architecture
5. Performance benchmark: measure latency overhead of Mind routing vs direct imports

**Acceptance criteria:**
- [ ] Claude Code uses Router Mind as `mcp__collab`
- [ ] Full pipeline E2E: specify → plan → tasks → implement → blindqa → complete
- [ ] No regressions in pipeline behavior
- [ ] Routing latency < 50ms per hop (acceptable overhead)
- [ ] `bun test` — all 2438 tests pass (current baseline as of dev merge)
- [ ] Old `src/` directories cleaned up (no orphaned files)

**Dependencies:** WE-1
**Risk:** Medium — E2E validation across the full pipeline. If routing latency is too high, may need to cache routing decisions or optimize the hybrid search.

---

## Summary: Ticket Count & Ordering

| Phase | Tickets | Parallel? | Cumulative |
|-------|---------|-----------|------------|
| **Layer 1** — Protocol Infrastructure | 5 | L1-1..L1-3 parallel, L1-4 after L1-1+L1-2, L1-5 after all | 5 |
| **Layer 2** — SpecAPI + SpecEngine | 4 | Sequential | 9 |
| **Wave A** — Already-isolated | 4 | All parallel | 13 |
| **Wave B** — Sibling routing | 3 | WB-1 and WB-2 parallel, WB-3 after both | 16 |
| **Wave C** — Orchestrator untangle | 2 | Parallel | 18 |
| **Wave D** — Gravity well | 4 | Sequential (WD-1 → WD-2 → WD-3 → WD-4) | 22 |
| **Wave E** — Router Mind | 2 | Sequential | **24 tickets total** |

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| MCP SDK complexity | Medium | Use `@modelcontextprotocol/sdk`, fallback to custom lightweight impl |
| Vector embedding model download | Medium | BM25-only fallback, add vectors as follow-up |
| Pipeline Core 80+ import decoupling | **High** | Incremental replacement, bridge module during transition. BRE-427–431 DRY work reduces risk — many utilities now have clean single-function CLIs that are easier to wrap. |
| Port conflicts during multi-Mind startup | Medium | Dynamic port allocation, `MIND_READY` protocol |
| Routing latency overhead | Medium | Cache routing decisions, benchmark early in Layer 2 |
| Temporary bridges during migration | Medium | Each wave reduces bridges; WD-4 lint ensures none remain |
| Test failures from file moves | Medium | Run `bun test` after every file move, never batch moves |

---

## Testing Strategy

> **Load `MINDS-CONSTITUTION.md` for boundary rules before writing or modifying any test.**

Five test layers, progressively broader scope. Every layer must pass before moving to the next wave.

### Layer T1: Unit Tests (per Mind, per ticket)

Standard unit tests for each Mind's internal logic. These already exist for most code — they move with the files.

**What's tested:** Internal functions work correctly in isolation.
**Who runs:** Developer, after every file move.
**Tool:** `bun test` (Bun's built-in runner).

Every ticket's acceptance criteria includes "existing tests pass in new location." This is the baseline — it proves the file move didn't break internal logic.

### Layer T2: Protocol Tests (per Mind)

New tests created during Layer 1 and extended for each Mind as it's built. Test the Mind's `handle()` and `describe()` interface, NOT its internals.

**What's tested:**
- `describe()` returns accurate domain/keywords/capabilities
- `handle()` routes known work units to correct internal functions
- `handle()` returns `{ status: "escalate" }` for out-of-domain requests
- `handle()` returns correct data shape for each supported request type
- Error handling: malformed work units, missing context, internal failures

**Template (every Mind gets this):**

```typescript
// minds/{name}/protocol.test.ts

test("describe() is accurate", () => {
  const desc = mind.describe();
  expect(desc.name).toBe("{name}");
  expect(desc.domain).toContain("{key domain term}");
  expect(desc.keywords).toContain("{critical keyword}");
});

test("handle() routes in-domain request", async () => {
  const result = await mind.handle({ request: "..." });
  expect(result.status).toBe("handled");
  expect(result.data).toBeDefined();
});

test("handle() escalates out-of-domain request", async () => {
  const result = await mind.handle({ request: "something outside my domain" });
  expect(result.status).toBe("escalate");
});
```

### Layer T3: Equivalence Tests (per decoupled import)

**This is the critical new test type.** When a direct import is replaced with a parent escalation, we must prove the escalation returns the same data.

**What's tested:** `handle({ request: "load pipeline for ticket", context: { ticketId: "BRE-428" } })` returns the same result as calling `loadPipelineForTicket("BRE-428")` directly.

**Why this matters:** The single biggest risk in Wave D is behavioral drift — the `handle()` path returning different data, different error behavior, or different side effects than the direct import it replaced. Without equivalence tests, we're trusting that natural language routing + serialization produces identical results. We shouldn't trust that.

**Pattern:**

```typescript
// minds/{name}/equivalence.test.ts

test("handle('load pipeline') === loadPipelineForTicket()", async () => {
  // Direct call (the old way)
  const direct = await loadPipelineForTicket(repoRoot, "BRE-TEST");

  // handle() call (the new way)
  const result = await pipelineCoreMind.handle({
    request: "load pipeline for ticket",
    context: { ticketId: "BRE-TEST" },
  });

  expect(result.status).toBe("handled");
  expect(result.data).toEqual(direct);
});
```

**When created:** At the moment an import is replaced with escalation. Not before, not after. The equivalence test is the proof that the replacement is safe.

**Scope:** One equivalence test per decoupled function. For Wave D's 80+ Pipeline Core imports, this means ~30 equivalence tests (many imports share the same function, e.g., 15 files import `loadPipelineForTicket` but only 1 equivalence test needed).

### Layer T4: Integration & E2E Tests

End-to-end validation that the full system works through the Mind architecture.

**What's tested:**
- Multi-Mind routing: work unit flows through Router → correct Mind → result returns
- Cross-Mind escalation: Signals Mind needs pipeline data → escalates → Pipeline Core handles → data returns
- Full pipeline E2E: `collab.run` specify → plan → tasks → implement → blindqa → complete
- Performance: routing latency < 50ms per hop

**When run:**
- After each wave completes (gate criterion)
- After Wave E (full system validation)

### Layer T5: Existing E2E Test Suite (Critical — Import Breakage Risk)

**We already have a substantial E2E test suite.** 22 E2E test files (4,464 lines) + 5 integration test files + 3 group test files = ~9,254 lines of integration/E2E tests. These are NOT throwaway — they validate real pipeline behavior and will surface bugs that unit tests miss.

**Current E2E test inventory:**

| Category | Tests | Lines | What They Validate |
|----------|-------|-------|-------------------|
| **Pipeline walks** | `pipeline-walk`, `backend-variant-walk`, `deploy-variant-walk`, `frontend-ui-variant-walk`, `verification-variant-walk` | 1,333 | Full phase-by-phase transition through every pipeline variant |
| **Signal routing** | `signal-validate`, `variant-routing`, `deploy-verify-routing`, `pre-deploy-confirm-routing`, `run-tests-routing`, `verify-execute-routing`, `visual-verify-routing` | 1,021 | Signal → transition → next phase routing correctness |
| **Orchestrator** | `phase-dispatch`, `goal-gate` | 248 | Phase dispatch, goal gate checks |
| **CLI lifecycle** | `cli`, `full-lifecycle`, `checksum-failure`, `lockfile-repro` | 1,266 | Install, update, remove, integrity, lockfile |
| **Schema** | `schema-compat` | 167 | Pipeline JSON schema backward compatibility |
| **Cross-ticket** | `resolve-tickets` | 129 | Multi-ticket resolution |
| **Group tests** | `group1-integration`, `group2-static`, `group3-smoke` | 3,302 | Integration, static analysis, smoke tests |
| **Integration** | `install`, `pack-install`, `pipelines-command`, `remove`, `update` | 1,155 | CLI command integration tests |
| **Orchestrator integration** | `implement-phases.integration`, `multi-repo.integration` | 633 | Phase implementation, multi-repo coordination |

**The import breakage problem:**

These E2E tests import directly from source paths that WILL move:

```
tests/e2e/*.test.ts imports from:
  ../../src/lib/pipeline/transitions     → moves to minds/pipeline_core/
  ../../src/lib/pipeline/signal          → moves to minds/pipeline_core/
  ../../src/lib/pipeline/types           → moves to minds/pipeline_core/
  ../../src/lib/pipeline/registry        → moves to minds/pipeline_core/
  ../../src/scripts/orchestrator/commands/phase-dispatch    → moves to minds/execution/
  ../../src/scripts/orchestrator/commands/orchestrator-init → moves to minds/execution/
  ../../src/scripts/orchestrator/signal-validate            → moves to minds/execution/
  ../../src/scripts/orchestrator/goal-gate-check            → moves to minds/execution/
  ../../src/cli/commands/pipelines/install  → moves to minds/installer/
  ../../src/cli/lib/integrity              → moves to minds/cli/
  ../../src/cli/lib/lockfile               → moves to minds/cli/
  ../../src/cli/lib/state                  → moves to minds/cli/
```

**Every file move will break E2E tests.** This is the mechanism that surfaces bugs — if we move a file and the E2E test breaks, it's either a broken import path (easy fix) or a broken behavioral contract (real bug).

**E2E test update strategy:**

1. **E2E tests do NOT move into Minds.** They stay in `tests/e2e/` — they test cross-Mind behavior from the outside. Moving them into a Mind would violate the principle that E2E tests validate integration, not internal logic.

2. **Import paths update with each wave.** When Pipeline Core moves in Wave D, ALL E2E imports from `src/lib/pipeline/` update to `minds/pipeline_core/`. This is mechanical but must be done.

3. **E2E tests are the canary.** After every wave, run the full E2E suite. A broken E2E test that isn't just an import path issue means the migration changed behavior. Stop and fix before proceeding.

4. **New Mind-level E2E tests.** After Wave E, add E2E tests that exercise the full Mind protocol path: Claude Code → Router Mind → child Mind → result. These test that the MCP layer doesn't change behavior.

**Per-wave E2E test impact:**

| Wave | E2E Tests Affected | Import Changes Needed |
|------|-------------------|----------------------|
| Layer 1 | None | None (no app code moves) |
| Layer 2 | None | SpecAPI/SpecEngine have no E2E tests |
| Wave A | `cli.test.ts`, `full-lifecycle.test.ts` helpers import `compileCollab` which reads pipelang | Update `helpers.ts` path to `minds/pipelang/` |
| Wave B | `signal-validate.test.ts` | Update signal import paths |
| Wave C | None directly | Coordination/Observability have no dedicated E2E tests |
| **Wave D** | **16+ E2E test files** | **Every `src/lib/pipeline/` and `src/scripts/orchestrator/` import** — this is the wave with maximum E2E breakage |
| Wave E | All (must pass through Router) | Add new Mind-protocol E2E tests |

**Wave D is the E2E gauntlet.** Plan for it: allocate a dedicated ticket (WD-3.5) specifically for updating all E2E test imports after Pipeline Core and Execution move. Run the full suite, fix every failure, verify every pipeline walk still produces the same transitions.

---

## Verification Protocol: Wave Gates

No wave starts until the previous wave passes its gate. Gates are not aspirational — they're blocking.

### Gate Structure

Every wave gate has three checks:

| Check | What | How | Blocks On |
|-------|------|-----|-----------|
| **Green** | All tests pass | `bun test` | Any failure |
| **Clean** | No boundary violations | `bun minds/lint-boundaries.ts` | Any cross-Mind import |
| **Equivalent** | Replaced imports produce same results | Equivalence tests | Any drift |

### Per-Wave Gate Criteria

**Layer 1 Gate (→ Layer 2):**
- [ ] `bun test` passes
- [ ] Protocol integration tests pass (L1-5: 7 scenarios)
- [ ] Mock Mind delegation, escalation, deep escalation all work
- [ ] No application code has moved yet

**Layer 2 Gate (→ Wave A):**
- [ ] `bun test` passes
- [ ] SpecAPI → SpecEngine delegation works via `handle()`
- [ ] HTTP API returns identical responses to pre-migration
- [ ] SpecEngine equivalence tests pass (service function results === handle() results)
- [ ] No file outside `minds/spec_api/` imports from inside it

**Wave A Gate (→ Wave B):**
- [ ] `bun test` passes
- [ ] `bun minds/lint-boundaries.ts` — zero violations for Templates, Integrations, Transport, Pipelang
- [ ] Each Mind's `describe()` test passes
- [ ] Each Mind's `handle()` routes at least 3 known work units correctly
- [ ] Transport Mind correctly absorbed `resolve-transport.ts`

**Wave B Gate (→ Wave C):**
- [ ] `bun test` passes
- [ ] Boundary lint clean for Signals, CLI, Installer
- [ ] **Signals escalation test:** Signals Mind requests pipeline data through parent → gets correct result (first real cross-Mind routing)
- [ ] **CLI escalation test:** CLI Mind requests repo path through parent → gets correct result
- [ ] Installer reads templates through parent (not directly)
- [ ] Signal emission E2E still works (emit a signal → orchestrator receives it)
- [ ] `collab install` still works end-to-end

**Wave C Gate (→ Wave D):**
- [ ] `bun test` passes
- [ ] Boundary lint clean for Coordination, Observability
- [ ] Coordination's `check-dependency-hold.ts` escalates Pipeline Core reads through parent
- [ ] Observability owns its analytics files (moved from Pipeline Core)
- [ ] `src/scripts/orchestrator/` has ONLY Execution files remaining
- [ ] Multi-repo integration test passes

**Wave D Gate (→ Wave E):**
- [ ] `bun test` passes
- [ ] Boundary lint: ZERO violations across ALL Minds
- [ ] `utils.ts` deleted, `orchestrator-utils.ts` deleted
- [ ] **Equivalence tests pass for all 30+ decoupled Pipeline Core functions**
- [ ] `src/scripts/orchestrator/` directory deleted (empty)
- [ ] `src/scripts/` has no orphaned files
- [ ] E2E pipeline run: specify → plan → tasks → implement → blindqa → complete
- [ ] No file outside any Mind imports from inside another Mind

**Wave E Gate (Final):**
- [ ] `bun test` passes (all 2438+ tests)
- [ ] Router Mind discovers and starts all 13 child Minds
- [ ] Hybrid search correctly routes 10+ diverse test queries
- [ ] Full pipeline E2E works through Router Mind
- [ ] Claude Code registers `mcp__collab` pointing to Router Mind
- [ ] Routing latency < 50ms per hop
- [ ] `src/` directories cleaned up — no orphaned files
- [ ] Performance benchmark documented

---

## Branching & Rollback Strategy

**Feature branch:** `minds/main` (created from `dev` at commit `7fa87db`)

All Minds migration work targets this long-lived feature branch. `dev` is frozen for Minds work until the entire migration is complete and validated.

```
dev @ 7fa87db (frozen)
  └── minds/main (feature branch — all waves merge here)
        ├── minds/layer-1   → worktree drone → merge to minds/main
        ├── minds/layer-2   → worktree drone → merge to minds/main
        ├── minds/wave-a    → worktree drone → merge to minds/main
        ├── minds/wave-b    → worktree drone → merge to minds/main
        ├── minds/wave-c    → worktree drone → merge to minds/main
        ├── minds/wave-d    → worktree drone → merge to minds/main
        └── minds/wave-e    → worktree drone → merge to minds/main (final)
```

**Branch naming:** `minds/layer-1`, `minds/layer-2`, `minds/wave-a`, etc.

**Rollback:**

1. **Within a wave:** Fix forward. The gate criteria tell you exactly what's broken.
2. **Wave regression breaks earlier wave:** Do NOT proceed. Fix the regression on the wave branch before merging to `minds/main`.
3. **Catastrophic failure:** `git revert` the wave's merge commit on `minds/main`. Each wave merges as a single squash commit, so revert is clean.
4. **Final merge to dev:** Only after Wave E gate passes AND full E2E validation. One merge of `minds/main` → `dev`.

---

## Execution Model: Drone Workflow

Each phase is executed by a **drone** spun up via `/dev.pane` which creates a **worktree** on a wave branch. The orchestrating Mind (🧠) reviews the drone's (🛸) work, sends feedback, and iterates until satisfied. Two clean passes required before merge.

### Per-Phase Execution Flow

```
For each phase (Layer 1, Layer 2, Wave A, ...):

  1. 🧠 Mind checks out minds/main, creates wave branch:
     git checkout minds/main
     git checkout -b minds/layer-1  (or minds/wave-a, etc.)

  2. 🧠 Mind runs /dev.pane --branch minds/layer-1 --base minds/main
     → Creates worktree on wave branch
     → Spins up 🛸 drone (Sonnet) in the worktree pane

  3. 🧠 Mind sends the 🛸 drone its instructions:
     - Load MINDS-CONSTITUTION.md
     - Implement tickets for this phase sequentially
     - Run bun test after every change
     - Commit work on the wave branch

  4. 🛸 Drone works through tickets in the worktree

  For each ticket:
    a. 🛸 Drone implements the ticket
    b. 🛸 Drone runs `bun test` — ALL tests must pass
    c. 🛸 Drone commits work on wave branch

  5. 🧠 Mind reviews 🛸 drone's changes (Pass 1)
     - DRY check: no code duplication within or across Minds
     - SRP check: every function has one responsibility, one owner
     - Constitution compliance: boundary rules, naming, interface contract
     - Test coverage: unit + protocol + equivalence tests present
     - All tests pass (bun test)

  6. 🧠 Mind sends feedback → 🛸 drone fixes → 🛸 drone commits
     (repeat until 🧠 gives thumbs up)

  7. 🧠 Mind reviews again (Pass 2)
     - Same checks as Pass 1
     - Verify all feedback was addressed
     - Run full E2E suite for affected areas
     - All tests pass (bun test)

  8. Only after 2 clean passes from 🧠:
     a. 🛸 Drone pushes wave branch
     b. 🧠 Mind merges wave branch → minds/main:
        git checkout minds/main
        git merge --squash minds/layer-1
        git commit
     c. 🧠 Mind removes the worktree:
        git worktree remove <worktree-path>
     d. 🧠 Mind verifies minds/main is green:
        bun test
```

### Review Checklist (Both Passes)

| Check | What to Look For |
|-------|-----------------|
| **DRY** | No duplicated logic within a Mind. No function that does the same thing as another function in the same Mind. No copy-paste between files. |
| **SRP** | Every function does one thing. Every file has one responsibility. No god functions, no mixed concerns. |
| **Constitution** | Rule 1 (no cross-Mind imports), Rule 2 (work units not typed tools), Rule 3 (no utils/helpers/shared), Rule 4 (atomic commits) |
| **Naming** | No files named `utils.ts`, `helpers.ts`, `shared.ts`. Internal modules named by responsibility. |
| **Tests** | Protocol tests (`handle()`, `describe()`, escalation) exist for each Mind. Equivalence tests exist for each decoupled import. All tests pass. |
| **E2E** | Affected E2E tests updated with new import paths. E2E tests pass. No behavioral drift. |
| **Boundary lint** | `bun minds/lint-boundaries.ts` passes (after WD-4 creates it) |

### Zero-Tolerance Rule

**All tests must pass. No exceptions. No "pre-existing failure" excuse.**

Code is treated as production code at all times. If a test fails — whether from the current change or discovered during migration — it gets fixed before the drone's work is reviewed. If the drone claims a failure is pre-existing, that is not an acceptable excuse. The standard is: everything passes, everything works, zero tolerance.

This applies to:
- Unit tests (`bun test`)
- E2E tests (`tests/e2e/`)
- Integration tests (`tests/integration/`)
- Protocol tests (new, per Mind)
- Equivalence tests (new, per decoupled import)
- Smoke tests (new, per Mind)

---

## Smoke Test Suite (Per Mind)

Every Mind gets a `smoke.test.ts` that validates core operations through the MCP interface (not direct function calls). This is the minimum viable "does this Mind work?" check.

```typescript
// minds/{name}/smoke.test.ts — template

import { createTestMind } from "../test-utils";

const mind = await createTestMind("{name}");

test("Mind starts and responds to describe()", () => {
  const desc = mind.describe();
  expect(desc.name).toBe("{name}");
  expect(desc.capabilities.length).toBeGreaterThan(0);
});

test("Mind handles primary operation", async () => {
  const result = await mind.handle({
    request: "{primary operation for this Mind}",
    context: { /* minimal required context */ },
  });
  expect(result.status).toBe("handled");
});

test("Mind escalates unknown request", async () => {
  const result = await mind.handle({
    request: "do something completely outside my domain",
  });
  expect(result.status).toBe("escalate");
});
```

**Created:** When the Mind is built (not after).
**Run:** As part of `bun test`, and as part of every wave gate.

---

## Invariants (Must Hold After Every Commit)

1. `bun test` passes — all tests, zero tolerance
2. No new cross-Mind direct imports introduced
3. Each Mind's `describe()` accurately represents its domain
4. Every function has exactly one owner (no duplicates across Minds)
5. No files named `utils.ts`, `helpers.ts`, or `shared.ts` created
6. Existing pipeline E2E behavior unchanged
7. Wave gate criteria for all completed waves still pass
