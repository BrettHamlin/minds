# Minds Architecture — Constitution

Quick-load reference. Non-negotiable rules, boundaries, and requirements for the Minds migration. Load this into context before ANY Minds-related work.

Source of truth: `DOMAIN-DECOMPOSITION.md`. This is the extract.

---

## Technology Stack

| What | Required | Forbidden |
|------|----------|-----------|
| Language | TypeScript (strict mode) | Go, Python, shell scripts for new features |
| Runtime | Bun | Node.js for new code |
| Transport | Streamable HTTP (MCP) | stdio, SSE-only |
| MCP SDK | `@modelcontextprotocol/sdk` | Custom protocol implementations (unless SDK fails) |
| Routing | BM25 + vector hybrid search | Hardcoded routing tables |
| Testing | `bun test` (Bun's built-in test runner) | Jest, Vitest, Mocha |

---

## The Four Architectural Rules (Absolute)

### RULE 1: MCP Is the Only Cross-Boundary Interface

A Mind NEVER imports, reads, greps, or directly accesses another Mind's files, functions, or internal state. The ONLY way to get cross-domain data or request cross-domain work is escalating to the parent Mind.

- **Dev-time:** all cross-Mind communication via MCP `handle()` calls
- **Runtime:** compiled code may import across domains (types, shared interfaces)
- No shortcuts. No "just this once."

### RULE 2: Work Units, Not Typed Tool Calls

A Mind receives work via `handle(work_unit)` with a natural language request string. The Mind has full judgment about HOW to fulfill it. No per-Mind tool catalogs. Internal functions are invisible outside the Mind.

### RULE 3: No Shared Utilities

There are no `utils.ts`, `helpers.ts`, or `shared.ts` files. Every function belongs to exactly one Mind. If a function exists, a Mind owns it. If no Mind owns it, it doesn't exist.

### RULE 4: One Atomic Commit Per Feature

All Minds' changes for a single feature go in one commit. No intermediate state where one Mind's changes land without the others.

---

## Mind Interface Contract

Every Mind exposes exactly two tools:

```typescript
interface Mind {
  handle(workUnit: WorkUnit): Promise<WorkResult>;
  describe(): MindDescription;
}
```

- `handle()` — "Do this work" or "Answer this question"
- `describe()` — "What do you own?" (domain, keywords, capabilities)

No other external interface. Everything else is internal.

---

## Mind Responsibilities (Non-Overlapping)

| Mind | Owns | Does NOT Own |
|------|------|-------------|
| **Router** | Discovery, hybrid search index, routing work units | Any domain logic |
| **Pipelang** | DSL lexer, parser, compiler, validator, LSP | Pipeline state, registry, execution |
| **Pipeline Core** | Types, registry CRUD, signal definitions, transitions, paths, repo-registry | Phase dispatch, gate evaluation, metrics |
| **Execution** | Phase dispatch, gate eval, signal validation, orchestrator init, phase executors, hooks, retry config, execution mode | Multi-ticket coordination, metrics, signal emission |
| **Coordination** | Dependency holds, group management, batch Q&A, held-release scan, ticket resolution | Single-pipeline execution, metrics |
| **Observability** | Metrics, run classification, draft PR, gate accuracy, autonomy rate, dashboard, statusline | Registry writes, phase dispatch |
| **Signals** | Signal emission handlers, transport dispatch, token resolution, emit-findings | Pipeline config, registry state |
| **Transport** | Transport interface, TmuxTransport, BusTransport, bus server, status aggregation, resolve-transport | Signal names, pipeline phases |
| **CLI** | `collab` binary, arg parsing, package registry, repo management, semver | File installation, template content |
| **Installer** | File mapping, distribution logic, install hooks, upgrade paths | Template content, CLI arg parsing |
| **Templates** | All distributable config/scripts/schemas/gate prompts (pure data) | Logic of any kind |
| **SpecEngine** | Spec generation, LLM calls, sessions, Q&A, database | HTTP endpoints, Slack |
| **SpecAPI** | HTTP REST endpoints, middleware, request validation | Business logic, database |
| **Integrations** | Slack adapter (+ future Discord, Teams) | Spec generation, HTTP server |

---

## Communication Protocol

### Resolution Order (Every Mind, Every Request)

1. **Do I own this?** Handle internally.
2. **Does a child own this?** Route down via hybrid search.
3. **Neither?** Escalate up to parent.

### Direction

- **Down = Delegation.** Parent sends work unit to matched child.
- **Up = Escalation.** Mind returns `{ status: "escalate" }` to parent.

### What a Mind Knows

A Mind knows exactly three things:
1. Its own domain
2. Its children (via `describe()`)
3. Its parent (whoever started it)

A Mind does NOT know:
- Its siblings
- The tree structure
- Which Mind fulfills an escalated request

---

## Mind Creation Pattern

Every Mind's `server.ts` calls `createMind()` from `server-base.ts`:

```typescript
import { createMind } from "../server-base";

export default createMind({
  name: "signals",
  domain: "Agent-to-orchestrator signal emission and transport dispatch",
  keywords: ["signal", "emit", "phase", "event", "queue"],
  owns_files: ["minds/signals/"],
  capabilities: ["emit signals", "resolve signal names", "persist to queue"],
  async handle(workUnit) {
    // Mind-specific logic only
  },
});
```

Protocol machinery (MCP server, transport, parent registration, child discovery, escalation) lives in `server-base.ts` ONCE.

---

## Discovery Convention

- Adding a Mind: create `minds/{name}/server.ts`
- Removing a Mind: delete the directory
- No config files. No registration. Convention over configuration.
- Parent scans `minds/*/server.ts` relative to its own directory.

---

## Code Quality Principles

### DRY — Don't Repeat Yourself

- **One implementation per concept.** If logic exists, it exists in exactly one place.
- No copy-paste between files within a Mind. Extract a shared internal function.
- No copy-paste between Minds. If two Minds need the same logic, it belongs to one Mind — the other requests it through the parent.
- If you find duplicate logic during migration, consolidate it BEFORE moving it. Don't move the duplication into the new structure.
- Constants, type definitions, validation rules — all single source of truth.

### SRP — Single Responsibility Principle

- **Every function does one thing.** If a function name has "and" in it, split it.
- **Every file has one responsibility.** A file named by its responsibility (`registry.ts`, `signal.ts`, `transitions.ts`) not by grab-bag category (`utils.ts`, `helpers.ts`, `misc.ts`).
- **Every Mind has one domain.** If a Mind's `describe()` needs "and" to explain its domain, it may need splitting into parent + children.
- No god functions (>50 lines doing multiple things). No god files (>300 lines mixing concerns).
- When a function grows responsibilities, split it — don't add parameters to control behavior.

### How These Apply During Migration

| Situation | Wrong | Right |
|-----------|-------|-------|
| Two files have similar validation logic | Move both as-is | Consolidate into one function, move once |
| A function loads config AND processes it | Move as-is | Split into `loadConfig()` and `processConfig()`, move |
| `utils.ts` has 15 functions | Rename to `pipeline-utils.ts` | Split into `repo.ts`, `json-io.ts`, `pipeline.ts`, `feature.ts` by responsibility |
| Mind needs logic from another Mind | Copy the function | Escalate to parent via `handle()` |
| Test helper is used by 3 test files in the same Mind | Duplicate in each | Extract to `test-helpers.ts` within that Mind |

---

## File Ownership Rules

1. Every `.ts` file lives inside exactly one Mind's directory
2. No file exists outside `minds/` (except protocol infrastructure at `minds/` root)
3. Internal modules are named by responsibility (`repo.ts`, `pipeline.ts`, `feature.ts`), never `utils.ts` or `helpers.ts`
4. Tests live alongside source in the same Mind directory
5. A Mind with children has a `minds/` subdirectory (same convention recursively)

---

## Boundary Enforcement

| Check | Tool | When |
|-------|------|------|
| No cross-Mind imports | `minds/lint-boundaries.ts` | CI, pre-commit, after every wave |
| `handle()` parity | Equivalence tests | When replacing a direct import with escalation |
| `describe()` accuracy | Protocol tests | When creating or modifying a Mind |
| Test baseline | `bun test` | After every file move, every commit |

---

## What Agents Working in a Mind Can Access

```
Agent assigned to Signals Mind:
  CAN:    Read/write files in minds/signals/
  CAN:    Send requests to parent Mind via handle()
  CANNOT: Read files in minds/pipeline_core/
  CANNOT: Import from minds/execution/
  CANNOT: Know which other Minds exist
  CANNOT: Grep across minds/ directories
```

---

## Migration Sequence (Strict Order)

```
Layer 1: Protocol infrastructure (no app code moves)
Layer 2: SpecAPI + SpecEngine (proof of concept)
Wave A:  Templates, Integrations, Transport, Pipelang (already isolated)
Wave B:  Signals, CLI, Installer (first cross-Mind routing)
Wave C:  Coordination, Observability (orchestrator untangle)
Wave D:  Pipeline Core, Execution (gravity well)
Wave E:  Router Mind (root node)
```

No wave starts until the previous wave's gate criteria pass.

---

## Branching Model

**Feature branch:** `minds/main` (created from `dev` at `7fa87db`)

`dev` is frozen for Minds work. All waves merge to `minds/main`. Only after full migration is `minds/main` merged to `dev`.

```
dev @ 7fa87db (frozen)
  └── minds/main (feature branch)
        └── minds/wave-x (drone worktree branch) → merge --squash → minds/main
```

Drones work in worktrees on wave branches. After 2 clean review passes, wave branch is squash-merged into `minds/main` and the worktree is removed.

---

## Execution Model

Each phase is executed by a **drone** (subagent in a worktree). The orchestrating Mind reviews drone output.

- Drone loads this Constitution before starting any work
- Drone implements tickets, runs `bun test` after every change
- Orchestrator does **2 review passes** before merging to `minds/main`
- Reviews check: DRY, SRP, Constitution compliance, test coverage, E2E pass
- No code duplication within a Mind. No shared utils. No god functions.

---

## Zero-Tolerance Testing Rule

**ALL tests must pass. No exceptions. "Pre-existing failure" is NEVER acceptable.**

This is production code. If a test fails — from current work or discovered during migration — fix it. Period. Applies to unit, E2E, integration, protocol, equivalence, and smoke tests.

---

## Non-Negotiable Invariants

These must hold after EVERY commit during migration:

1. `bun test` passes — all tests, zero tolerance
2. No new cross-Mind direct imports introduced
3. Each Mind's `describe()` accurately represents its domain
4. Every function has exactly one owner
5. No files named `utils.ts`, `helpers.ts`, or `shared.ts` (new or surviving)
6. Existing pipeline E2E behavior unchanged (9,254 lines of E2E/integration tests are the proof)
7. Two clean review passes before any wave merges to `minds/main`
