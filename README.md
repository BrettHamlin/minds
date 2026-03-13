# 🧠 Minds

Minds is an AI agent orchestration system that installs into any git repo. It decomposes features into parallel workstreams — one per domain — each run by a dedicated AI agent that owns its files and coordinates through typed contracts.

---

## How it works

### The three-layer model

```
🧠 Minds (domain agents)    — own files, implement work, enforce boundaries
🛸 Drones                   — one Claude Code instance per Mind, runs in tmux + worktree
🪄 Orchestrator             — routes tasks, manages phase transitions, aggregates status
```

A **🧠 Mind** is a domain module: a definition of what it owns (`MIND.md`), an MCP server (`server.ts`), and an implementation library (`lib/`). Minds expose typed interfaces and declare what they consume from other Minds.

A **🛸 Drone** is an ephemeral Claude Code agent spawned for a specific ticket. It receives a scoped task list, works only within its Mind's file boundaries, and signals completion back to the 🪄 orchestrator.

The **🪄 Orchestrator** (Router Mind) discovers all installed 🧠 Minds, routes incoming work units using a hybrid BM25 + vector search index, manages dependency holds between Minds, and coordinates merge order at the end of a wave.

---

## Workflow

### Stage 1 — Partition your codebase (Fission)

Fission analyzes your dependency graph, detects natural domain clusters, and scaffolds a 🧠 Mind for each one. Cross-cutting files go into a Foundation Mind; everything else is partitioned into non-overlapping domain Minds.

**5-stage pipeline:** Extract imports → Detect hubs → Cluster (Leiden algorithm) → Name domains → Scaffold 🧠 Minds

Supported languages: TypeScript, JavaScript, Go, Python, Rust, Swift, Kotlin, Java, C#, C/C++

Run from inside Claude Code in your repo:

```
Use the Fission skill to analyze this codebase and create domain Minds
```

Or run the CLI directly:

```
minds fission .
minds fission . --dry-run
```

---

### Stage 2 — Generate tasks

```
/minds.tasks <TICKET-ID>
```

Reads your spec and plan from `specs/<TICKET-ID>/`, identifies which 🧠 Minds are involved, and generates a task list scoped to each Mind's domain. Output: `specs/<TICKET-ID>/tasks.md`.

---

### Stage 3 — Implement in parallel

```
/minds.implement <TICKET-ID>
```

Dispatches each 🧠 Mind's tasks to a dedicated 🛸 drone. Drones run in parallel, each in its own tmux pane and git worktree. When all 🛸 drones in a wave complete, the 🪄 orchestrator verifies contracts, resolves conflicts, and merges — then the next wave begins.

Waves allow complex features to be broken into sequential phases (e.g., schema first, then API, then UI) while maximizing parallelism within each phase.

For multi-repo workspaces, 🧠 Minds are installed into each repo independently. Each repo's Minds are scoped to that repo's domain, and the 🪄 orchestrator coordinates across all of them — dispatching, tracking, and merging per-repo in a single unified wave.

```
  Ticket
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Wave 1                                                 │
│                                                         │
│  client/                      server/                   │
│  ├── [🧠 Mind: UI]            ├── [🧠 Mind: API]        │
│  │    └── 🛸 Drone ───────────│────── 🛸 Drone          │
│  ├── [🧠 Mind: State]         ├── [🧠 Mind: Auth]       │
│  │    └── 🛸 Drone            │    └── 🛸 Drone         │
│  └── [🧠 Mind: Components]    └── [🧠 Mind: DB]         │
│       └── 🛸 Drone                 └── 🛸 Drone         │
│                                                         │
│  ◀──────────── 🪄 Orchestrator ─────────────▶           │
│         routes · tracks · merges per-repo               │
└─────────────────────────────────────────────────────────┘
    │  all 🛸 drones complete + contracts verified
    ▼
┌─────────────────────────────────────────────────────────┐
│  Wave 2  (next phase begins)                            │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

---

## Features

- **Domain-aware parallelism** — Work is partitioned by codebase domain, not by task type. Each agent owns a slice of the repo and can't touch anything outside it.
- **Automatic codebase partitioning (Fission)** — Analyzes your dependency graph and scaffolds a Mind for each domain automatically. You don't define the agents; the code defines them.
- **🛸 Drones in isolation** — Each drone runs in a dedicated tmux pane + git worktree, so parallel work never collides.
- **Structured coordination** — Agents communicate through typed interface contracts (`exposes`/`consumes`), not freeform chat. The 🪄 orchestrator enforces boundaries.
- **Spec-to-tasks-to-implementation pipeline** — A single workflow takes a ticket spec all the way to parallel implementation with no manual decomposition.
- **Waves** — 🧠 Minds within a phase run in parallel; when the wave completes, the next wave begins. Complex features decompose into sequential phases with maximum parallelism within each.
- **Multi-repo support** — 🧠 Minds install into each repo independently. A single ticket can dispatch waves across a client repo and a server repo simultaneously, with the 🪄 orchestrator tracking and merging each independently.
- **Live dashboard** — SSE-based status view showing all 🛸 drone states in real time.

---

## Installation

**Requirements:** [Bun](https://bun.sh) >= 1.0, [tmux](https://github.com/tmux/tmux), [Claude Code](https://claude.ai/code), Git

```bash
minds init
```

Installs into the current repo:

- `.minds/` — Core 🧠 Minds + shared infrastructure + 🪄 orchestration layer
- `.claude/commands/` — `/minds.tasks` and `/minds.implement` slash commands
- `.claude/skills/Fission/` — Codebase partitioning skill
- `.minds/dashboard/` — Live 🛸 drone status SPA

---

## Development

```bash
scripts/run-tests.sh              # full test suite
scripts/run-tests.sh minds/lib/   # single directory
bun minds/cli/bin/minds.ts lint-boundaries  # check cross-Mind import violations
```

See [`docs/TESTING.md`](docs/TESTING.md) for coverage map and E2E instructions.

---

## License

MIT
