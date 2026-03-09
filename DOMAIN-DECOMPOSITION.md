# Collab Codebase Domain Decomposition

Horizontal subdomain slices for specialized Minds. Each Mind is an expert in its subdomain with clear, non-overlapping responsibilities. An orchestrator coordinates relevant Minds into vertical feature slices.

---

## Naming Convention

Each subdomain is called a **Mind** (brain emoji prefix). Minds are autonomous domain experts that own their files, tests, and contracts completely.

---

## Mind Communication: MCP-First Architecture

**Every Mind is an MCP server. No exceptions.**

This is not an implementation convenience — it's a strategic principle. Every Mind is a capability. Every capability is a consumable function node on the operations graph. The consumer is AI, not humans.

**Why ALL Minds are MCPs:**
- **"Products become APIs"** — applied internally. Each Mind IS a product surface. Templates could be consumed by a customer's CI. Signals by their monitoring. Pipelang by their IDE.
- **MCP tools ARE the API** — the formal, typed, versionable interface contract
- **Forces clean boundaries** — the MCP contract IS the domain boundary. A Mind's `handle()` interface forces it to define what it owns and what it doesn't.
- **Network effects** — the more Minds on the graph, the more composition possibilities. Remove any one and chains of autonomous agent workflows break.
- **Composability** — any system (internal Mind, external tool, CI/CD, a customer's agent) can consume any capability
- **Swap/upgrade/measure independently** — internal implementation invisible to consumers

### Transport: Streamable HTTP

All Mind MCPs use **Streamable HTTP** transport. Single HTTP endpoint per Mind, supports streaming responses, modern MCP transport standard.

### The Router Mind

The Router is not special infrastructure — it's a **Mind whose domain expertise is knowing which Mind owns what.** It follows the same rules as every other Mind: it has a `server.ts`, a `describe()`, and MCP tools. It just happens to be the first Mind that Claude Code starts.

Claude Code registers one MCP: `mcp__collab` (the Router Mind). The Router Mind discovers and starts all other Minds via convention-based discovery.

```
Claude Code → starts Router Mind (mcp__collab)
                  │
                  ├── Scans minds/*/server.ts
                  ├── Starts each Mind as a child process
                  ├── Calls describe() on each Mind
                  ├── Builds hybrid search index from descriptions
                  │
                  ├── Exposes handle() — routes work units via hybrid search
                  └── Exposes describe() — declares routing as its domain
```

**The Router Mind is not a singleton.** It's a Mind like any other — it can be swapped, upgraded, or consumed by a parent Router Mind. In a larger organization, Router Minds can be recursive:

```
Company Router Mind
  ├── routes to: Legal Mind
  ├── routes to: Marketing Mind
  ├── routes to: Engineering Mind
  │     └── Engineering Router Mind (this is what we're building)
  │           ├── routes to: Pipelang Mind
  │           ├── routes to: Signals Mind
  │           └── routes to: Pipeline Core Mind
  └── routes to: Finance Mind
```

Same pattern at every level. The host environment (Claude Code, a parent Router, a CI system) starts the first node. That node discovers the rest.

### Any Mind Can Be the Root Node

The architecture does not require a specific Mind as root. Any Mind can be the first node that a host environment starts — whichever Mind has no parent is root (node 0).

The Router Mind is the **recommended** root because routing is its domain expertise — it specializes in discovery, indexing, and answering "who owns what?" But there is nothing architecturally unique about it. Every Mind has the same protocol:

- It can be started by a host environment (Claude Code, CI, a parent Mind)
- It can discover children via `minds/*/server.ts` within its own directory
- It exposes `handle()` and `describe()` like every other Mind
- It escalates to its parent (if it has one) for anything outside its subtree

If you started Claude Code pointed at the Signals Mind instead of the Router Mind, the Signals Mind would become root. It could discover any children it has and handle requests in its domain. It would lack the Router's hybrid search for cross-domain routing — but it would work within its subtree.

**Why this matters:**

1. **No single point of failure.** If the Router Mind is down or misconfigured, you can still start any other Mind and work within its domain. You lose cross-Mind routing but not the ability to work.

2. **Composability.** A parent system doesn't need to know about the Router Mind specifically. It just needs any entry node. That node handles its subtree using the same parent-child protocol.

3. **Testing and development.** When developing a single Mind, you can start just that Mind directly — no need to boot the entire tree. Start the Mind you're working on, call `handle()`, test in isolation.

4. **Future: distributed Minds.** If Minds eventually run on different machines, any Mind can be the root of a subtree on that machine. The parent-child protocol works the same across network boundaries.

**The recommended topology for collab today:**

```
Claude Code → starts Router Mind (root) → discovers and starts all other Minds
```

This is a practical default, not an architectural requirement. The Router Mind is the best root because its domain is exactly this — discovery and routing. But the system is designed so that the root is a deployment choice, not a structural constraint.

### Convention-Based Mind Discovery

**Adding a Mind:** Create `minds/{name}/server.ts` → Router discovers it on next startup.
**Removing a Mind:** Delete the directory → it's gone. No config files, no state to clean up.

```
minds/
  router/server.ts          ← The Router Mind itself (Claude Code starts this)
  pipelang/server.ts        ← Router discovers and starts automatically
  pipeline_core/server.ts
  execution/server.ts
  coordination/server.ts
  observability/server.ts
  signals/server.ts
  transport/server.ts
  cli/server.ts
  installer/server.ts
  templates/server.ts
  spec_engine/server.ts
  spec_api/server.ts
  integrations/server.ts
```

Each Mind's `server.ts` exposes `handle()` and `describe()` via `createMind()`. Minds don't know about each other — they send requests to their parent when they need cross-domain data or work.

### Bidirectional Parent-Child Protocol

Every Mind in the system follows the same communication protocol, regardless of its position in the tree. A Mind knows exactly three things:

1. **Its own domain** — what it owns, what it can handle directly
2. **Its children** — discovered via `describe()` on each child Mind
3. **Its parent** — whoever spawned it

This creates two directional flows:

**Down = Delegation.** A Mind receives a work unit, checks its children's descriptions, finds a match, and sends the work down. The parent *chose* to delegate because it identified which child owns the work.

**Up = Escalation.** A Mind needs something outside its own domain and none of its children own it either. It sends the request to its parent. The parent checks *its* children (the requesting Mind's siblings — but the requester doesn't know they exist), routes to the right sibling, and returns the result. If the parent can't resolve it, it escalates to *its* parent. The request bubbles up until it reaches a node that can route it.

```
Engineering Mind receives: "need the Slack adapter status"
  │
  ├── Checks own domain: not mine
  ├── Checks children (Pipeline Core, Execution, Signals, Transport): none own Slack
  │
  └── Escalates UP to parent (Company Router Mind)
        │
        ├── Checks children: Marketing? No. Legal? No. Integrations? YES.
        │
        └── Delegates DOWN to Integrations Mind
              │
              └── Handles it, returns result back up the chain
```

**Universal resolution order.** Every Mind — whether handling an incoming work unit or needing something mid-task — follows the same three-step check:

1. **Do I own this?** → handle it internally. No routing needed.
2. **Does one of my children own this?** → route down. The parent checked its hybrid search index and found a match.
3. **Neither?** → escalate up to parent. The parent runs the same three-step check against *its* children (your siblings, but you don't know they exist). If the parent can't resolve it, it escalates to *its* parent.

This means internal utility functions like `getRepoRoot()` or `readJsonFile()` never become MCP tools. Pipeline Core uses them internally when handling requests. What Pipeline Core *exposes* are higher-level operations like "load the pipeline config for this ticket" — internally composing its own utility functions. The boundary between "what's an MCP tool" and "what's an internal function" is: **MCP tools are what consumers need. Internal functions are how the Mind fulfills those needs.**

**A Mind never knows the tree structure.** It never knows its siblings, its cousins, or how deep the tree goes. It has exactly two interfaces:

- **`parent.request()`** — "I need something outside my subtree"
- **`handle(work_unit)`** — "Do this work in your domain"

**This protocol is recursive and fractal.** The same code runs at every level:

- A **leaf Mind** (no children) either handles the request or escalates up. It never delegates down.
- A **mid-level Mind** checks its children first, delegates down if there's a match, escalates up if not.
- A **root Mind** (the one Claude Code starts) has no parent to escalate to — it's the last stop.

```
Claude Code (host)
  └── Router Mind (root — no parent to escalate to)
        ├── Engineering Mind
        │     ├── Pipeline Core Mind (leaf)
        │     ├── Execution Mind
        │     │     ├── Gate Evaluation Sub-Mind (leaf)
        │     │     └── Phase Dispatch Sub-Mind (leaf)
        │     ├── Signals Mind (leaf)
        │     └── Transport Mind (leaf)
        ├── Legal Mind
        │     ├── Contract Review Mind (leaf)
        │     ├── Compliance Mind (leaf)
        │     └── IP Mind (leaf)
        └── Marketing Mind
              ├── Content Mind (leaf)
              ├── Analytics Mind (leaf)
              └── Brand Mind (leaf)
```

**Why this matters for the future AI company:**

- **Same protocol at every scale.** A solo developer with 3 Minds and a 500-person company with 200 Minds use the same architecture. Add depth when complexity demands it.
- **Organizational clarity maps to system structure.** Engineering, Legal, Marketing aren't just labels — they're parent Minds with domain expertise in routing within their department. Just like a real VP knows which team owns what.
- **Most requests stay local.** In practice, the vast majority of work happens within the same subtree. An Execution Mind needing pipeline config data goes one hop up to Engineering Mind, which routes one hop down to Pipeline Core Mind. Two hops total. Cross-department requests (engineering needing legal review) are the rare exception, not the common path.
- **Tree depth is a deployment decision, not an architectural one.** Start flat (Router → 13 Minds). When a Mind gets complex enough to warrant sub-Minds, give it children. The protocol doesn't change. No code changes. No migration. Just add `minds/` directories inside the parent Mind.

### Distributed Decomposition — Every Parent Mind Decomposes

**Complex work units that span multiple children are decomposed at every level of the tree, not at a single bottleneck.**

A dedicated "Decomposer Mind" would be a single point of failure and a bottleneck. Instead, every parent Mind (any Mind with children) has the built-in ability to decompose multi-domain work units into child-scoped units before routing.

**How it works:** When a parent Mind receives a work unit, it evaluates whether the request spans multiple children's domains. If it does, the parent decomposes the work into separate child-scoped work units and routes each one individually. If the work is single-domain, it routes directly — no decomposition needed.

**The decomposition input is `describe()`.** Each parent already knows its children's domains from their `describe()` responses (used to build the hybrid search index). The same information that powers routing also powers decomposition — no new data source needed.

**Decomposition is recursive.** Each level of the tree only decomposes into its immediate children. A child that receives a decomposed work unit may itself have children and decompose further. The parent doesn't need to know the full tree — it only reasons about one level down.

#### Example: Multi-Domain Request Through a 3-Level Tree

```
Request: "Add a web page for legal compliance dashboard"

Node 0 — Company Router Mind:
  Children: [Engineering, Legal, Marketing]
  Decompose? YES — "web page" → Engineering, "legal compliance" → Legal
  Routes 2 work units:
    → Engineering: "add a web page for the compliance dashboard"
    → Legal: "provide compliance requirements for the dashboard"

Node 1 — Engineering Mind:
  Children: [Frontend, Backend, Infrastructure]
  Decompose? YES — "web page" → Frontend, "dashboard data" → Backend
  Routes 2 work units:
    → Frontend: "build the compliance dashboard page UI"
    → Backend: "create API endpoints for compliance dashboard data"

Node 2 — Frontend Mind:
  Children: (none — leaf node)
  Decompose? NO — single domain, handle it myself
  Handles the work directly
```

Each level only reasons about its direct children. The Company Router doesn't know about Frontend or Backend. The Engineering Mind doesn't know about Legal. Decomposition is local.

#### How a Parent Decides to Decompose

A parent Mind uses its children's `describe()` output to answer: **"Does this request match multiple children?"**

```typescript
// Conceptual — the actual implementation uses hybrid search scores
const matches = await mindRouter.route(workUnit.request);
const significantMatches = matches.filter(m => m.score > DECOMPOSE_THRESHOLD);

if (significantMatches.length <= 1) {
  // Single-domain: route directly to best match
  return routeToChild(matches[0], workUnit);
} else {
  // Multi-domain: decompose into child-scoped work units
  const childUnits = await decompose(workUnit, significantMatches);
  return Promise.all(childUnits.map(cu => routeToChild(cu.match, cu.workUnit)));
}
```

The decomposition step itself requires **LLM judgment** — given the request and the matched children's descriptions, break the request into child-scoped work units. This is the ONE place where an LLM is needed in the routing layer. Everything else (routing, scoring, matching) is deterministic.

#### Decomposition Prompt Pattern

```
Given this work unit: "{request}"

And these matched children:
- {child1.name}: {child1.domain} — capabilities: {child1.capabilities}
- {child2.name}: {child2.domain} — capabilities: {child2.capabilities}

Break the work unit into separate, self-contained work units — one per child.
Each child work unit should be completable by that child alone within its domain.
If the work unit is already single-domain, return it unchanged.

Return: [{ child: "name", work_unit: "scoped request" }, ...]
```

#### What a Mind Returns After Decomposition

When a parent decomposes and routes to multiple children, it collects all results and returns a combined response:

```typescript
interface DecomposedResult {
  status: "handled";
  data: {
    decomposed: true;
    results: Array<{
      child: string;
      workUnit: string;
      result: WorkResult;
    }>;
  };
}
```

The caller doesn't need to know decomposition happened — it sent one request, it gets one response. The decomposition is an internal concern of the parent Mind.

#### Why This Scales

- **No bottleneck.** Decomposition happens at every level, not at a single node.
- **Local reasoning only.** Each parent only knows its direct children — O(children) complexity, not O(all Minds).
- **Recursive by default.** Adding tree depth automatically adds decomposition depth. No code changes.
- **Same protocol.** `handle()` in, `WorkResult` out. Whether the parent decomposed or not is invisible to both the caller above and the children below.
- **Graceful degradation.** If decomposition fails or the LLM is unavailable, the parent falls back to routing to the best single match — exactly what happens today.

### Self-Describing Minds

Each Mind owns its own description. A parent calls `describe()` on each child at startup to build its search index. When a Mind's domain changes, it updates its own description — no external catalog to maintain.

```typescript
// Each Mind's server.ts provides its description via createMind()
import { createMind } from "../server-base";

export default createMind({
  name: "pipelang",
  domain: "DSL compiler that turns .pipe source files into CompiledPipeline JSON",
  keywords: ["dsl", "compile", "syntax", "phase", "gate", "transition", "modifier"],
  owns_files: ["pipelang/"],
  capabilities: ["compile", "validate", "diff", "introspect"],

  async handle(workUnit) {
    // Mind-specific logic
  },
});
```

### Hybrid Search Routing (BM25 + Vector)

The routing engine uses hybrid search to find relevant Minds for a work unit:

- **BM25 (30% weight)** — exact keyword matching against Mind descriptions. Catches specific terms like "signal", "compile", "registry", error strings, code symbols.
- **Vector similarity (70% weight)** — semantic search over Mind description embeddings. Catches intent like "change how phases transition" matching Execution Mind even without the word "transition."
- **Local reranking (QMD-style)** — prevents central Minds (Pipeline Core, Execution) from dominating every query. Ensures niche Minds (Templates, Installer) surface when actually relevant.

**Index construction (Router Mind startup):**
1. Router Mind calls `describe()` on each Mind
2. Computes BM25 index over domain + keywords + capabilities
3. Generates vector embeddings of full descriptions (lightweight local model, e.g. all-MiniLM-L6-v2)
4. Tiny corpus (all Minds) — index builds in milliseconds

**Query example:**
```
handle("fix the signal that fires when blind QA fails") → routes to: {
  matches: [
    { mind: "signals",       score: 0.94, role: "Fix emit handler for blindqa fail event" },
    { mind: "pipeline_core", score: 0.82, role: "Check signal name mapping in config" },
    { mind: "execution",     score: 0.61, role: "Verify gate evaluation handles the signal" }
  ],
  method: "hybrid_bm25_vector",
  bm25_top: ["signals", "pipeline_core"],
  vector_top: ["signals", "execution"]
}
```

### THE FOUR ARCHITECTURAL RULES

These are absolute constraints. Not guidelines, not aspirations. No exceptions.

---

**RULE 1: MCP Is the Only Cross-Boundary Interface**

> **A Mind NEVER imports, reads, greps, or directly accesses another Mind's files, functions, or internal state. A Mind doesn't know other Minds exist. The ONLY way to get cross-domain data or request cross-domain work is by escalating the request to the parent Mind. The parent determines which child owns it and handles the routing — or escalates further up the tree. The requesting Mind doesn't know or care how the data was obtained.**

No shortcuts, no "just this once." This applies at development time when agents are working on the codebase. At runtime, compiled code imports normally — that's where it all comes together.

---

**RULE 2: Work Units, Not Typed Tool Calls**

> **A Mind receives work via `handle(work_unit)` — a natural language description of what's needed. The Mind has full judgment about HOW to fulfill it. There are no typed per-Mind tool catalogs. Internal functions are implementation details invisible to the outside.**

A work unit can be a data request ("load the pipeline config for BRE-428") or a code change request ("add a max_retries field to pipeline config"). The Mind handles both the same way — it reads the request, uses its internal functions, and returns a result or makes changes in its own domain.

Why: Each Mind agent needs full judgment about how to work in its domain. A typed tool like `add_config_field("max_retries", "number", 3)` removes that judgment and forces every possible operation to be pre-defined. Instead, the Mind receives a work unit and decides how to fulfill it — what functions to call, what files to read, what changes to make, what tests to update. The `handle()` interface is the same at every level of the tree.

---

**RULE 3: No Shared Utilities — Every Function Has an Owner**

> **There are no "utils," "helpers," or "shared libs." Every function belongs to exactly one Mind. If a function exists, a Mind owns it. If no Mind owns it, it doesn't exist.**

Files named `utils.ts`, `helpers.ts`, or `shared.ts` are a code smell — they mean ownership hasn't been decided. In the Minds model, every function lives in a named module inside the Mind that owns that domain. Other Minds access it through MCP tools at dev time, never by importing the file directly.

Example: `src/lib/pipeline/utils.ts` today contains `getRepoRoot`, `readJsonFile`, `loadPipelineForTicket`, `findFeatureDir`, etc. These are ALL Pipeline Core's responsibility. They get split into focused modules within Pipeline Core — `repo.ts`, `json-io.ts`, `pipeline.ts`, `feature.ts` — not left in a catch-all `utils.ts`.

---

**RULE 4: One Atomic Commit Per Feature**

> **All Minds' changes for a single feature go in one commit. The orchestrator coordinates — gathers all changes after all Mind agents complete their work, commits once.**

No intermediate state where one Mind's changes are in the codebase without the others. A feature is atomic — it either lands completely or not at all. This means:
- The orchestrator waits for all Mind agents to finish their work units
- All changes are staged together
- One commit message describes the feature, not the individual Mind contributions
- The feature can be cleanly reverted with one `git revert`

---

#### Why this rule exists

In a large codebase, no single agent can hold full context of every domain. Today, agents grep across the entire repo, discover 30+ call sites, and must understand internal implementation details of domains they don't own. This creates:

- **DRY violations** — two functions doing the same thing in different files because both domains implemented their own version (e.g., `registryPath()` in `paths.ts` vs `getRegistryPath()` in `utils.ts`)
- **Implicit coupling** — changing an internal function signature breaks callers in other domains who imported it directly
- **Context explosion** — an agent working on Signals must read Pipeline Core internals, Execution internals, and Transport internals just to emit a signal correctly
- **Boundary erosion** — over time, every file imports from every other domain and the boundaries become meaningless

The MCP boundary eliminates all of these by construction:

- **You can't duplicate what you can't see.** If registry path resolution is owned by Pipeline Core, the Signals Mind can't accidentally reimplement it — Signals doesn't even know Pipeline Core exists. There's one implementation, behind the parent Mind, invisible to everyone else.
- **Internal changes don't break callers.** Pipeline Core can refactor `getRegistryPath` → `registryPath`, rename files, change signatures — the Router's contract stays the same, so no other Mind is affected.
- **Context stays scoped.** An agent working in the Signals Mind only needs Signals files in its context. When it needs registry data, it sends the request to its parent Mind and gets back a typed result. It never reads `src/lib/pipeline/utils.ts`. It doesn't know Pipeline Core exists.
- **Boundaries are enforced, not aspirational.** The MCP contract IS the boundary. You physically cannot cross it without a tool call.

#### What this looks like in practice

**WITHOUT this rule (today's model):**
```
Agent working on Signals Mind needs the registry path for a ticket.
  1. Greps codebase for "registry" — finds 30+ results across 8 files
  2. Reads src/lib/pipeline/utils.ts to understand getRegistryPath()
  3. Reads src/lib/pipeline/paths.ts to understand registryPath()
  4. Discovers they're duplicates with different signatures
  5. Must decide which to use
  6. Imports from Pipeline Core's internals directly
  7. Now coupled to Pipeline Core's internal file structure
```

**WITH this rule (Mind MCP model):**
```
Agent working on Signals Mind needs the registry path for a ticket.
  1. Sends request to parent Mind: "I need the registry path for BRE-428"
  2. Gets back: "/path/to/.collab/state/pipeline-registry/BRE-428.json"
  3. Done. Never touched Pipeline Core's files. Doesn't know Pipeline Core exists.
```

The agent doesn't need to know WHO resolves registry paths or HOW. It doesn't know about `paths.ts` vs `utils.ts`. It doesn't know about Pipeline Core. It sends a request, gets a result. Everything outside its domain goes through its parent.

#### All cross-domain requests go through the parent

When a Mind agent encounters something outside its domain, it sends the request to its parent Mind. The parent determines which child owns the request, routes it, and returns the result. If no child owns it, the parent escalates to its own parent. The requesting Mind never knows which Mind fulfilled the request.

```
Signals Mind: "I need the registry path for BRE-428"
  → parent routes to Pipeline Core → returns path
  → Signals Mind gets the path. Doesn't know Pipeline Core was involved.

Signals Mind: "I need to know what signals the plan phase can emit"
  → parent routes to Pipeline Core → returns signal list
  → Signals Mind gets the list. Doesn't care where it came from.

Execution Mind: "I need to send a message to tmux pane %1234"
  → parent routes to Transport → message sent
  → Execution Mind gets confirmation. Doesn't know Transport exists.
```

#### Mind-scoped agent context

Each Mind has a **scoped agent context** — when an agent is assigned to work in a Mind's domain, it is loaded with:
- That Mind's source files, tests, and internal implementation
- Access to its parent Mind (for any cross-domain requests)
- NOT the internal files of any other Mind
- NOT knowledge of which other Minds exist

```
Agent assigned to Signals Mind:
  ✅ Has context: src/handlers/*, signal types, emit patterns
  ✅ Has access to: parent Mind (sends cross-domain requests here)
  ❌ Does NOT have: src/lib/pipeline/utils.ts, src/scripts/orchestrator/*
  ❌ Does NOT know: which other Minds exist or what they're called

  Needs registry data?      → sends request to parent Mind
  Needs signal name config?  → sends request to parent Mind
  Needs to dispatch message? → sends request to parent Mind

  NEVER: import { getRegistryPath } from "../lib/pipeline/utils"
  NEVER: Read("src/lib/pipeline/utils.ts")
  NEVER: Grep("getRegistryPath", path="src/lib/pipeline/")
  NEVER: collab_pipeline_core_read_registry(ticket_id)  ← Mind doesn't know Pipeline Core exists
```

#### Summary

| Principle | Rule |
|-----------|------|
| Cross-Mind communication | All cross-domain requests go through the parent Mind |
| Mind isolation | A Mind doesn't know other Minds exist — only its parent |
| Domain ownership | Each Mind is the single source of truth for its domain |
| Agent context | Scoped to one Mind + access to parent Mind only |
| Encapsulation | Internal implementation is invisible across Mind boundaries |
| DRY enforcement | Can't duplicate what you can't see — isolation prevents it by construction |

### Workflow: How a Task Flows Through the System

A task arrives → the root Mind (node 0) routes it → Mind(s) do the work. Here's the full flow with resolved design decisions.

#### Step 1: Task arrives

The user gives a task to a Claude Code agent. The agent has one MCP registered: the root Mind (whichever Mind has no parent — today that's the Router Mind via `mcp__collab`).

#### Step 2: Decompose (if needed) and Route

The root Mind receives the task and uses hybrid search to determine which child Mind(s) own this work.

**Single-domain request:** Routes directly to the best-matched child. No decomposition needed.

**Multi-domain request:** The parent detects multiple significant matches across its children, decomposes the work into child-scoped work units (using LLM judgment against children's `describe()` output), and routes each unit to the appropriate child. See **Distributed Decomposition** above.

This happens recursively — if a child Mind that receives a decomposed work unit is itself a parent with children, it applies the same decompose-or-route decision at its level.

#### Step 3: Mind does the work

The Mind IS the agent. It already knows its own domain — its files, its tests, its internal structure. The parent just sends it a work unit describing what to do.

- The Mind reads/edits its own files directly
- If it needs data from outside its domain, it sends the request to its parent Mind — it doesn't know or care which Mind fulfills it
- If it needs code changes outside its domain, it sends a work unit to its parent Mind
- It never reads, greps, or imports from another Mind's files
- It doesn't know other Minds exist

#### Step 4: Test

Each Mind owns its own tests and runs them. A Mind doesn't know about or run another Mind's tests.

E2E testing is runtime behavior — if an E2E test fails, the failure is a bug that gets routed through the parent Mind like any other task. The parent determines which child Mind owns the broken behavior, sends the fix request. No special path.

#### Step 5: Complete

Work is done. Each Mind has made its changes and its tests pass.

### Resolved Workflow Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | **How do Mind MCP servers start?** | **Convention-based discovery.** A parent Mind scans `minds/*/server.ts` on startup, starts each child Mind as a child process, calls `describe()` to build the search index. The host environment (Claude Code) starts the root Mind (node 0); that Mind starts its children. Add a Mind = add a directory. Remove a Mind = delete the directory. No config files, no state. |
| 2 | **Mid-task re-routing** | Not needed. Parent sends work to child Mind once. If a Mind needs cross-domain data, it sends the request to its parent Mind. If it needs cross-domain code changes, it sends a work unit to its parent Mind. The Mind doesn't know which Mind fulfills either request. |
| 3 | **Entering a Mind's scope** | Not a concept. The Mind IS the agent — it already knows its own domain. The parent just sends work to it. |
| 4 | **Understanding another Mind's interface** | Not needed at the parent level. The parent only knows which child Mind owns what responsibility. It sends the work unit. The child Mind handles everything. |
| 5 | **Dev-time vs runtime boundary** | MCP boundary is **dev-time only**. At development time, agents communicate across Mind boundaries exclusively via MCP tools. At runtime, compiled code imports across domains normally — that's where it all comes together. |
| 6 | **Cross-Mind code changes** | Parent decomposes multi-domain requests into child-scoped work units using LLM judgment against children's `describe()` output, then routes each unit separately. Each Mind handles its own changes. Cross-domain data and code change requests go through the parent Mind — the requesting Mind doesn't know which Mind handles them. See **Distributed Decomposition**. |
| 7 | **Testing across Minds** | Each Mind owns its own tests. E2E failures are bugs that route through the parent Mind like any other task — no separate testing path. |
| 8 | **Commit granularity** | **One commit per feature.** All Minds' changes go in one atomic commit. The orchestrator coordinates — gathers all changes after all Minds complete, commits once. Feature can be reverted cleanly. No intermediate state where one Mind's changes are in without the others. |
| 9 | **Single-tool interface** | Every Mind exposes exactly two tools: `handle(work_unit)` and `describe()`. There is no per-Mind tool catalog. Internal functions are implementation details. Work units can be data requests ("load pipeline config for BRE-428") or code change requests ("add a max_retries field"). The Mind has full judgment about HOW to fulfill either. |

### The Single-Tool Interface

Every Mind exposes exactly **two tools** to its parent:

- **`handle(work_unit)`** — "Do this work" or "Answer this question." The Mind figures out internally what to do.
- **`describe()`** — "What do you own?" Returns the Mind's domain, keywords, and capabilities so the parent can build its search index.

That's it. There is no per-Mind tool catalog. There is no `load_pipeline()` or `emit_signal()` or `compile()` exposed externally. Those are **internal implementation details** — how the Mind fulfills a `handle()` request.

```
Parent sends: handle("load the pipeline config for BRE-428")
  │
  Pipeline Core Mind internally:
  ├── calls getRepoRoot()
  ├── calls readJsonFile(registryPath)
  ├── calls resolvePipelineConfigPath()
  ├── calls readJsonFile(configPath)
  └── returns: { configPath, pipeline, variant }

The parent doesn't know or care what functions Pipeline Core used.
It sent a work unit, it got a result.
```

**Why no tool catalog:**
- A parent Mind doesn't need to know *how* a child works — it just needs to know *what domain* the child owns (from `describe()`)
- Internal functions change without affecting anyone outside the Mind
- The `handle()` interface is the same at every level of the tree — uniform protocol, zero coupling to internal structure

### Architecture Summary

Every Mind follows the same startup protocol regardless of its position in the tree:

```
1. Host starts the root Mind (node 0 — the Mind with no parent)
2. Root Mind scans minds/*/server.ts → discovers children
3. Starts each child Mind as a child process
4. Calls describe() on each child → builds hybrid search index
5. Each child Mind that has its own children repeats steps 2-4

Work flows DOWN as delegated work units, UP as escalated requests.
```

**General tree model:**

```
Host (Claude Code, CI, parent Mind, etc.)
  │
  └── starts Root Mind (node 0 — no parent)
        │
        ├── scans minds/*/server.ts
        ├── starts child Minds
        ├── calls describe() on each
        ├── builds hybrid search index (BM25 + vector)
        │
        ├── Child Mind A
        │     ├── scans its own minds/*/server.ts (if any)
        │     ├── Sub-Mind A1 (leaf — handles work or escalates up)
        │     └── Sub-Mind A2 (leaf)
        │
        ├── Child Mind B (leaf — no children)
        │
        └── Child Mind C
              ├── Sub-Mind C1
              └── Sub-Mind C2
```

**Today's deployment (flat, all Minds are direct children of Router):**

```
Claude Code
  └── Router Mind (node 0)
        ├── Pipelang          ← compile, validate, diff
        ├── Pipeline Core     ← load, transition, registry
        ├── Execution         ← dispatch, gate eval, init
        ├── Coordination      ← holds, groups, Q&A
        ├── Observability     ← metrics, classify, PR
        ├── Signals           ← emit, resolve signal
        ├── Transport         ← publish, subscribe, status
        ├── CLI               ← browse, resolve, repo mgmt
        ├── Installer         ← install, updates, mappings
        ├── Templates         ← list, read, schema
        ├── SpecEngine        ← create spec, generate, session
        ├── SpecAPI           ← endpoints, health
        └── Integrations      ← adapters, status
```

This flat topology is a starting point. As Minds grow complex enough to warrant sub-Minds, the tree gains depth. The protocol doesn't change.

**Status:** Conceptual. Current implementation uses direct imports. MCP interfaces will be defined as Minds are formalized.

---

## Proposed Directory Structure (Future)

Currently files are scattered across `src/`. The target is a flat `minds/` directory where each Mind owns its space:

```
minds/
  pipelang/          # already isolated at pipelang/
  pipeline-core/     # from src/lib/pipeline/
  execution/         # from src/scripts/orchestrator/ (dispatch, gates, init)
  coordination/      # from src/scripts/orchestrator/commands/ (holds, groups, Q&A)
  observability/     # from src/scripts/orchestrator/ (metrics, classify, PR)
  signals/           # from src/handlers/ + src/hooks/
  transport/         # already isolated at transport/
  cli/               # from src/cli/ + cli/ (binary + arg parsing only)
  installer/         # from cli/src/utils/installer.ts + src/commands/collab.install.ts
  templates/         # from cli/src/templates/ + src/config/
  specengine/        # from src/services/ + src/db/ + src/lib/{errors,validation,markdown}
  specapi/           # from src/index.ts + src/routes/
  integrations/      # from src/plugins/slack/ (+ future adapters)
```

**Status:** Conceptual. Files remain in current locations. This section defines the target structure for when restructuring happens.

**Already isolated:** `pipelang/`, `transport/`
**Tangled under src/:** Pipeline Core, Execution, Coordination, Observability, Signals, CLI, Installer, Templates, SpecEngine, SpecAPI, Integrations

---

## 🧠 Pipelang Mind — DSL Compiler & Language Tooling

**Scope:** `pipelang/`

| Files | Responsibility |
|-------|---------------|
| `src/lexer.ts` | Tokenization of `.pipeline` files |
| `src/parser.ts`, `src/parser-context.ts` | AST construction |
| `src/compiler.ts` | AST to compiled JSON (`CompiledPipeline`) |
| `src/validator.ts` | Two-pass semantic validation |
| `src/phase-modifiers.ts`, `src/gate-modifiers.ts` | Modifier resolution |
| `src/runner.ts`, `src/tmux.ts` | Pipeline execution runtime |
| `src/lsp/*` | Language server (completion, diagnostics, rename, go-to-def) |
| `src/types.ts` | AST type definitions |

**Boundary contract:** Consumes `.pipeline` text, produces `CompiledPipeline` JSON (defined in `src/lib/pipeline/types.ts`). Imports shared types from Pipeline Core Mind but never writes to registry or state.

**What changes here:** New DSL syntax, parser fixes, LSP features, compiler output changes, validation rules.

**~2,500 lines** of source code.

---

## 🧠 Pipeline Core Mind — Shared Library & State Machine

**Scope:** `src/lib/pipeline/`

| Files | Responsibility |
|-------|---------------|
| `types.ts` | `CompiledPipeline`, `CompiledPhase`, `CompiledGate` — the canonical schema |
| `utils.ts` | `loadPipelineForTicket()`, `findFeatureDir()`, `readFeatureMetadata()`, JSON I/O |
| `registry.ts` | Registry CRUD: `parseFieldValue()`, `applyUpdates()`, `appendPhaseHistory()` |
| `signal.ts` | Signal parsing, `getAllowedSignals()`, `resolveSignalName()`, `isSuccessSignal()` |
| `transitions.ts` | `resolveTransition()`, `resolveGateResponse()`, `resolveConditionalTransition()` |
| `errors.ts` | Shared error types |
| `tmux-client.ts` | Tmux abstraction used by orchestrator |
| `questions.ts` | Batch Q&A protocol types and helpers |
| `metrics.ts`, `autonomy-rate.ts`, `classify-run.ts`, `gate-accuracy.ts`, `dashboard.ts`, `draft-pr.ts` | Pipeline analytics |
| `status-emitter.ts` | Status event emission on registry writes |
| `repo-registry.ts` | Multi-repo path resolution (`repos.json`) |

**Boundary contract:** Owns pipeline configuration, registry state, signal definitions, and transition logic. Exports pure functions and types via its MCP tools. Never executes pipeline phases directly. Other Minds access Pipeline Core's data through their parent Mind — they never import from it directly.

**What changes here:** New pipeline config fields, registry schema changes, new signal types, transition logic changes, metrics formulas.

**~3,000 lines** of source code.

---

## 🧠 Execution Mind — Single-Pipeline Execution Loop

**Scope:** `src/scripts/orchestrator/{orchestrator-init,signal-validate,transition-resolve,evaluate-gate,Tmux}.ts` + `src/scripts/orchestrator/commands/{orchestrator-init,phase-dispatch,phase-advance,pipeline-config-read,registry-read,registry-update,status-table,teardown-bus}.ts` + `src/commands/collab.run.md`

| Files | Responsibility |
|-------|---------------|
| `commands/orchestrator-init.ts` (904 lines) | Bootstrap: schema validation, pane spawn, registry creation, worktree setup |
| `commands/phase-dispatch.ts` | Read phase command from config, send to agent pane |
| `transition-resolve.ts` | Find next phase/gate for a (phase, signal) pair |
| `signal-validate.ts` | Parse + validate incoming signals against pipeline config |
| `commands/phase-advance.ts` | Registry update + phase history on successful transition |
| `evaluate-gate.ts` | Gate prompt resolution + verdict validation (2-mode) |
| `goal-gate-check.ts` | Check goal gates before terminal phase |
| `commands/registry-read.ts`, `registry-update.ts` | Registry read/write CLI wrappers |
| `commands/pipeline-config-read.ts` | Config value extraction |
| `commands/status-table.ts` | Pipeline status display |
| `commands/teardown-bus.ts` | Transport cleanup |
| `Tmux.ts` | Tmux send-keys/capture-pane wrapper |
| `orchestrator-utils.ts`, `test-helpers.ts` | Shared test/util code |

**Boundary contract:** Owns the single-ticket execution loop: receive signal → validate → resolve transition → evaluate gate → dispatch next phase. Reads pipeline config via Pipeline Core Mind. Writes to registry. The `collab.run.md` command file defines the AI judgment layer.

**What changes here:** Phase dispatch logic, gate evaluation, signal validation, init bootstrapping, single-pipeline lifecycle.

**~3,500 lines** of source + tests.

---

## 🧠 Coordination Mind — Multi-Ticket Orchestration

**Scope:** `src/scripts/orchestrator/commands/{coordination-check,group-manage,resolve-tickets,write-resolutions,resolve-questions,question-response}.ts` + `src/scripts/orchestrator/held-release-scan.ts`

| Files | Responsibility |
|-------|---------------|
| `commands/coordination-check.ts` | Multi-ticket dependency holds via `coordination.json` |
| `held-release-scan.ts` | Scan registries for `status=held`, release when deps satisfied |
| `commands/group-manage.ts` | Multi-ticket group creation and management |
| `commands/resolve-tickets.ts` | Resolve ticket IDs within a group |
| `commands/write-resolutions.ts` | Write question resolutions for agents |
| `commands/resolve-questions.ts` | Resolve pending questions from agents |
| `commands/question-response.ts` | Process question responses |

**Boundary contract:** Owns everything multi-ticket: dependency holds, group management, cross-ticket coordination, and the batch Q&A protocol (push-based question resolution flow). Reads/writes `coordination.json` and registry files. Receives work units from its parent Mind when holds or questions are involved.

**What changes here:** Coordination patterns, dependency logic, group management, batch Q&A protocol.

**~1,500 lines** of source + tests.

---

## 🧠 Observability Mind — Metrics, Analytics & Run Classification

**Scope:** `src/scripts/orchestrator/{record-gate,create-draft-pr,complete-run,classify-run,metrics-dashboard,gate-accuracy-check}.ts`

| Files | Responsibility |
|-------|---------------|
| `record-gate.ts` | Record gate evaluation results for accuracy tracking |
| `create-draft-pr.ts` | Create draft PR when pipeline reaches completion |
| `complete-run.ts` | Finalize a pipeline run with classification and stats |
| `classify-run.ts` | Classify run outcome (success, partial, failed, etc.) |
| `metrics-dashboard.ts` | Generate metrics dashboard data |
| `gate-accuracy-check.ts` | Analyze gate accuracy over historical runs |

**Boundary contract:** Owns pipeline analytics: gate recording, run classification, PR creation, metrics dashboards, accuracy tracking. Requests registry and phase history through its parent Mind (doesn't know or care which Mind provides it). Never dispatches phases or evaluates gates. Receives work units from its parent Mind at lifecycle milestones (gate evaluated, run complete).

**What changes here:** Metrics formulas, run classification logic, dashboard format, PR templates, accuracy analysis.

**~1,500 lines** of source + tests.

---

## 🧠 Signals Mind — Agent-to-Orchestrator Communication

**Scope:** `src/handlers/` + `src/hooks/`

| Files | Responsibility |
|-------|---------------|
| `pipeline-signal.ts` | `mapResponseState()`, `buildSignalMessage()`, `resolveRegistry()`, `resolveSignalName()`, signal constants |
| `emit-phase-signal.ts` | Generic signal emission factory + transport dispatch |
| `emit-blindqa-signal.ts`, `emit-run-tests-signal.ts`, `emit-code-review-signal.ts`, etc. | Per-phase thin wrappers |
| `emit-spec-critique-signal.ts`, `emit-question-signal.ts` | Specialized signal types |
| `resolve-tokens.ts` | Token interpolation (`${TICKET_ID}`, `${PHASE}`, etc.) |
| `signal-contract.test.ts` | Contract tests ensuring handler-to-config alignment |
| `question-signal.hook.ts` | Hook that fires on question events |

**Boundary contract:** Agents call these handlers to emit signals. Handlers resolve the current registry, map events to signal names from pipeline config, persist to queue, and dispatch messages. Today, `emit-phase-signal.ts` dynamically imports transport directly; in the target architecture, dispatch goes through the parent Mind (which routes to the appropriate transport — Signals doesn't know which transport exists). Pure producer side of the signal protocol.

**What changes here:** New signal types, new phase handlers, transport dispatch changes, token resolution.

**~1,500 lines** of source.

---

## 🧠 Transport Mind — Communication Infrastructure

**Scope:** `transport/`

| Files | Responsibility |
|-------|---------------|
| `Transport.ts` | `Transport` interface: `publish()`, `subscribe()`, `teardown()`, `agentPrompt()` |
| `TmuxTransport.ts` | Tmux-based transport (send-keys, capture-pane polling) |
| `BusTransport.ts` | SSE-based message bus client |
| `bus-server.ts` | HTTP bus server with SSE streaming |
| `bus-agent.ts` | Agent-side bus client |
| `bus-signal-bridge.ts`, `bus-command-bridge.ts` | Bridge between bus messages and orchestrator |
| `status-aggregator.ts` | Aggregate status from multiple pipelines |
| `status-daemon.ts` | Background status monitoring daemon |
| `status-snapshot.ts`, `status-derive.ts` | Status computation |
| `dashboard.html` | Web dashboard for pipeline status |

**Boundary contract:** Provides the `Transport` interface. Consumers call `publish(channel, message)` and `subscribe(channel, handler)`. No knowledge of pipeline phases, signals, or registry — purely message delivery.

**What changes here:** New transport implementations, bus protocol changes, status aggregation logic, dashboard UI.

**~3,000 lines** of source.

---

## 🧠 CLI Mind — `collab` Binary & Command Interface

**Scope:** `src/cli/index.ts` + `src/cli/commands/` + `src/cli/lib/` + `cli/bin/collab.ts`

| Files | Responsibility |
|-------|---------------|
| `src/cli/index.ts` | Compiled binary entry point (zero deps) |
| `src/cli/commands/pipelines/browse.ts`, `list.ts`, `update.ts`, `remove.ts` | Package registry browsing, listing, updating, removing |
| `src/cli/commands/pipeline/init.ts`, `validate.ts` | Pipeline scaffolding and validation |
| `src/cli/commands/repo/*` | Multi-repo management |
| `src/cli/lib/semver.ts` | Semantic versioning resolution |
| `src/cli/lib/lockfile.ts`, `state.ts` | Lockfile and state management |
| `src/cli/lib/registry.ts`, `resolver.ts`, `cli-resolver.ts` | Package registry resolution |
| `src/cli/lib/integrity.ts` | Integrity checking |
| `src/cli/types/` | CLI-specific type definitions |
| `cli/bin/collab.ts` | npm package entry point (commander-based) |
| `cli/src/utils/fs.ts`, `git.ts`, `version.ts` | CLI utilities |

**Boundary contract:** Parses user commands, resolves packages from remote registry (GitHub releases), manages `.collab/` state (lockfile, state.json). Delegates actual file installation to the Installer Mind. No knowledge of running pipelines or what files exist in templates.

**What changes here:** New CLI subcommands, arg parsing, semver resolution, registry protocol, state format.

**~2,000 lines** of source.

---

## 🧠 Installer Mind — Distribution & File Mapping

**Scope:** `src/cli/commands/pipelines/install.ts` + `cli/src/utils/installer.ts` + `src/commands/collab.install.ts` + `scripts/install.sh`

| Files | Responsibility |
|-------|---------------|
| `src/cli/commands/pipelines/install.ts` | Install command orchestration |
| `cli/src/utils/installer.ts` | Core install logic: file copying, directory creation, hook registration |
| `src/commands/collab.install.ts` | Claude Code install command |
| `scripts/install.sh` | Shell-based installer (bootstrap) |

**Boundary contract:** Receives install requests via its parent Mind. Knows the mapping of source templates to destination paths (`.collab/scripts/`, `.claude/commands/`, `.collab/config/`). Consumes template files (requested through parent Mind — doesn't know which Mind provides them). When new functionality requires distribution, the work unit arrives through the parent.

**What changes here:** New file mappings, install hooks, distribution logic, upgrade paths, idempotency checks.

**~800 lines** of source.

---

## 🧠 Templates Mind — Distributable Config & File Assets

**Scope:** `cli/src/templates/` + `src/config/`

| Files | Responsibility |
|-------|---------------|
| `cli/src/templates/config/pipeline.json` | Default pipeline configuration |
| `cli/src/templates/config/pipeline.v3.schema.json`, `pipeline.v3.1.schema.json`, `pipeline.compiled.schema.json` | Pipeline JSON schemas |
| `cli/src/templates/config/gates/*` | Gate prompt templates (plan-review, analyze-review) |
| `cli/src/templates/config/verify-config.json`, `verify-patterns.json` | Verification configuration |
| `cli/src/templates/config/displays/*` | Display templates (blindqa-header, etc.) |
| `cli/src/templates/config/orchestrator-contexts/*` | Orchestrator context files |
| `cli/src/templates/config/multi-repo.json`, `coordination.schema.json` | Multi-repo and coordination schemas |
| `cli/src/templates/scripts/*` | Distributable script files |
| `cli/src/templates/hooks/*` | Hook templates (question-signal) |
| `cli/src/templates/lib-pipeline/*` | Distributable pipeline library files |
| `cli/src/templates/claude-settings.json` | Claude settings template |
| `cli/src/templates/specify-scripts/*` | Specify phase scripts |
| `src/config/pipeline-variants/*` | Pipeline variant configs (backend, frontend-ui, deploy, test, verification) |
| `src/config/defaults/*` | Default phase configs (run-tests, deploy-verify, visual-verify) |
| `src/config/test-fixtures/*` | Test fixture configs |

**Boundary contract:** Pure data — no logic. These are the files that get distributed to target repos. Other Minds produce new templates when they add features — those work units arrive through the parent Mind and land here. The Templates Mind is the single source of truth for "what gets installed."

**What changes here:** New config files, schema updates, gate prompts, default configs, variant definitions. Any Mind that adds distributable artifacts updates this Mind.

**~2,500 lines** of config/template files (JSON + Markdown).

---

## 🧠 SpecEngine Mind — Spec Generation Core Logic

**Scope:** `src/services/` + `src/db/` + `src/lib/{errors,validation,markdown}.ts`

| Files | Responsibility |
|-------|---------------|
| `services/llm.ts` | LLM calls via OpenRouter (analyze, generate specs, generate questions) |
| `services/spec.ts` | Spec CRUD: create, update, get, state transitions |
| `services/spec-generator.ts` | Orchestrates generation: get spec + Q&A + LLM + save |
| `services/question.ts` | Question generation and retrieval |
| `services/answer.ts` | Answer recording |
| `services/blind-qa.ts` | Blind QA verification flow |
| `services/session.ts` | Session state machine (drafting → questioning → generating → completed) |
| `services/session-cleanup.ts` | Expire stale sessions |
| `services/role.ts` | Create roles, assign members |
| `services/channel.ts` | Create communication channels, invite members |
| `db/schema.ts` | Drizzle ORM schema (specs, sessions, questions, answers, roles) |
| `db/index.ts` | Database connection |
| `lib/errors.ts` | Error types (ConflictError, NotFoundError, ValidationError) |
| `lib/validation.ts` | Input validation |
| `lib/markdown.ts` | Markdown to HTML conversion |

**Boundary contract:** Pure business logic + persistence. Takes inputs (description, Q&A pairs, roles), produces specs via LLM. Manages session lifecycle and state transitions. Owns the database. Knows nothing about HTTP, Slack, or any delivery mechanism.

**What changes here:** LLM prompts, generation logic, session state machine, DB schema, question strategies.

**~1,200 lines** of source.

---

## 🧠 SpecAPI Mind — HTTP Interface

**Scope:** `src/index.ts` + `src/routes/`

| Files | Responsibility |
|-------|---------------|
| `src/index.ts` | Express server bootstrap, middleware registration, plugin loading |
| `routes/specfactory.ts` | REST endpoints: `/start`, `/analyze`, `/generate`, `/answer`, etc. |
| `routes/spec.ts` | Spec retrieval endpoints |
| `routes/middleware.ts` | Request ID generation, error handling middleware |

**Boundary contract:** HTTP API layer that exposes spec generation capabilities as REST endpoints. Handles request parsing, validation, error formatting, and response serialization. SpecAPI is the **parent Mind** of SpecEngine — all business logic requests route down to SpecEngine as its child. This is the API that all integrations (Slack, Discord, web UI, CLI) call.

**What changes here:** New endpoints, request/response formats, authentication, rate limiting.

**~500 lines** of source.

---

## 🧠 Integrations Mind — Communication Adapters (Slack + Future)

**Scope:** `src/plugins/slack/`

| Files | Responsibility |
|-------|---------------|
| `plugins/slack/client.ts` | Slack Bolt app initialization and configuration |
| `plugins/slack/commands.ts` | `/specfactory` slash command handler |
| `plugins/slack/interactions.ts` | Modal submissions, button clicks, interactive flows |
| `plugins/slack/blocks.ts` | Block Kit UI builders for Slack-specific UIs |

**Boundary contract:** Adapters that translate platform-specific interactions into SpecAPI calls. Slack adapter receives slash commands and interactive events → calls `http://localhost:3000/api/specfactory/*` → renders results in Slack Block Kit UI. Each future integration (Discord, Teams, web UI) would be a new adapter in this Mind, all calling the same SpecAPI.

**What changes here:** New Slack features, new integration adapters (Discord, Teams), platform-specific UI patterns.

**~300 lines** of source (Slack only, grows with each new adapter).

---

## ~~🧠 Attractor~~ — DEPRECATED (Go Orchestrator)

**Status:** Archived. The TypeScript Execution Mind is the canonical orchestrator.

**Scope:** `collab/attractor/` (~2,000 lines of Go)

**Why deprecated:** Maintaining two implementations of the same orchestrator logic in two languages violates DRY and creates permanent catch-up risk. The TypeScript Execution Mind is already richer (evaluate-gate.ts, v3.1 transitions, conditional transitions, batch Q&A). The Go performance advantage is irrelevant at pipeline signal throughput (signals/minute, not signals/second). The goroutine-per-ticket pattern is trivially portable to Bun's async model if needed.

**Salvage:** Port `dotgen.go` (pipeline DOT graph visualization, ~100 lines of logic) to TypeScript as a CLI tool in the Execution or Observability Mind.

---

## Current State: Direct Import Dependencies

> **This section documents how the codebase works TODAY — direct imports across Mind boundaries. This is what we're migrating away from. In the target architecture, ALL of these arrows go through the parent Mind instead.**

```
                    +-----------------+
                    | 🧠 Pipelang    | --produces--> CompiledPipeline JSON
                    +--------+--------+
                             | imports types
                             v
   +-------------+    +------------------+    +--------------------+
   | 🧠 CLI     |--->| 🧠 Pipeline     |    | 🧠 Integrations   |
   |      |      |    |    Core          |    |  (Slack, future)   |
   |      v      |    |                  |    +--------+-----------+
   | 🧠 Install |--->+--+------+------+-+             |calls API
   |      |      |       |      |      |     +---------v----------+
   |      v      |  +----+   +--+--+   |     | 🧠 SpecAPI        |
   | 🧠 Templ.  |  v        v     v    |     +--------+-----------+
   +-------------+ +------+ +----+ +---+--+           |delegates
                   |🧠 Ex.| |🧠  | |🧠 Obs|  +--------v----------+
                   | ecut.| |Coord|         |  | 🧠 SpecEngine    |
                   +--+---+ +-----+ +-------+  +-------------------+
                      |        ^        ^
                      +--------+--------+----+
                      (imports on holds,     |
                       imports on milestones)|
                                      +------+-----+
                                      |🧠 Transport |
                                      +------+------+
                                             ^
                                      +------+-----+
                                      |🧠 Signals  |
                                      +-------------+
```

**Current direct dependencies (to be eliminated):**
- **Pipeline Core** is directly imported by most Minds — the single biggest decoupling effort
- **Execution** directly imports from **Coordination** (holds/questions) and **Observability** (milestones)
- **CLI** directly imports from **Installer** which directly reads from **Templates**
- **Signals** directly imports from **Transport**
- **SpecAPI** directly imports from **SpecEngine**
- **Integrations** calls **SpecAPI** via HTTP (this is already clean — no direct imports)
- **Pipelang** directly imports types from **Pipeline Core**

**In the target architecture:** every arrow in this diagram becomes a request through the parent Mind. No Mind imports from another Mind directly.

---

## How Vertical Features Compose

Example: "Add a new pipeline phase (deploy-verify)"

```
 Feature Request: "Add deploy-verify phase"
          |
          v
 Root Mind (node 0) receives the task
          |
          v  Uses hybrid search to build routing plan:
 +-- Parent Mind ------------------------------------------+
 |  Decomposes into subdomain work units per child Mind    |
 |  Verifies cross-Mind integration contracts              |
 +----+------+------+------+------+------+------+---------+
      |      |      |      |      |      |      |
      v      v      v      v      v      v      v
  Pipelang  Core  Exec.  Signals  Obs.  Install  Templ.
  --------  ----  -----  -------  ----  -------  ------
  Add DSL   Add   Add    Add      Add   Update   Add
  syntax    phase dispatch emit-  metric file    config
  for new   type  logic   deploy  hooks  mapping files
  phase     to    for     -verify for    for new for new
  modifier  types new     handler phase  artifacts phase
                  phase
```

The parent Mind:
1. Understands the full feature requirement
2. Decomposes into subdomain work units
3. Sends each child Mind its slice with interface contracts
4. Verifies cross-domain integration (signal names match, dispatch logic reads the right config field, etc.) — the parent knows its children's contracts, the children don't know each other

---

## Summary

| Mind | Scope | ~Lines | Key Exports |
|------|-------|--------|-------------|
| 🧠 **Router** | `minds/router/` | — | `handle()` + `describe()`, Mind discovery, hybrid search index |
| 🧠 **Pipelang** | `pipelang/` | 2,500 | `CompiledPipeline` JSON |
| 🧠 **Pipeline Core** | `src/lib/pipeline/` | 3,000 | Types, registry, signals, transitions |
| 🧠 **Execution** | `src/scripts/orchestrator/` (dispatch, gates, init) | 3,500 | Phase dispatch, gate eval, signal validation |
| 🧠 **Coordination** | `src/scripts/orchestrator/commands/` (holds, groups) | 1,500 | Multi-ticket holds, groups, batch Q&A |
| 🧠 **Observability** | `src/scripts/orchestrator/` (metrics, classify) | 1,500 | Metrics, run classification, PR creation |
| 🧠 **Signals** | `src/handlers/` + `src/hooks/` | 1,500 | Signal emission, message dispatch |
| 🧠 **Transport** | `transport/` | 3,000 | `Transport` interface, bus/tmux impls |
| 🧠 **CLI** | `src/cli/` + `cli/bin/` | 2,000 | `collab` binary, arg parsing, semver |
| 🧠 **Installer** | `*/installer.ts` + `collab.install.ts` | 800 | File mapping, distribution logic |
| 🧠 **Templates** | `cli/src/templates/` + `src/config/` | 2,500 | Distributable config & file assets |
| 🧠 **SpecEngine** | `src/services/` + `src/db/` | 1,200 | Spec generation, LLM, sessions, DB |
| 🧠 **SpecAPI** | `src/index.ts` + `src/routes/` | 500 | HTTP REST interface for spec generation |
| 🧠 **Integrations** | `src/plugins/slack/` (+ future) | 300 | Slack adapter (+ Discord, Teams, etc.) |

---

## Current State: Cross-Mind Import Analysis

Analysis performed by 3 independent agents tracing every TypeScript import that crosses a Mind boundary. All findings below were confirmed by at least 2 of 3 agents.

### Dependency Matrix

Which Minds import from which (rows import from columns):

| | Pipelang | Pipeline Core | Execution | Coordination | Observability | Signals | Transport |
|---|---|---|---|---|---|---|---|
| **Pipelang** | — | types, transitions | | | | | runner.ts |
| **Execution** | | **80+ imports** | — | coordination-check | classify, metrics | signal parsing | resolve-transport |
| **Coordination** | | utils, metadata | orchestrator-utils | — | | | |
| **Observability** | | metrics, classify, draft-pr, gate-accuracy, autonomy-rate | orchestrator-utils | | — | | |
| **Signals** | | loadPipelineForTicket | | | | — | resolve-transport |
| **CLI** | | repo-registry | | | | | |
| **Installer** | | | | | | | |
| **SpecAPI** | | | | | | | |
| **Integrations** | | | | | | | |

| | CLI | Installer | Templates | SpecEngine | SpecAPI | Integrations |
|---|---|---|---|---|---|---|
| **CLI** | — | install command | | | | |
| **Installer** | | — | reads templates | | | |
| **SpecAPI** | | | | **30+ imports** | — | conditional slack |
| **Integrations** | | | | | calls HTTP API | — |

### The Gravity Well: Pipeline Core

Pipeline Core is imported by **most Minds**. It is the single biggest coupling challenge.

**Most imported modules from Pipeline Core:**

| Module | Imported By | Key Symbols |
|---|---|---|
| `utils.ts` | Execution, Coordination, Observability, Signals, CLI | `getRepoRoot`, `readJsonFile`, `writeJsonAtomic`, `loadPipelineForTicket`, `validateTicketIdArg`, `findFeatureDir`, `readFeatureMetadata` |
| `metrics.ts` | Execution, Observability | `openMetricsDb`, `ensureRun`, `insertGate`, `recordPhase`, `insertIntervention`, `completeRun` |
| `registry.ts` | Execution | `ALLOWED_FIELDS`, `parseFieldValue`, `applyUpdates`, `appendPhaseHistory`, `advanceImplPhase` |
| `signal.ts` | Execution, Signals | `parseSignal`, `getAllowedSignals`, `resolveSignalName`, `SIGNAL_SUFFIXES`, `isSuccessSignal` |
| `transitions.ts` | Execution, Pipelang | `resolveTransition`, `resolveGateResponse`, `resolveConditionalTransition` |
| `paths.ts` | Execution, Coordination | `registryPath`, `signalQueuePath`, `findingsPath`, `resolutionsPath` |
| `questions.ts` | Execution, Coordination | `FindingsBatch`, `ResolutionBatch`, `Finding` |
| `repo-registry.ts` | Execution, CLI | `resolveRepoPath`, `readRepos`, `writeRepos`, `getReposFilePath` |
| `types.ts` | Pipelang, Execution | `CompiledPipeline`, `CompiledPhase`, `CompiledGate`, `CompiledTransition` |

### Cross-Mind Violations by Severity

**Critical (tight coupling, must decouple):**

1. **Execution → Pipeline Core (80+ imports)** — Every orchestrator script imports heavily from Pipeline Core. Functions like `getRepoRoot`, `loadPipelineForTicket`, `readJsonFile` are used everywhere. This is the single largest decoupling effort.

2. **Observability → Pipeline Core (20+ imports)** — All metrics/classify/dashboard scripts import `openMetricsDb`, `classifyRun`, `getAllAutonomyRates`, `createDraftPr`, `getGateAccuracyReport` from Pipeline Core modules.

3. **SpecAPI → SpecEngine (30+ imports)** — Routes directly call service functions. This is architecturally intentional (REST layer → business logic) but still a cross-Mind import.

**Moderate (clear path to decouple):**

4. **Signals → Pipeline Core** — `pipeline-signal.ts` imports `loadPipelineForTicket` from utils. `emit-phase-signal.ts` imports `resolveTransportPath`.

5. **Coordination → Pipeline Core** — `coordination-check.ts` imports `readFeatureMetadata`, `scanFeaturesMetadata`, etc.

6. **Pipelang → Pipeline Core** — `runner.ts` imports types (`CompiledPipeline`, `CompiledGate`) and transitions (`resolveGateResponse`, `resolveConditionalTransition`).

7. **CLI → Pipeline Core** — `repo/index.ts` imports `readRepos`, `writeRepos` from `repo-registry.ts`.

8. **Execution → Coordination** — `orchestrator-init.ts` imports `buildAdjacency`, `detectCycles`, `buildDependencyHolds`, `detectImplicitDependencies` from `coordination-check.ts`.

**Minor (test-only or bridging files):**

9. **Transport → Execution (circular)** — `bus-command-bridge.test.ts` imports `startBusServer`, `teardownBusServer` from Execution's `orchestrator-init.ts`. Test-only but still circular.

10. **Signals → Transport** — `emit-phase-signal.ts` dynamically imports `BusTransport` and `TmuxTransport` via `resolveTransportPath`.

### Bridging File: `src/lib/resolve-transport.ts`

Imported by both Execution and Signals, but itself reaches into Transport. All 3 agents flagged this. It doesn't belong to any single Mind. **Should move to Transport Mind** — it's Transport's responsibility to resolve which transport implementation to use.

### Orphaned / Unclaimed Files

| File | Current Location | Should Belong To |
|---|---|---|
| `src/lib/resolve-transport.ts` | Shared under `src/lib/` | Transport Mind |
| `src/lib/slack-retry.ts` | Orphaned, unused | Integrations Mind (or delete) |
| `src/statusline/collab-statusline.ts` | Standalone | Observability Mind |
| `src/scripts/resolve-feature.ts` | Under scripts | Execution Mind |
| `src/scripts/emit-findings.ts` | Under scripts | Signals Mind |
| `src/scripts/pre-deploy-summary.ts` | Under scripts | Execution Mind |
| `src/scripts/resolve-execution-mode.ts` | Under scripts | Execution Mind |
| `src/scripts/verify-and-complete.ts` | Under scripts | Execution Mind |

### Isolation Scorecard

How isolated is each Mind today (lower = more tangled):

| Mind | Inbound Deps | Outbound Deps | Isolation |
|---|---|---|---|
| Templates | 1 (Installer reads) | 0 | Fully isolated |
| Integrations | 1 (SpecAPI conditional) | 1 (calls SpecAPI HTTP) | Fully isolated |
| Transport | 1 (resolve-transport) | 0 | Nearly isolated |
| Pipelang | 0 | 2 (Pipeline Core, Transport) | Nearly isolated |
| Installer | 1 (CLI calls) | 1 (reads Templates) | Nearly isolated |
| SpecEngine | 1 (SpecAPI calls) | 0 | Clean boundary |
| CLI | 0 | 2 (Pipeline Core, Installer) | Low coupling |
| Signals | 0 | 2 (Pipeline Core, Transport) | Low coupling |
| Coordination | 1 (Execution calls) | 2 (Pipeline Core, Execution utils) | Moderate coupling |
| Observability | 0 | 2 (Pipeline Core, Execution utils) | Moderate coupling |
| SpecAPI | 0 | 2 (SpecEngine, Integrations) | Moderate coupling |
| Execution | 2 (Coordination, Transport test) | 4 (Pipeline Core, Coordination, Transport, Signals) | **Heavily coupled** |
| Pipeline Core | **8 importers** | 0 | **Gravity well** |

---

## Implementation Plan

Three layers: build the protocol, prove it with one Mind, then replicate across all Minds.

### Principle: No Utils, No Helpers

Every "shared" file gets decomposed into focused modules inside the Mind that owns it. `utils.ts` → split into `repo.ts`, `json-io.ts`, `pipeline.ts`, `feature.ts`, etc. within Pipeline Core. No file named `utils`, `helpers`, or `shared` survives the restructuring.

### Layer 1: Build the Protocol Infrastructure

Before moving a single file, build the Mind infrastructure that everything runs on.

**1a. Mind base interface**

```typescript
// minds/mind.ts — the universal Mind contract

interface Mind {
  /** Handle a work unit. The Mind decides internally how to fulfill it. */
  handle(workUnit: WorkUnit): Promise<WorkResult>;

  /** Describe this Mind's domain so the parent can build its search index. */
  describe(): MindDescription;
}

interface WorkUnit {
  request: string;        // natural language description of what's needed
  context?: unknown;      // optional structured data
  from?: string;          // which child sent this (for escalation tracking)
}

interface WorkResult {
  status: "handled" | "escalate";  // handled = done, escalate = send to parent
  data?: unknown;                   // result payload
  error?: string;
}

interface MindDescription {
  name: string;
  domain: string;
  keywords: string[];
  owns_files: string[];
  capabilities: string[];
}
```

Every Mind implements this interface. Leaf Minds, mid-level Minds, and the root Mind — all the same contract.

**1a-ii. Zero-boilerplate Mind creation**

Minds don't implement the interface manually. `server-base.ts` handles all the protocol machinery (MCP server, Streamable HTTP transport, parent registration, child discovery, escalation). Each Mind provides only what's unique: a description and a handler.

```typescript
// minds/server-base.ts — all protocol logic lives here, once

function createMind(config: {
  name: string;
  domain: string;
  keywords: string[];
  owns_files: string[];
  capabilities: string[];
  handle: (workUnit: WorkUnit) => Promise<WorkResult>;
}): Mind {
  // Internally: starts MCP server, registers with parent,
  // discovers children (if minds/ subdir exists), builds search index,
  // wires up handle() with escalation logic. Zero duplication.
}
```

Each Mind's `server.ts` is ~10 lines:

```typescript
// minds/signals/server.ts — the ONLY custom code per Mind

import { createMind } from "../server-base";

export default createMind({
  name: "signals",
  domain: "Agent-to-orchestrator signal emission and transport dispatch",
  keywords: ["signal", "emit", "phase", "event", "queue"],
  owns_files: ["minds/signals/"],
  capabilities: ["emit signals", "resolve signal names", "persist to queue"],

  async handle(workUnit) {
    // Mind-specific logic — the only thing that differs per Mind
  },
});
```

Every Mind uses this pattern, but the protocol code exists exactly once in `server-base.ts`.

**1b. Routing engine**

The routing engine runs inside any Mind that has children. It:

1. Calls `describe()` on each child at startup
2. Builds a BM25 index over child descriptions (keywords, domain, capabilities)
3. Generates vector embeddings of full descriptions (lightweight local model, e.g. all-MiniLM-L6-v2)
4. On incoming `handle()` call: runs hybrid search (BM25 30% + vector 70% + QMD-style reranking) to find the best child match
5. If match found → delegates `handle()` to that child
6. If no match → returns `{ status: "escalate" }` so the caller can send it up

```typescript
// minds/router.ts — routing logic, usable by any parent Mind

class MindRouter {
  private children: Map<string, Mind>;
  private index: HybridSearchIndex;

  async addChild(mind: Mind): Promise<void> {
    const desc = mind.describe();
    this.children.set(desc.name, mind);
    this.index.add(desc);
  }

  async route(workUnit: WorkUnit): Promise<WorkResult> {
    const match = this.index.search(workUnit.request);
    if (!match) return { status: "escalate" };

    const result = await this.children.get(match.name)!.handle(workUnit);
    if (result.status === "escalate") {
      // Child couldn't handle it either — try next match or escalate further
      return this.tryNextMatch(workUnit, match.name);
    }
    return result;
  }
}
```

**1c. Process management and discovery**

Convention-based: a parent Mind scans `minds/*/server.ts` relative to its own directory. Each child is started as a child process. Communication is via Streamable HTTP (MCP transport).

```typescript
// minds/discovery.ts — convention-based Mind discovery

async function discoverChildren(parentDir: string): Promise<Mind[]> {
  const entries = await readdir(join(parentDir, "minds"));
  const children: Mind[] = [];
  for (const entry of entries) {
    const serverPath = join(parentDir, "minds", entry, "server.ts");
    if (existsSync(serverPath)) {
      const child = await startChildProcess(serverPath);
      children.push(child);
    }
  }
  return children;
}
```

**1d. Tests for the protocol**

Before any Mind exists, test the protocol in isolation:
- A mock Mind that handles work units matching its domain
- A mock Mind that escalates everything
- A parent with two children: verify routing goes to the right child
- Escalation: child can't handle → parent tries next child → parent escalates to its parent
- Resolution order: self → children → parent

**Deliverable:** `minds/mind.ts`, `minds/router.ts`, `minds/discovery.ts`, `minds/server-base.ts`, and a full test suite. No application code moved yet. Pure infrastructure.

---

### Layer 2: Prove It — First Complete Mind

Build one Mind end-to-end to validate the entire protocol before replicating it.

**The proof-of-concept: SpecAPI (parent) + SpecEngine (child)**

Why this pair:
- **Validates parent-child.** SpecAPI is SpecEngine's parent — every HTTP request routes down to SpecEngine via `handle()`. This proves the delegation path.
- **Self-contained.** Own database, own Express server, no Pipeline Core gravity well. If something breaks, it's the protocol, not a tangled dependency.
- **Real cross-domain boundary.** HTTP parsing/validation (SpecAPI) vs business logic/DB (SpecEngine). A genuine domain split, not an artificial one.
- **Validates escalation.** If SpecEngine needs something outside its domain (unlikely today, but the protocol should handle it), it returns `{ status: "escalate" }` and SpecAPI forwards to its own parent.

**What gets built:**

```
minds/
  spec_api/
    server.ts            ← MCP server, implements Mind interface
    minds/
      spec_engine/
        server.ts        ← child Mind, implements Mind interface
        services/        ← moved from src/services/
        db/              ← moved from src/db/
        errors.ts        ← moved from src/lib/errors.ts
        validation.ts    ← moved from src/lib/validation.ts
        markdown.ts      ← moved from src/lib/markdown.ts
    index.ts             ← Express server (moved from src/index.ts)
    routes/              ← moved from src/routes/
    middleware.ts
    tests/
```

**Steps:**
1. Create `minds/spec_api/server.ts` — implements `Mind` interface, has `handle()` and `describe()`
2. Create `minds/spec_api/minds/spec_engine/server.ts` — implements `Mind` interface
3. Move files from `src/services/`, `src/db/`, `src/lib/{errors,validation,markdown}.ts` into SpecEngine
4. Move files from `src/index.ts`, `src/routes/` into SpecAPI
5. SpecAPI's `handle()` receives work units → uses its router to delegate to SpecEngine
6. SpecEngine's `handle()` receives work units → calls its internal service functions → returns results
7. Replace all direct SpecAPI → SpecEngine imports with `handle()` calls
8. All existing tests must pass
9. Add protocol-level tests: work unit routing, escalation, describe accuracy

**Success criteria:** The HTTP API works exactly as before, but internally SpecAPI delegates to SpecEngine via `handle()` instead of direct imports. No functional change visible to consumers.

---

### Layer 3: Replicate

With the protocol proven, move remaining Minds. Order is based on what validates the most new protocol surface, not isolation level.

**Wave A — Already isolated, straightforward moves:**

| Mind | Current Location | Move To | Protocol Work |
|---|---|---|---|
| Templates | `cli/src/templates/` + `src/config/` | `minds/templates/` | Implement `handle()` + `describe()`. Leaf Mind — handles or escalates, never routes down. |
| Integrations | `src/plugins/slack/` | `minds/integrations/` | Leaf Mind. Calls SpecAPI via HTTP (already decoupled). |
| Transport | `transport/` | `minds/transport/` | Leaf Mind. Absorb `resolve-transport.ts`. |
| Pipelang | `pipelang/` | `minds/pipelang/` | Leaf Mind. Type imports from Pipeline Core become `handle()` requests through parent at dev-time; direct imports at runtime (Rule 1). |

**Wave B — Validate sibling routing through parent:**

| Mind | Current Location | Move To | Protocol Work |
|---|---|---|---|
| Signals | `src/handlers/` + `src/hooks/` | `minds/signals/` | Replace direct Pipeline Core imports and Transport imports with `handle()` escalation to parent. First real test of sibling-to-sibling routing through parent. |
| CLI | `src/cli/` + `cli/bin/` | `minds/cli/` | Replace direct Pipeline Core imports with `handle()` escalation. |
| Installer | scattered installer files | `minds/installer/` | Replace direct Template reads with `handle()` requests through parent. |

**Wave C — Untangle the orchestrator directory:**

| Mind | Current Location | Move To | Protocol Work |
|---|---|---|---|
| Coordination | `src/scripts/orchestrator/commands/` (subset) | `minds/coordination/` | Separate from Execution files. Replace Pipeline Core imports with `handle()` escalation. |
| Observability | `src/scripts/orchestrator/` (subset) | `minds/observability/` | Same separation. Replace Pipeline Core and Execution utils imports. |

**Wave D — The gravity well:**

| Mind | Current Location | Move To | Protocol Work |
|---|---|---|---|
| Pipeline Core | `src/lib/pipeline/` | `minds/pipeline_core/` | Decompose `utils.ts` into focused internal modules (`repo.ts`, `json-io.ts`, `pipeline.ts`, `feature.ts`, `registry-paths.ts`, `validation.ts`, `types.ts`). These are now internal to Pipeline Core — no other Mind imports them. All access goes through `handle()`. |
| Execution | `src/scripts/orchestrator/` (remainder) | `minds/execution/` | Dissolve `orchestrator-utils.ts`. Replace 80+ Pipeline Core imports with `handle()` requests through parent. The single largest refactor. |

**Wave E — Build the Router Mind (root node):**

| Mind | Move To | Protocol Work |
|---|---|---|
| Router | `minds/router/` | Wire up as root Mind (node 0). Discover all other Minds via convention. Build hybrid search index. Register as `mcp__collab` with Claude Code. This is the last piece — everything else works via `handle()` already, the Router just provides the top-level entry point. |

### After Each Wave

1. All existing tests must pass (`bun test`)
2. New protocol tests for each Mind: `handle()` routing, `describe()` accuracy, escalation behavior
3. Verify no direct imports cross Mind boundaries (dev-time)
4. Commit the wave

### God File Decomposition: `src/lib/pipeline/utils.ts`

This file currently holds 15+ functions used by most Minds. ALL of them are Pipeline Core's responsibility. In Wave D, they split into focused internal modules:

```
minds/pipeline_core/
  repo.ts            ← getRepoRoot()
  json-io.ts         ← readJsonFile(), writeJsonAtomic()
  pipeline.ts        ← loadPipelineForTicket(), resolvePipelineConfigPath(), parsePipelineArgs()
  feature.ts         ← findFeatureDir(), readFeatureMetadata(), readMetadataJson(), scanFeaturesMetadata()
  registry-paths.ts  ← registryPath()
  validation.ts      ← validateTicketIdArg()
  types.ts           ← FeatureMetadata, LoadedPipeline interfaces
```

These are now **internal to Pipeline Core**. No other Mind imports them. Other Minds send `handle("load pipeline config for BRE-428")` through their parent, and Pipeline Core internally composes these functions to fulfill the request.

Similarly, `orchestrator-utils.ts` gets dissolved in Wave D — its Execution-specific helpers move into Execution Mind modules.

### Target Directory Structure

Every Mind has a `server.ts` (~10 lines) that calls `createMind()` with a description and handler. All protocol logic lives in the shared infrastructure files at the `minds/` root. No duplication.

```
minds/
  mind.ts                  ← Mind interface (handle, describe)
  router.ts                ← Routing engine (hybrid search, delegation, escalation)
  discovery.ts             ← Convention-based Mind discovery (scan minds/*/server.ts)
  server-base.ts           ← createMind() — all protocol machinery, once

  router/server.ts         ← root Mind (node 0), registered as mcp__collab
  pipelang/server.ts + src/ + tests/
  pipeline_core/server.ts + internal modules + tests/
  execution/server.ts + orchestrator scripts + tests/
  coordination/server.ts + coordination scripts + tests/
  observability/server.ts + metrics scripts + tests/
  signals/server.ts + emit handlers + tests/
  transport/server.ts + transport impls + tests/
  cli/server.ts + commands/ + lib/ + tests/
  installer/server.ts + install logic + tests/
  templates/server.ts + config/ + scripts/ + tests/
  integrations/server.ts + slack/ + tests/

  spec_api/                ← parent Mind — has children
    server.ts
    index.ts + routes/ + middleware.ts + tests/
    minds/                 ← child Minds (same convention at every level)
      spec_engine/
        server.ts
        services/ + db/ + tests/
```

**Key structural patterns:**
- `server.ts` in every Mind calls `createMind()` — description + handler only, ~10 lines
- `server-base.ts` handles MCP server, transport, parent registration, child discovery, escalation — once
- A Mind with children has a `minds/` subdirectory — same convention at every level of the tree
- SpecAPI/SpecEngine demonstrates the parent-child nesting pattern
- All other Minds are leaves today — they can gain children later by adding a `minds/` subdirectory
