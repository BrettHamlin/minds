# BRE-231: Pipeline DSL Review — Current State vs. Proposed Language

> **Ticket:** [BRE-231](https://linear.app/bretthamlin/issue/BRE-231/pipeline-dsl-fluent-language-and-lsp-that-compiles-to-pipelinejson)
> **Status:** Todo | Priority: High
> **Date:** 2026-02-21
> **Purpose:** Comprehensive gap analysis, edge case catalog, open questions, and alternative pattern suggestions

---

## Table of Contents

0. [Decision Log](#0-decision-log)
1. [Executive Summary](#1-executive-summary)
2. [Current State: pipeline.json v3](#2-current-state-pipelinejson-v3)
3. [Proposed State: .pipeline DSL](#3-proposed-state-pipeline-dsl)
4. [Construct-by-Construct Mapping](#4-construct-by-construct-mapping)
5. [Schema Gaps — What v3 Cannot Express](#5-schema-gaps--what-v3-cannot-express)
6. [Orchestrator Script Impact Analysis](#6-orchestrator-script-impact-analysis)
7. [Edge Cases and Ambiguities](#7-edge-cases-and-ambiguities)
8. [Open Questions](#8-open-questions)
9. [Alternative DSL Patterns](#9-alternative-dsl-patterns)
10. [Recommendations](#10-recommendations)

---

## 0. Decision Log

> All 11 schema gaps reviewed and decided on 2026-02-21. Decisions are binding for the compiler, LSP, and schema evolution work.

| # | Gap | Decision | Breaking |
|---|-----|----------|----------|
| 1 | `skipTo` location | Add `skip_to` field to gate objects in schema | No |
| 2 | `.escalate` exhaust mode | First-class mode: halt pipeline, notify user, await manual resume | No |
| 3 | `feedback` type | **Clean break** — string enum `"enrich" \| "raw"`, update existing gates | **Yes** |
| 4 | `display` source types | Object variants `{ "ai": "..." }` and `{ "file": "..." }` alongside plain string | No |
| 5 | Gate `prompt` source types | Object form `{ "file": "..." }` / `{ "inline": "..." }` alongside string path | No |
| 6 | `orchestratorContext` source types | Same as Gap 5 — object form alongside string | No |
| 7 | `on_exhaust` location | **Clean break** — move from gate-level into each `gateResponse` | **Yes** |
| 8 | `maxRetries` naming | Keep `max_retries` (snake_case) in JSON; compiler translates from DSL camelCase | No |
| 9 | Conditional transition compilation | Multiple ordered transition rows with `"if"` field per `when()` clause | No |
| 10 | Condition constants | Compiler registry of known conditions; unknown identifiers warn and fall through to AI | No |
| 11 | Token syntax | **Migrate runtime to `${}`** — update `resolve-tokens.ts` and all gate prompt files | No* |

> \* Gap 11 is not a schema breaking change, but it is a **runtime migration**: `resolve-tokens.ts` switches from `{{TOKEN}}` to `${TOKEN}` regex, and every file under `.collab/config/gates/` must be updated. This migration is in-scope for BRE-231.

**Breaking change summary:** Two fields change type/structure in `pipeline.v3.schema.json`. Any `pipeline.json` authored before this ticket must be updated before it will pass schema validation:
- `feedback: true` → `feedback: "enrich"` or `feedback: "raw"`
- `on_exhaust` moves from gate top-level into each retrying `gateResponse`

---

## 1. Executive Summary

BRE-231 introduces a fluent-interface DSL (`.pipeline` files, `pipelang` CLI) that compiles to `pipeline.json` v3. The relationship is compiler-frontend to existing IR — the JSON format remains the runtime representation, the DSL becomes the authoring surface.

**Key finding:** The DSL specifies constructs that do **not exist** in the current v3 schema. Implementing BRE-231 requires either (a) extending `pipeline.v3.schema.json` to accommodate new features like `skipTo`, `feedback` enums, `display` source types, and `.escalate` exhaust mode, or (b) defining a new v3.1/v4 schema that the compiler targets. The ticket does not call this out explicitly.

**Scope of changes:**

| Category | Status |
|----------|--------|
| New `.pipeline` parser (tree-sitter) | Entirely new |
| New compiler (`pipelang compile`) | Entirely new |
| New LSP server | Entirely new |
| New VS Code extension | Entirely new |
| `pipeline.v3.schema.json` updates | ~12 schema changes needed |
| Orchestrator script changes | 2-3 scripts need minor updates |
| Go engine changes | 0 (reads JSON, not DSL) |
| Token resolver changes | 1 (syntax alignment `${}` vs `{{}}`) |

---

## 2. Current State: pipeline.json v3

### 2.1 File Location and Runtime Behavior

- **Config:** `.collab/config/pipeline.json`
- **Schema:** `src/config/pipeline.v3.schema.json`
- **Consumers:** All orchestrator scripts (`phase-dispatch.sh`, `transition-resolve.sh`, `signal-validate.sh`, `goal-gate-check.sh`), Go engine (`collab/attractor/`)
- **Token resolution:** `src/handlers/resolve-tokens.ts` — uses `{{TOKEN}}` syntax

### 2.2 Current Schema Structure

```json
{
  "version": "3.0",
  "phases": [Phase],
  "gates": { [gateName]: Gate },
  "transitions": [Transition]
}
```

**Phase object:**
```json
{
  "id": "string (required)",
  "command": "string (shorthand, mutually exclusive with actions)",
  "actions": [Action],
  "signals": ["string"],
  "goal_gate": "always | if_triggered",
  "orchestrator_context": "string (file path)",
  "terminal": "boolean"
}
```

**Action object (oneOf):**
```json
{ "display": "string" }
{ "prompt": "string" }
{ "command": "string" }
```

**Gate object:**
```json
{
  "prompt": "string (file path)",
  "responses": { [keyword]: GateResponse },
  "on_exhaust": "skip | abort"
}
```

**GateResponse object:**
```json
{
  "to": "string (phase ID, optional — omit to retry)",
  "feedback": "boolean",
  "max_retries": "number"
}
```

**Transition object:**
```json
{
  "from": "string (phase ID)",
  "signal": "string",
  "to": "string (phase ID)",
  "gate": "string (gate name)",
  "if": "string (condition expression, optional)"
}
```

### 2.3 Current Pipeline Instance

The live `pipeline.json` defines 7 phases and 2 gates:

| Phase | Command/Actions | Signals | Special |
|-------|----------------|---------|---------|
| `clarify` | `/collab.clarify` | CLARIFY_COMPLETE, CLARIFY_QUESTION, CLARIFY_ERROR | — |
| `plan` | `/collab.plan` | PLAN_COMPLETE, PLAN_ERROR | — |
| `tasks` | `/collab.tasks` | TASKS_COMPLETE, TASKS_ERROR | — |
| `analyze` | `/collab.analyze` | ANALYZE_COMPLETE, ANALYZE_ERROR | — |
| `implement` | actions: display + command | IMPLEMENT_COMPLETE, IMPLEMENT_WAITING, IMPLEMENT_ERROR | — |
| `blindqa` | actions: display + command | BLINDQA_COMPLETE, BLINDQA_FAILED, BLINDQA_ERROR, BLINDQA_QUESTION, BLINDQA_WAITING | `goal_gate: "always"`, `orchestrator_context` set |
| `done` | — | [] | `terminal: true` |

**Gates:**

| Gate | Prompt | Responses | Exhaust |
|------|--------|-----------|---------|
| `plan_review` | `.collab/config/gates/plan.md` | APPROVED → tasks, REVISION_NEEDED → plan (feedback, 3 retries) | skip |
| `analyze_review` | `.collab/config/gates/analyze.md` | REMEDIATION_COMPLETE → implement, ESCALATION → retry (feedback) | abort |

**Transitions (11 total):**

| From | Signal | Route |
|------|--------|-------|
| clarify | CLARIFY_COMPLETE | → plan |
| plan | PLAN_COMPLETE | → gate:plan_review |
| plan | PLAN_ERROR | → plan |
| tasks | TASKS_COMPLETE | → analyze |
| tasks | TASKS_ERROR | → tasks |
| analyze | ANALYZE_COMPLETE | → gate:analyze_review |
| analyze | ANALYZE_ERROR | → analyze |
| implement | IMPLEMENT_COMPLETE | → blindqa |
| implement | IMPLEMENT_ERROR | → implement |
| blindqa | BLINDQA_COMPLETE | → done |
| blindqa | BLINDQA_FAILED | → blindqa |
| blindqa | BLINDQA_ERROR | → blindqa |

### 2.4 Token Resolution System

`resolve-tokens.ts` supports `{{TOKEN}}` syntax with three tiers:

| Tier | Pattern | Behavior | Tokens |
|------|---------|----------|--------|
| 1 | `{{ALL_CAPS_KNOWN}}` | Direct substitution from context JSON | TICKET_ID, TICKET_TITLE, PHASE, INCOMING_SIGNAL, INCOMING_DETAIL, BRANCH, WORKTREE |
| 2 | `{{ALL_CAPS_UNKNOWN}}` | Warn to stderr, substitute empty string | Any unknown ALL_CAPS |
| 3 | `{{lowercase/mixed}}` | Return unresolved for AI inline evaluation | Any non-ALL_CAPS |

**DSL proposes:** `${TOKEN}` syntax instead of `{{TOKEN}}`, and only 5 built-in variables (omits BRANCH, WORKTREE). This is a breaking change in token syntax.

---

## 3. Proposed State: .pipeline DSL

### 3.1 Language Design Principles

- **Fluent interface / modifier chain** pattern (Swift, Kotlin, SwiftUI)
- File IS the pipeline — no wrapper block
- Required params in `( )`, optional modifiers dot-chained
- `{ }` only for `actions` blocks and conditional `when/otherwise`
- Phase names are identifiers, not strings
- Signals and GateKeywords are typed constants

### 3.2 Complete DSL Syntax Reference (from ticket)

#### File-Level Constructs

| Construct | Purpose |
|-----------|---------|
| `@version("3.0")` | Schema version annotation |
| `phase(name)` | Declare a pipeline phase |
| `gate(name)` | Declare a pipeline gate |

#### Phase Modifiers (PhaseBuilder)

| Modifier | Parameters | Required | Current JSON Equivalent |
|----------|-----------|----------|------------------------|
| `.command(slashCommand)` | bare identifier or string | No | `phase.command` |
| `.goalGate(.always \| .ifTriggered)` | enum | No | `phase.goal_gate` |
| `.orchestratorContext(.file(path) \| .inline(text))` | sealed class | No | `phase.orchestrator_context` |
| `.terminal()` | none | No | `phase.terminal` |
| `.actions { ... }` | block | No | `phase.actions` |
| `.signals(Signal, ...)` | variadic typed constants | No | `phase.signals` |
| `.on(Signal, to: PhaseName)` | transition | No | `transitions[]` entry |
| `.on(Signal, gate: GateName)` | gate transition | No | `transitions[]` entry |
| `.on(Signal) { when/otherwise }` | conditional transition | No | `transitions[]` with `if` field |

#### Actions Block (ActionsBuilder)

| Action | Parameters | Behavior |
|--------|-----------|----------|
| `display("text")` | String with `${VAR}` interpolation | Orchestrator window only |
| `display(ai("expression"))` | AI-evaluated expression | Orchestrator window only |
| `display(.file("path"))` | File reference | Orchestrator window only |
| `prompt("instruction")` | String with `${VAR}` interpolation | Sent to agent, no wait |
| `command("/slash.cmd")` | Slash command | Sent to agent, waits for signal |

#### Gate Modifiers (GateBuilder)

| Modifier | Parameters | Required | Current JSON Equivalent |
|----------|-----------|----------|------------------------|
| `.prompt(.file(path) \| .inline(text))` | sealed class | Yes | `gate.prompt` (string path only) |
| `.skipTo(PhaseName)` | identifier | Conditional | **NOT IN CURRENT SCHEMA** |
| `.on(GateKeyword, to: PhaseName)` | routing | Yes (1+) | `gate.responses[keyword]` |
| `.on(GateKeyword, ..., feedback: .enrich \| .raw, maxRetries: Int, onExhaust: .escalate \| .skip \| .abort)` | full routing | No | Partial in `gate.responses` |

#### Conditional Transition Block (TransitionBuilder → RouteBuilder)

```
.on(SIGNAL) {
    when(condition and condition) { to = phase }
    when(condition or condition)  { to = gate(gateName) }
    otherwise                    { to = phase }
}
```

#### Type System

**Enums:**

| Type | Values | JSON Equivalent |
|------|--------|-----------------|
| GoalGate | `.always`, `.ifTriggered` | `"always"`, `"if_triggered"` |
| Feedback | `.enrich`, `.raw` | `true` (boolean only) |
| Exhaust | `.escalate`, `.skip`, `.abort` | `"skip"`, `"abort"` (no `.escalate`) |

**Sealed Classes:**

| Type | Variants | JSON Equivalent |
|------|----------|-----------------|
| DisplaySource | `.inline(String)`, `.ai(String)`, `.file(String)` | Plain string only |
| ContextSource | `.file(String)`, `.inline(String)` | Plain string (path) only |

**Typed Constants:**

| Type | Examples | JSON Equivalent |
|------|----------|-----------------|
| Signal | CLARIFY_COMPLETE, PLAN_ERROR | Plain strings |
| GateKeyword | APPROVED, REVISION_NEEDED | Plain strings (keys of responses object) |
| Condition | hasGroup, isBackend, retryCount | String in `if` field |

---

## 4. Construct-by-Construct Mapping

### 4.1 Phase Declaration

| DSL | JSON v3 | Status |
|-----|---------|--------|
| `phase(clarify)` | `{ "id": "clarify" }` | Direct mapping |
| `.command("/collab.clarify")` | `"command": "/collab.clarify"` | Direct mapping |
| `.signals(CLARIFY_COMPLETE, CLARIFY_ERROR)` | `"signals": ["CLARIFY_COMPLETE", "CLARIFY_ERROR"]` | Direct mapping (types → strings) |
| `.goalGate(.always)` | `"goal_gate": "always"` | Direct mapping (enum case name difference: `.ifTriggered` → `"if_triggered"`) |
| `.orchestratorContext(.file("path"))` | `"orchestrator_context": "path"` | Direct mapping for file variant; `.inline()` variant has no JSON representation |
| `.terminal()` | `"terminal": true` | Direct mapping |

### 4.2 Actions Block

| DSL | JSON v3 | Status |
|-----|---------|--------|
| `display("text")` | `{ "display": "text" }` | Direct mapping |
| `display(ai("expr"))` | — | **GAP: No JSON representation for AI expressions** |
| `display(.file("path"))` | — | **GAP: No JSON representation for file-sourced display** |
| `prompt("instruction")` | `{ "prompt": "instruction" }` | Direct mapping |
| `command("/slash.cmd")` | `{ "command": "/slash.cmd" }` | Direct mapping |

### 4.3 Transitions

| DSL | JSON v3 | Status |
|-----|---------|--------|
| `.on(SIGNAL, to: phase)` | `{ "from": "current", "signal": "SIGNAL", "to": "phase" }` | **Structural change:** DSL co-locates with phase; JSON has separate array. Compiler must extract. |
| `.on(SIGNAL, gate: gateName)` | `{ "from": "current", "signal": "SIGNAL", "gate": "gateName" }` | Same structural change |
| `.on(SIGNAL) { when(cond) { to = x } otherwise { to = y } }` | `{ "from": ..., "signal": ..., "if": "cond", "to": "x" }` + fallback row | **Structural change:** DSL has rich block syntax; JSON uses flat `if` field string. Compiler must decompose. |

**Critical note on conditional transitions:** The current JSON schema supports only a single `if` string field per transition row. The DSL supports multiple `when()` branches. The compiler must emit multiple transition rows (one per `when` clause + one for `otherwise`) from a single DSL `.on()` block. This has ordering implications — the JSON transitions array is ordered, and `transition-resolve.sh` already handles priority (conditional first, then plain fallback).

### 4.4 Gate Declaration

| DSL | JSON v3 | Status |
|-----|---------|--------|
| `gate(plan_review)` | `"plan_review": { ... }` | Direct mapping (name → key) |
| `.prompt(.file("path"))` | `"prompt": "path"` | Direct for file; `.inline()` **GAP** |
| `.skipTo(phase)` | — | **GAP: Not in schema** |
| `.on(APPROVED, to: tasks)` | `"APPROVED": { "to": "tasks" }` | Direct mapping |
| `feedback: .enrich` | `"feedback": true` | **GAP: Boolean in schema, enum in DSL** |
| `feedback: .raw` | `"feedback": true` | **GAP: No distinction** |
| `maxRetries: 3` | `"max_retries": 3` | Direct mapping (naming convention difference) |
| `onExhaust: .skip` | `"on_exhaust": "skip"` | Direct mapping |
| `onExhaust: .escalate` | — | **GAP: Not in schema** |
| `onExhaust: .abort` | `"on_exhaust": "abort"` | Direct mapping |

### 4.5 Token Resolution

| DSL | Current System | Status |
|-----|---------------|--------|
| `${TICKET_ID}` | `{{TICKET_ID}}` | **Breaking change in syntax** |
| `${PHASE}` | `{{PHASE}}` | **Breaking change** |
| `${INCOMING_SIGNAL}` | `{{INCOMING_SIGNAL}}` | **Breaking change** |
| `${INCOMING_DETAIL}` | `{{INCOMING_DETAIL}}` | **Breaking change** |
| `${TICKET_TITLE}` | `{{TICKET_TITLE}}` | **Breaking change** |
| `ai("expression")` | Tier 3: `{{lowercase expression}}` | **New explicit syntax for non-determinism** |
| — | `{{BRANCH}}` | **DSL drops BRANCH from built-in set** |
| — | `{{WORKTREE}}` | **DSL drops WORKTREE from built-in set** |

---

## 5. Schema Gaps — What v3 Cannot Express

These are features specified in BRE-231 that have no representation in `pipeline.v3.schema.json`:

### Gap 1: `skipTo` on Gates

**DSL:**
```
gate(plan_review)
    .skipTo(tasks)
```

**Schema:** No `skipTo` property on gate objects.

**Impact:** The compiler has nowhere to emit this value. Schema must add `"skip_to": { "type": "string" }` to the gate definition.

**Runtime impact:** `goal-gate-check.sh` and any gate evaluation logic would need to read `skip_to` to know where to route on skip exhaustion. Currently, skip behavior is implicit (the orchestrator AI figures it out from context).

> **DECIDED:** Add `"skip_to": { "type": "string" }` to the gate object in the schema. Gate evaluation code reads it explicitly when exhausting via skip. The LSP validates that `skipTo` is required on any gate where a response uses `onExhaust: .skip`.

### Gap 2: `onExhaust: .escalate`

**DSL:** Three exhaust modes — `.escalate`, `.skip`, `.abort`

**Schema:** Only two — `"skip"`, `"abort"`

**Impact:** Schema enum must add `"escalate"`. Orchestrator scripts must handle the new mode (halt pipeline, notify user, await manual intervention).

> **DECIDED:** Add `"escalate"` to the `on_exhaust` enum as a first-class value. Runtime behavior: halt the pipeline (registry status → `"escalated"`), notify the user with gate name + attempt count + ticket ID + synthesized diagnosis, and await a manual `/resume` command. Unlike `"abort"`, an escalated pipeline can be resumed. The orchestrator needs a new behavior branch and a corresponding resume path in the registry.

### Gap 3: Feedback Enum (`.enrich` vs `.raw`)

**DSL:** `feedback: .enrich` (AI cross-references against ACs) or `feedback: .raw` (verbatim)

**Schema:** `"feedback": boolean`

**Impact:** Schema must change from boolean to string enum `"enrich" | "raw" | false` or to an object. The Go engine's `ai_gate.go` handler currently treats feedback as a boolean flag — it would need to branch on the feedback type.

> **DECIDED (BREAKING):** Clean break — change `feedback` from `boolean` to string enum `"enrich" | "raw"`. No backwards compatibility shim. Update existing gates: `plan_review` → `"enrich"`, `analyze_review` → `"raw"`. The Go engine (`ai_gate.go`) branches on the string value. Any `pipeline.json` with `"feedback": true` fails schema validation after this change and must be migrated.

### Gap 4: Display Source Types

**DSL:**
```
display("text")           → DisplaySource.inline
display(ai("expression")) → DisplaySource.ai
display(.file("path"))    → DisplaySource.file
```

**Schema:** Action display is a plain string: `{ "display": "string" }`

**Impact:** Schema must change display action to support object form:
```json
{ "display": "string" }                          // inline (backwards compat)
{ "display": { "ai": "expression" } }            // ai expression
{ "display": { "file": "path/to/template.md" } } // file reference
```

`phase-dispatch.sh` currently prints display values directly to stdout. It would need to detect the object form and handle file reads and AI evaluation at dispatch time.

> **DECIDED:** Add object variants to the schema alongside the existing plain string. String form remains valid (backwards compatible). `phase-dispatch.sh` detects the type: plain string → print directly; `{ "ai": "..." }` → orchestrator evaluates at dispatch time; `{ "file": "..." }` → read file at dispatch time and print contents.

### Gap 5: Gate Prompt Source Types

**DSL:**
```
.prompt(.file("path"))
.prompt(.inline("text"))
```

**Schema:** `"prompt": "string"` (assumed to be a file path)

**Impact:** Schema should distinguish file vs inline. Either:
- Convention: strings are file paths (current behavior, inline not supported in JSON)
- Object form: `{ "file": "path" }` or `{ "inline": "text" }`

> **DECIDED:** Allow object form alongside the existing string. Plain string remains valid and is treated as a file path (backwards compatible). New object forms: `{ "file": "path" }` and `{ "inline": "text" }`. Gate evaluation code detects type at read time.

### Gap 6: `orchestratorContext` Inline Variant

**DSL:** `.orchestratorContext(.inline("text"))`

**Schema:** `"orchestrator_context": "string"` (assumed file path)

**Impact:** Same as Gap 5. Need to distinguish inline text from file path.

> **DECIDED:** Same resolution as Gap 5. Allow object form alongside string. `{ "file": "path" }` and `{ "inline": "text" }` both valid. Plain string continues to mean file path. Orchestrator context loading code handles both forms.

### Gap 7: `onExhaust` Per Response vs Per Gate

**DSL:** `onExhaust` is per `.on()` response:
```
.on(REVISION_NEEDED, to: plan, feedback: .enrich, maxRetries: 3, onExhaust: .skip)
.on(ESCALATION, to: plan, feedback: .raw, maxRetries: 1, onExhaust: .abort)
```

**Schema:** `on_exhaust` is per gate (top-level), not per response:
```json
{
  "responses": { "REVISION_NEEDED": {...}, "ESCALATION": {...} },
  "on_exhaust": "skip"  // applies to all responses
}
```

**Impact:** This is a significant structural mismatch. The DSL allows different exhaust behaviors per gate response keyword. The schema only allows one exhaust mode per gate. Schema must move `on_exhaust` into the response object, or the compiler must reject per-response exhaust variations.

> **DECIDED (BREAKING):** Clean break — remove `on_exhaust` from the gate top-level, add it to each `gateResponse` object. Only responses with `max_retries` need it. Responses without `max_retries` omit it entirely. Update both existing gates in `pipeline.json`: `plan_review.responses.REVISION_NEEDED` gets `"on_exhaust": "skip"`, gate-level `on_exhaust` removed. `analyze_review.responses.ESCALATION` gets `"on_exhaust": "abort"`, gate-level `on_exhaust` removed. Any `pipeline.json` with gate-level `on_exhaust` fails schema validation after this change.

### Gap 8: `max_retries` Per Response

**Schema already supports this** — `max_retries` is on `gateResponse`, not on `gate`. No gap here, but worth noting the DSL's naming convention uses `maxRetries` (camelCase) while JSON uses `max_retries` (snake_case).

> **DECIDED:** Keep `max_retries` (snake_case) in the JSON schema. The compiler silently translates `maxRetries` from the DSL surface to `max_retries` in the emitted JSON. No schema change needed. Consistent with all other snake_case field names (`goal_gate`, `orchestrator_context`, `on_exhaust`, `skip_to`).

### Gap 9: Conditional Transition `when/otherwise` Decomposition

**DSL:**
```
.on(IMPLEMENT_COMPLETE) {
    when(hasGroup and isBackend) { to = gate(deploy) }
    otherwise                   { to = blindqa }
}
```

**Schema:** Conditional transitions use a single `"if"` string field. Multiple `when` branches require multiple transition rows with different `if` values plus one row without `if` for `otherwise`.

**Impact:** The compiler must:
1. Decompose `when/otherwise` into multiple transition rows
2. Preserve ordering (conditional rows first, fallback last)
3. Serialize `when(hasGroup and isBackend)` into an `if` string value

`transition-resolve.sh` already handles this priority model — it checks conditional rows first, then falls back to plain rows. But the `if` field evaluation is delegated to the orchestrator AI (no deterministic condition evaluator exists).

> **DECIDED:** Compile each `when()` clause to a separate transition row with an `"if"` field containing the condition expression as a string. The `otherwise` clause compiles to a row with no `"if"` field. Array order in the emitted JSON preserves declaration order (conditionals before fallback). `transition-resolve.sh` requires no changes — it already implements this priority model.

### Gap 10: Named Conditions as Typed Constants

**DSL:** `when(hasGroup and isBackend)` uses `Condition` typed constants with infix `and/or`.

**Schema:** `"if"` is a plain string. No typed condition system.

**Impact:** The compiler can serialize conditions as strings (e.g., `"hasGroup and isBackend"`), which matches the current schema. But the DSL's compile-time validation of known condition names has no runtime counterpart — `transition-resolve.sh` just passes the `if` string to the AI.

> **DECIDED:** Compiler maintains a hardcoded registry of known condition constants (`hasGroup`, `isBackend`, `isFrontend`, `retryCount`, `deploymentStatus`). Known conditions get autocomplete and type-checking in the LSP. Unknown identifiers compile successfully but emit a warning: `"Unknown condition 'foo' — will be AI-evaluated at runtime."` No user-defined conditions in v1. Registry lives in `compiler/conditions.ts`.

### Gap 11: Version Annotation

**DSL:** `@version("3.0")` as a file-level annotation.

**Schema:** `"version": "3.0"` at top level.

**Impact:** Direct mapping. Compiler emits the annotation value as the JSON version field.

> **DECIDED:** No change needed. `@version("3.0")` compiles directly to `"version": "3.0"`. No schema change.

### Summary: Required Schema Changes

> All decisions finalized. The table below reflects what will actually be built.

| # | Change | Severity | Breaking | Decision |
|---|--------|----------|----------|----------|
| 1 | Add `skip_to` to gate | Medium | No | **Build it** |
| 2 | Add `"escalate"` to on_exhaust enum | Low | No | **Build it** (first-class with halt+resume) |
| 3 | Change feedback from boolean to string enum | **High** | **Yes** | **Clean break** — `"enrich" \| "raw"` |
| 4 | Extend display action to object form | Medium | No | **Build it** (string still valid) |
| 5 | Extend gate prompt to object form | Medium | No | **Build it** (string still valid) |
| 6 | Extend orchestrator_context to object form | Medium | No | **Build it** (string still valid) |
| 7 | Move on_exhaust from gate to response | **High** | **Yes** | **Clean break** — response-level only |
| 8 | maxRetries naming | None | No | **Compiler translates** — JSON stays snake_case |
| 9 | Conditional transition compilation | None | No | **Multiple rows** — existing script handles it |
| 10 | Condition constants | None | No | **Compiler registry** — warn on unknown |
| 11 | Token syntax migration | Medium | No* | **Migrate runtime to `${}`** — update resolve-tokens.ts + gate prompts |

---

## 6. Orchestrator Script Impact Analysis

### 6.1 Scripts That Read pipeline.json

Each orchestrator script is a **generic interpreter** — it reads its rules from `pipeline.json`. The DSL doesn't change these scripts directly, but schema changes do.

| Script | Reads | Impact from Schema Changes |
|--------|-------|---------------------------|
| `phase-dispatch.sh` | phases[].command, phases[].actions | Must handle new display object forms (Gap 4) |
| `transition-resolve.sh` | transitions[] | No change needed (already handles `if` field) |
| `signal-validate.sh` | phases[].signals | No change needed |
| `goal-gate-check.sh` | phases[].goal_gate, phases[].terminal | No change needed |
| `registry-update.sh` | — (writes only) | No change needed |
| `registry-read.sh` | — (reads registry, not pipeline) | No change needed |

### 6.2 Gate Evaluation Flow

Gate evaluation happens in the Go engine (`ai_gate.go`) and/or the orchestrator AI. Changes needed:

| Change | Location | Description |
|--------|----------|-------------|
| `skip_to` routing | Orchestrator (collab.run.md) | Must read `skip_to` from gate and route there on skip exhaustion |
| `.escalate` handling | Orchestrator + Go engine | New exhaust mode: halt, notify, await manual intervention |
| Feedback type routing | Go engine (`ai_gate.go`) | Branch on `"enrich"` vs `"raw"` instead of boolean |
| Per-response exhaust | Gate evaluation logic | Check exhaust mode per response keyword, not per gate |

### 6.3 Token Resolution

If the compiled JSON retains `{{TOKEN}}` syntax (which it should — the JSON is the runtime format), then `resolve-tokens.ts` needs no changes. The DSL uses `${TOKEN}` as authoring syntax, but the compiler should emit `{{TOKEN}}` in the JSON output.

**However**, if the intent is for `${TOKEN}` to be the runtime syntax too, then `resolve-tokens.ts` must be updated to recognize `${...}` patterns, and all existing `{{...}}` references in gate prompts and actions must be migrated.

---

## 7. Edge Cases and Ambiguities

### EC-1: Signal Declaration vs Reference Ordering

**Ambiguity:** The ticket says "Declared implicitly when referenced in `.signals(...)` on a phase." But the two-pass compiler collects all declarations first. What if a signal is used in `.on()` on phase A but declared in `.signals()` on phase B?

**Example:**
```
phase(plan)
    .on(CLARIFY_COMPLETE, to: tasks)  // Is this valid? CLARIFY_COMPLETE is declared on `clarify`, not `plan`

phase(clarify)
    .signals(CLARIFY_COMPLETE)
```

**Current JSON behavior:** Transitions reference signals freely across phases. `transition-resolve.sh` doesn't validate that a signal belongs to the `from` phase — it just pattern-matches.

**Question:** Should the DSL enforce that `.on(SIGNAL)` on a phase can only reference signals declared in THAT phase's `.signals()` list? The ticket's LSP validation says: "Signal 'PLAN_DONE' not declared for phase 'plan'." This implies yes — signals are scoped to their declaring phase.

**But wait:** In the current `pipeline.json`, transitions reference signals from the source phase. `.on(CLARIFY_COMPLETE)` on `clarify` references `clarify`'s own signal. This is consistent. The question is whether cross-phase signal references should be a compile error.

**Recommendation:** Enforce that `.on(SIGNAL)` can only appear on the phase that declares that signal in its `.signals()` list. This matches the current JSON model where `from` in a transition matches the phase that emits the signal.

### EC-2: Multiple `.on()` for the Same Signal

**Ambiguity:** Can a phase have two `.on()` handlers for the same signal?

```
phase(plan)
    .on(PLAN_COMPLETE, to: tasks)
    .on(PLAN_COMPLETE, gate: plan_review)  // Error or override?
```

**Current JSON:** Multiple transitions with the same `from` + `signal` are allowed (needed for conditional transitions). `transition-resolve.sh` picks the first match with priority rules.

**Recommendation:** Allow multiple `.on()` for the same signal ONLY in the block (conditional) form. Two direct `.on()` for the same signal should be a compile error. The block form with `when/otherwise` is the correct way to express conditional routing.

### EC-3: Chain Termination Rules

**Ambiguity:** "The chain belongs to the preceding declaration and ends when the next non-blank line does not start with a dot."

What about:
```
phase(clarify)
    .command("/collab.clarify")
// comment
    .signals(CLARIFY_COMPLETE)
```

Does the comment break the chain? What about:
```
phase(clarify)
    .command("/collab.clarify")

    .signals(CLARIFY_COMPLETE)  // blank line between modifiers
```

A blank line should terminate the chain per the spec. But users may add blank lines for readability within a phase declaration.

**Recommendation:** Define precisely: chain continues while the next NON-COMMENT, NON-BLANK line starts with `.` (after optional whitespace). Comments and blank lines within a chain are ignored. The chain terminates at the next `phase(...)`, `gate(...)`, or end-of-file.

### EC-4: `ai()` in Gate Prompts

**Ambiguity:** The ticket's LSP validation includes a warning: "AI expressions are not evaluated in gate prompt files." But the DSL allows `.prompt(.inline("text with ai(expr)"))`. Is `ai()` valid in inline gate prompts or only in `display()` strings?

**Recommendation:** `ai()` should be valid anywhere `display()` strings are valid. Gate prompts loaded from files are NOT parsed by the DSL (they're plain markdown), so `ai()` in those files is rightfully a warning. But inline prompts passed through the DSL should support `ai()`.

### EC-5: Gate `skipTo` Validation

**Ambiguity:** The ticket says `skipTo` is "required when any `.on()` uses `onExhaust: .skip`." But what if `skipTo` is provided and NO response uses `.skip`? Is that an error, warning, or ignored?

**Recommendation:** Unused `skipTo` should be a warning ("skipTo declared but no response uses onExhaust: .skip"). Not an error — it's harmless and may be intentional for future-proofing.

### EC-6: Empty Actions Block

**Ambiguity:** Is `actions { }` (empty block) valid?

**Recommendation:** Warning. An empty actions block is likely a mistake. If a phase needs no actions, omit the block entirely.

### EC-7: Signal Naming Conventions

**Ambiguity:** Are signal names constrained to `PHASE_STATUS` format? The current system uses `CLARIFY_COMPLETE`, `BLINDQA_FAILED`, etc. Can users declare `MY_CUSTOM_SIGNAL`?

**Current behavior:** `signal-validate.sh` uses regex `[A-Z_]+` — any ALL_CAPS_UNDERSCORE name is valid.

**Recommendation:** No naming convention enforcement at the DSL level. Signals are typed constants — the name is the identity. Convention can be enforced by linting rules, not the compiler.

### EC-8: Circular Transitions

**Ambiguity:** Can the DSL detect circular transition paths that would cause infinite loops?

```
phase(a)
    .on(A_ERROR, to: b)

phase(b)
    .on(B_ERROR, to: a)
```

**Current behavior:** No cycle detection in `pipeline.json` or any orchestrator script. Cycles are "valid" — self-loops (retry on error) are the most common pattern.

**Recommendation:** Do NOT error on cycles. Self-loops and mutual error-retry loops are intentional patterns. The compiler should detect cycles and emit an INFO diagnostic, not an error.

### EC-9: Phase Ordering in Output

**Ambiguity:** Does the order of `phase()` declarations in the `.pipeline` file determine the order of phases in the compiled `pipeline.json`? The JSON schema uses an array, so order is preserved.

**Recommendation:** Yes — declaration order in the DSL determines array order in the JSON output. This matters for display purposes and for `goal-gate-check.sh` which iterates phases in array order.

### EC-10: Multi-File Support

**Ambiguity:** The ticket describes a single `.pipeline` file. Can a pipeline be split across multiple files? Imports?

**Current behavior:** Single `pipeline.json` file.

**Recommendation:** v1 should support single-file only. Multi-file (imports) is a v2 feature. Document this as an explicit non-goal.

### EC-11: `@version` Mismatch

**Ambiguity:** What happens if the `@version` annotation doesn't match the compiler's expected version?

**Recommendation:** Error. The compiler targets a specific schema version. A mismatched `@version` means the file was written for a different compiler version.

### EC-12: Unnamed/Anonymous Transitions

**Ambiguity:** In the current JSON, the `CLARIFY_QUESTION` signal on `clarify` transitions back to `clarify` (self-loop). In the DSL:

```
phase(clarify)
    .on(CLARIFY_QUESTION, to: clarify)  // Explicit self-reference
```

Is self-referencing the phase's own name valid? It reads oddly but is semantically correct.

**Recommendation:** Valid. Self-references are the standard retry pattern. The compiler should not warn on `to: clarify` within `phase(clarify)`.

### EC-13: Gate Response Without `to`

**Current behavior:** In `pipeline.json`, `gate.responses.ESCALATION` omits `to` to mean "retry current phase."

**DSL equivalent:**
```
gate(analyze_review)
    .on(ESCALATION, feedback: .raw)  // no `to:` — retry
```

Is omitting `to:` valid in the DSL? The ticket's gate `.on()` syntax shows `to: PhaseName` as seemingly required.

**Recommendation:** `to:` should be optional. Omitting it means "retry the phase that triggered this gate." This matches current JSON behavior.

### EC-14: `display()` with Template Interpolation and `ai()` Combined

**Ambiguity:** Can you mix `${VAR}` interpolation and `ai()` in the same display string?

```
display("${TICKET_ID} — ${ai('summarize the current phase status')}")
```

Or must `ai()` be the sole argument?

**Recommendation:** `ai()` should be a standalone argument to `display()`, not embeddable in interpolated strings. Mixing deterministic interpolation with non-deterministic AI evaluation in one string is confusing. Use two separate display calls:
```
display("${TICKET_ID} — Phase status:")
display(ai("summarize the current phase status"))
```

### EC-15: Whitespace Sensitivity

**Ambiguity:** Is indentation significant? The examples show 4-space indentation for modifiers, but is it required?

**Recommendation:** Indentation is not significant. The parser should accept any whitespace before `.` modifier chains. However, the formatter/pretty-printer should enforce consistent 4-space indentation.

---

## 8. Open Questions

### Q1: Should the compiled JSON use `${TOKEN}` or `{{TOKEN}}`?

The DSL uses `${TOKEN}` for template interpolation. The current runtime (`resolve-tokens.ts`) uses `{{TOKEN}}`. Two options:

- **Option A:** Compiler emits `{{TOKEN}}` — runtime doesn't change, DSL syntax is authoring-only
- **Option B:** Compiler emits `${TOKEN}` — runtime must be updated, all existing gate prompts and action strings must migrate

**Recommendation:** Option A. The JSON is the runtime format consumed by existing scripts. Don't break the runtime for a syntactic preference.

### Q2: What happens to unhandled signals?

If a phase declares `.signals(A, B, C)` but only has `.on(A, ...)` and `.on(B, ...)`, signal C has no transition. Is this:

- A compile error? (Strict — forces complete routing)
- A warning? (Permissive — allows signals for logging/tracking)
- Ignored? (Loose — no validation)

**Current behavior:** No validation in `pipeline.json`. Unhandled signals cause `transition-resolve.sh` to exit with code 2 ("No transition found"). The orchestrator AI then decides what to do.

**Recommendation:** Warning, not error. Some signals (like `BLINDQA_QUESTION`, `BLINDQA_WAITING`) are informational and don't need routing. But unhandled signals should be flagged.

### Q3: Should the DSL support comments?

The ticket doesn't mention comments. Comments are essential for any DSL.

**Recommendation:** Support `//` single-line comments and `/* ... */` block comments. Tree-sitter grammars handle this easily.

### Q4: Should the compiler preserve source locations?

Source maps (like JavaScript source maps) allow the LSP to map JSON positions back to DSL positions when debugging at runtime.

**Recommendation:** Not for v1. Useful but not essential. The primary debugging surface is the `.pipeline` file, not the compiled JSON.

### Q5: How does `pipelang` integrate with the install/distribution system?

Currently, `pipeline.json` lives at `.collab/config/pipeline.json` and is distributed by `scripts/install.sh`. Where does the `.pipeline` source file live?

**Options:**
- `src/config/pipeline.pipeline` — source, compiled to `.collab/config/pipeline.json` on install
- `.collab/config/pipeline.pipeline` — co-located with output
- Root: `pipeline.pipeline` — top-level project file

**Recommendation:** `src/config/pipeline.pipeline` as source of truth. `install.sh` runs `pipelang compile` to produce `.collab/config/pipeline.json`. This keeps the source → compiled flow clean.

### Q6: What is the `ai()` evaluation runtime?

The DSL marks `ai("expression")` as non-deterministic. But what evaluates it at runtime?

**Current system:** `resolve-tokens.ts` leaves Tier 3 tokens unresolved for "AI inline evaluation." But no code actually performs this evaluation — it's delegated to the orchestrator AI reading the resolved template.

**Question:** Does `ai()` compile to a special JSON marker that the orchestrator recognizes? Or does it compile to a Tier 3 token?

**Recommendation:** Compile `ai("expr")` to `{{expr}}` (Tier 3 token) in the JSON. The existing runtime already handles this — Tier 3 tokens are left unresolved for AI evaluation. The `ai()` wrapper is a compile-time annotation, not a runtime construct.

### Q7: How does `pipelang compile --validate` fit into CI?

The ticket specifies `--validate` as a CI gate. But what CI system does collab use? Is there a `.github/workflows/` or similar?

**Recommendation:** Document the CI integration as a separate concern. The compiler outputs exit code 0/1 — any CI system can use it.

### Q8: What are the exact `Condition` constants?

The ticket lists `hasGroup`, `isBackend`, `isFrontend`, `retryCount`, `deploymentStatus` as known conditions. But:

- Where are they defined? In the DSL grammar? In a config file?
- Can users define custom conditions?
- How does `retryCount` work syntactically? Is `retryCount > 3` valid?

**Current system:** The `if` field on transitions is a plain string evaluated by the orchestrator AI. There's no condition parser.

**Recommendation:** Define a small set of built-in conditions with clear semantics. Unknown conditions fall through to AI evaluation (as the ticket states). But the compiler should have a registry of known conditions to provide autocomplete and type checking.

### Q9: How does the DSL handle the existing `clarify` → `plan` transition that has no gate?

In the current JSON:
```json
{"from": "clarify", "signal": "CLARIFY_COMPLETE", "to": "plan"}
```

In the DSL, this becomes:
```
phase(clarify)
    .on(CLARIFY_COMPLETE, to: plan)
```

But `CLARIFY_QUESTION` routes to `clarify` (self-loop). There's no transition for `CLARIFY_ERROR` in the JSON. What should the DSL do about unrouted errors that aren't in the transitions array?

**Current behavior:** CLARIFY_ERROR has no transition row. If it fires, `transition-resolve.sh` returns "No transition found" (exit 2). The orchestrator handles it ad-hoc.

**Recommendation:** The DSL should make this explicit. If `CLARIFY_ERROR` is in `.signals()` but has no `.on()`, the LSP warns about it (see Q2).

### Q10: Tree-sitter vs. Hand-Written Parser?

The ticket specifies tree-sitter. Tree-sitter is excellent for syntax highlighting and IDE features but generates C parsers. The compiler is in TypeScript. Options:

- `web-tree-sitter` (WASM) for the LSP + compiler — same parser, two runtimes
- Hand-written recursive descent parser in TypeScript for the compiler, tree-sitter for the LSP
- Tree-sitter for everything via `web-tree-sitter`

**Recommendation:** Use tree-sitter for the grammar definition and `web-tree-sitter` for both the LSP and compiler. Single source of truth for parsing.

---

## 9. Alternative DSL Patterns

The ticket proposes a **fluent modifier chain** pattern. Here are alternative patterns with tradeoffs.

### 9.1 Current Proposal: Fluent Modifier Chain

```
phase(clarify)
    .command("/collab.clarify")
    .signals(CLARIFY_COMPLETE, CLARIFY_QUESTION, CLARIFY_ERROR)
    .on(CLARIFY_COMPLETE, to: plan)
    .on(CLARIFY_QUESTION, to: clarify)
    .on(CLARIFY_ERROR,    to: clarify)
```

**Pros:**
- Familiar to Swift/Kotlin developers
- Highly readable for linear chains
- Natural autocomplete (type `.` → see all modifiers)
- No nesting for simple cases

**Cons:**
- Chain termination is whitespace-dependent ("next non-blank line not starting with `.`")
- Mixing `.on()` (transitions) with `.command()` (config) in one chain blurs concerns
- Conditional transitions require suddenly switching to `{ }` blocks — inconsistent with the rest of the modifier chain
- No visual grouping — a phase with 12 modifiers is a wall of dots
- Hard to grep/search for all transitions in a file (spread across phase declarations)

### 9.2 Alternative A: SwiftUI-Style Declarative Blocks

```
@version("3.0")

Phase("clarify") {
    Command("/collab.clarify")

    Signals {
        CLARIFY_COMPLETE
        CLARIFY_QUESTION
        CLARIFY_ERROR
    }

    Transitions {
        CLARIFY_COMPLETE -> plan
        CLARIFY_QUESTION -> clarify
        CLARIFY_ERROR    -> clarify
    }
}

Phase("implement") {
    GoalGate(.ifTriggered)

    Actions {
        Display("Starting implement for ${TICKET_ID}")
        Command("/collab.implement")
    }

    Signals {
        IMPLEMENT_COMPLETE
        IMPLEMENT_WAITING
        IMPLEMENT_ERROR
    }

    Transitions {
        IMPLEMENT_COMPLETE -> blindqa
        IMPLEMENT_COMPLETE when hasGroup and isBackend -> Gate(deploy)
        IMPLEMENT_ERROR -> implement
    }
}

Gate("plan_review") {
    Prompt(file: ".collab/config/gates/plan.md")
    SkipTo(tasks)

    Responses {
        APPROVED -> tasks
        REVISION_NEEDED -> plan {
            feedback: .enrich
            maxRetries: 3
            onExhaust: .skip
        }
    }
}
```

**Pros:**
- Clear visual hierarchy — nested blocks show structure
- `Transitions` section is visually distinct from configuration
- `->` arrow syntax for transitions is intuitive
- `when` conditions read naturally inline
- Easy to grep for all transitions (`grep "->"`)
- Each section (Signals, Transitions, Actions) is clearly delimited
- Familiar to SwiftUI, Jetpack Compose, Flutter developers

**Cons:**
- More verbose than the fluent chain
- More nesting levels
- Requires `{ }` even for simple phases

### 9.3 Alternative B: HCL-Style (Terraform/Nomad)

```
version = "3.0"

phase "clarify" {
  command = "/collab.clarify"
  signals = ["CLARIFY_COMPLETE", "CLARIFY_QUESTION", "CLARIFY_ERROR"]

  on "CLARIFY_COMPLETE" { to = "plan" }
  on "CLARIFY_QUESTION" { to = "clarify" }
  on "CLARIFY_ERROR"    { to = "clarify" }
}

phase "implement" {
  goal_gate = "always"

  actions {
    display "Starting implement for ${TICKET_ID}"
    command "/collab.implement"
  }

  signals = ["IMPLEMENT_COMPLETE", "IMPLEMENT_WAITING", "IMPLEMENT_ERROR"]

  on "IMPLEMENT_COMPLETE" {
    when "hasGroup and isBackend" { to = "deploy" via = gate }
    otherwise                    { to = "blindqa" }
  }
  on "IMPLEMENT_ERROR" { to = "implement" }
}

gate "plan_review" {
  prompt  = file(".collab/config/gates/plan.md")
  skip_to = "tasks"

  on "APPROVED"         { to = "tasks" }
  on "REVISION_NEEDED"  {
    to         = "plan"
    feedback   = "enrich"
    max_retries = 3
    on_exhaust = "skip"
  }
}
```

**Pros:**
- Battle-tested pattern (Terraform has millions of users)
- Extremely readable — no operator overloading or method chaining
- `on` blocks are self-contained and clear
- Maps almost 1:1 to JSON output structure
- Easy to write a parser (HCL-style grammars are well-understood)
- Naturally handles both simple (`on "SIGNAL" { to = "x" }`) and complex (conditional) cases
- `file()` function call for file references is clean

**Cons:**
- Strings everywhere — loses type safety of the proposed DSL
- No strong distinction between signals and gate keywords
- Less familiar to Swift/Kotlin developers
- No `.` autocomplete affordance

### 9.4 Alternative C: Arrow/Flow-Based

```
@version("3.0")

// Phases
clarify:    /collab.clarify      [CLARIFY_COMPLETE, CLARIFY_QUESTION, CLARIFY_ERROR]
plan:       /collab.plan         [PLAN_COMPLETE, PLAN_ERROR]
tasks:      /collab.tasks        [TASKS_COMPLETE, TASKS_ERROR]
implement:  /collab.implement    [IMPLEMENT_COMPLETE, IMPLEMENT_WAITING, IMPLEMENT_ERROR]
blindqa:    /collab.blindqa      [BLINDQA_COMPLETE, BLINDQA_FAILED, BLINDQA_ERROR] goal_gate:always
done:       terminal

// Flow
clarify   --CLARIFY_COMPLETE-->  plan
clarify   --CLARIFY_QUESTION-->  clarify
plan      --PLAN_COMPLETE-->     gate:plan_review
plan      --PLAN_ERROR-->        plan
tasks     --TASKS_COMPLETE-->    analyze
implement --IMPLEMENT_COMPLETE--> blindqa
blindqa   --BLINDQA_COMPLETE-->  done

// Gates
gate plan_review:
    prompt: file(".collab/config/gates/plan.md")
    skip_to: tasks
    APPROVED         --> tasks
    REVISION_NEEDED  --> plan  [feedback:enrich, retries:3, exhaust:skip]
```

**Pros:**
- Extremely visual — the flow section reads like a state machine diagram
- Transitions are all in one place — easy to see the whole pipeline topology
- Compact for simple pipelines
- `-->` arrows make transitions unmistakable
- Close to how state machines are drawn on whiteboards

**Cons:**
- Hard to scale to complex pipelines (conditional transitions, actions blocks)
- Splits phase definition from its transitions (back to the JSON structural model)
- Actions blocks don't fit the compact syntax
- Less tool-friendly (autocomplete is harder with arrow syntax)
- Custom parser required (no existing grammar pattern)

### 9.5 Alternative D: Hybrid — Block Declarations + Fluent Transitions

This combines the best of the SwiftUI and fluent approaches:

```
@version("3.0")

phase clarify {
    command: /collab.clarify
    signals: CLARIFY_COMPLETE, CLARIFY_QUESTION, CLARIFY_ERROR
}
    -> CLARIFY_COMPLETE: plan
    -> CLARIFY_QUESTION: clarify
    -> CLARIFY_ERROR: clarify

phase plan {
    command: /collab.plan
    signals: PLAN_COMPLETE, PLAN_ERROR
}
    -> PLAN_COMPLETE: gate(plan_review)
    -> PLAN_ERROR: plan

phase implement {
    goal_gate: .always
    actions {
        display("Starting implement for ${TICKET_ID}")
        command("/collab.implement")
    }
    signals: IMPLEMENT_COMPLETE, IMPLEMENT_WAITING, IMPLEMENT_ERROR
}
    -> IMPLEMENT_COMPLETE {
        when hasGroup and isBackend: gate(deploy)
        otherwise: blindqa
    }
    -> IMPLEMENT_ERROR: implement

phase done { terminal }

gate plan_review {
    prompt: file(".collab/config/gates/plan.md")
    skip_to: tasks

    APPROVED: -> tasks
    REVISION_NEEDED: -> plan {
        feedback: .enrich
        max_retries: 3
        on_exhaust: .skip
    }
}
```

**Pros:**
- Phase config is in a block (visually grouped, easy to scan)
- Transitions are visually distinct with `->` prefix
- Transitions are co-located with their source phase (like the fluent proposal)
- Conditional transitions use the same `{ when/otherwise }` as the original
- Gate responses use the familiar `->` arrow
- `{ terminal }` is cleaner than `.terminal()`
- No long modifier chains — the block handles config, arrows handle flow

**Cons:**
- Two syntactic styles in one language (blocks + arrows)
- Slightly unfamiliar — doesn't match any single existing pattern
- The `}` then `->` transition feels like it could be inside or outside the block

### 9.6 Comparison Matrix

| Criterion | Proposed (Fluent) | A (SwiftUI) | B (HCL) | C (Arrow) | D (Hybrid) |
|-----------|:-:|:-:|:-:|:-:|:-:|
| Readability for simple phases | 5/5 | 4/5 | 4/5 | 5/5 | 4/5 |
| Readability for complex phases | 3/5 | 5/5 | 4/5 | 2/5 | 4/5 |
| Conditional transition clarity | 3/5 | 4/5 | 4/5 | 2/5 | 4/5 |
| Pipeline topology visibility | 2/5 | 3/5 | 3/5 | 5/5 | 4/5 |
| IDE autocomplete potential | 5/5 | 4/5 | 3/5 | 2/5 | 3/5 |
| Type safety potential | 5/5 | 4/5 | 2/5 | 2/5 | 3/5 |
| Parser complexity | 3/5 | 4/5 | 4/5 | 2/5 | 3/5 |
| Familiarity (existing patterns) | 4/5 | 5/5 | 5/5 | 3/5 | 3/5 |
| Scales to 20+ phases | 3/5 | 4/5 | 5/5 | 4/5 | 4/5 |
| Compiles cleanly to JSON | 3/5 | 4/5 | 5/5 | 4/5 | 4/5 |
| **Total** | **36** | **41** | **39** | **31** | **36** |

### 9.7 Recommendation

**Alternative A (SwiftUI-Style)** scores highest overall. Its main advantages:

1. **Visual hierarchy** — blocks make it obvious where one phase ends and another begins
2. **Section clarity** — Signals, Transitions, Actions are visually separate sections
3. **Scales well** — a 20-phase pipeline remains readable because each phase is self-contained
4. **Conditional transitions** — `when` conditions inline with `->` arrows read naturally
5. **Familiar** — the declarative block pattern is used by SwiftUI, Jetpack Compose, Flutter, and modern UI frameworks

**However**, the proposed fluent chain has a significant advantage in IDE autocomplete — typing `.` after a phase immediately shows available modifiers. This is a real workflow benefit.

**Suggested synthesis:** Use the SwiftUI block structure for phase/gate declarations, but keep the `->` arrow syntax for transitions (from Alternative D). This gets the visual clarity of blocks, the flow visibility of arrows, and can still provide good autocomplete within blocks.

---

## 10. Recommendations

### 10.1 Pre-Implementation: Schema Evolution

Before writing any DSL code, update `pipeline.v3.schema.json` (or create v3.1) to support all DSL features:

1. Add `skip_to` to gate objects
2. Add `"escalate"` to `on_exhaust` enum
3. Change `feedback` from boolean to `"enrich" | "raw" | false`
4. Extend action `display` to support object form `{ "ai": ... }` and `{ "file": ... }`
5. Move `on_exhaust` from gate-level to response-level
6. Add `"inline"` variant support for gate prompt and orchestrator_context

This is a prerequisite. The compiler needs a valid target schema.

### 10.2 Token Syntax Decision

Decide upfront: Does the compiled JSON use `{{TOKEN}}` (current) or `${TOKEN}` (new)?

**Recommendation:** Keep `{{TOKEN}}` in JSON. The DSL uses `${TOKEN}` as authoring sugar. The compiler translates `${TOKEN}` → `{{TOKEN}}` during emission.

### 10.3 Implementation Order (Adjusted)

The ticket's proposed order is correct but should be preceded by:

0. **Evolve `pipeline.v3.schema.json`** — define the compilation target first
1. Tree-sitter grammar
2. Builder type hierarchy
3. Two-pass compiler
4. LSP server
5. VS Code extension
6. CI integration test

### 10.4 Test Strategy

The ticket's AC9 ("full BRE-228 pipeline expressed in `.pipeline` compiles to semantically equivalent JSON") is the critical integration test. The current `pipeline.json` should be the reference:

1. Write `pipeline.pipeline` expressing the current 7-phase, 2-gate, 11-transition pipeline
2. Compile it
3. Diff against current `pipeline.json` (after schema evolution)
4. Assert semantic equivalence

### 10.5 Consider the DSL Alternatives Seriously

The fluent modifier chain is workable but has weaknesses in visual grouping and conditional transitions. Consider Alternative A (SwiftUI-Style) or Alternative D (Hybrid) before committing to the grammar — changing the grammar after tree-sitter and LSP are built is extremely expensive.

---

## Appendix A: Current pipeline.json Expressed in Proposed DSL

```
@version("3.0")

phase(clarify)
    .command("/collab.clarify")
    .signals(CLARIFY_COMPLETE, CLARIFY_QUESTION, CLARIFY_ERROR)
    .on(CLARIFY_COMPLETE, to: plan)
    .on(CLARIFY_QUESTION, to: clarify)
    .on(CLARIFY_ERROR,    to: clarify)

phase(plan)
    .command("/collab.plan")
    .signals(PLAN_COMPLETE, PLAN_ERROR)
    .on(PLAN_COMPLETE, gate: plan_review)
    .on(PLAN_ERROR,    to: plan)

phase(tasks)
    .command("/collab.tasks")
    .signals(TASKS_COMPLETE, TASKS_ERROR)
    .on(TASKS_COMPLETE, to: analyze)
    .on(TASKS_ERROR,    to: tasks)

phase(analyze)
    .command("/collab.analyze")
    .signals(ANALYZE_COMPLETE, ANALYZE_ERROR)
    .on(ANALYZE_COMPLETE, gate: analyze_review)
    .on(ANALYZE_ERROR,    to: analyze)

phase(implement)
    .actions {
        display("Starting implement phase for ${TICKET_ID}: ${TICKET_TITLE}")
        command("/collab.implement")
    }
    .signals(IMPLEMENT_COMPLETE, IMPLEMENT_WAITING, IMPLEMENT_ERROR)
    .on(IMPLEMENT_COMPLETE, to: blindqa)
    .on(IMPLEMENT_ERROR,    to: implement)

phase(blindqa)
    .goalGate(.always)
    .orchestratorContext(.file(".collab/config/orchestrator-contexts/blindqa.md"))
    .actions {
        display("${TICKET_ID} — Starting Blind QA verification phase")
        command("/collab.blindqa")
    }
    .signals(BLINDQA_COMPLETE, BLINDQA_FAILED, BLINDQA_ERROR, BLINDQA_QUESTION, BLINDQA_WAITING)
    .on(BLINDQA_COMPLETE, to: done)
    .on(BLINDQA_FAILED,   to: blindqa)
    .on(BLINDQA_ERROR,    to: blindqa)

phase(done)
    .terminal()

gate(plan_review)
    .prompt(.file(".collab/config/gates/plan.md"))
    .skipTo(tasks)
    .on(APPROVED,        to: tasks)
    .on(REVISION_NEEDED, to: plan, feedback: .enrich, maxRetries: 3, onExhaust: .skip)

gate(analyze_review)
    .prompt(.file(".collab/config/gates/analyze.md"))
    .on(REMEDIATION_COMPLETE, to: implement)
    .on(ESCALATION,           feedback: .raw)
```

**Notes on this translation:**
- `IMPLEMENT_WAITING`, `BLINDQA_QUESTION`, `BLINDQA_WAITING` are declared in `.signals()` but have no `.on()` handler — these would trigger LSP warnings per Q2
- `analyze_review` gate has no `skipTo` because its exhaust mode is `.abort` (not `.skip`)
- The DSL's `ESCALATION` response on `analyze_review` omits `to:` — this means retry (matching current JSON behavior where `ESCALATION` has `feedback: true` but no `to`)

## Appendix B: Current pipeline.json Expressed in SwiftUI Alternative (9.2)

```
@version("3.0")

Phase("clarify") {
    Command("/collab.clarify")

    Signals {
        CLARIFY_COMPLETE
        CLARIFY_QUESTION
        CLARIFY_ERROR
    }

    Transitions {
        CLARIFY_COMPLETE -> plan
        CLARIFY_QUESTION -> clarify
        CLARIFY_ERROR    -> clarify
    }
}

Phase("plan") {
    Command("/collab.plan")

    Signals {
        PLAN_COMPLETE
        PLAN_ERROR
    }

    Transitions {
        PLAN_COMPLETE -> Gate(plan_review)
        PLAN_ERROR    -> plan
    }
}

Phase("tasks") {
    Command("/collab.tasks")

    Signals {
        TASKS_COMPLETE
        TASKS_ERROR
    }

    Transitions {
        TASKS_COMPLETE -> analyze
        TASKS_ERROR    -> tasks
    }
}

Phase("analyze") {
    Command("/collab.analyze")

    Signals {
        ANALYZE_COMPLETE
        ANALYZE_ERROR
    }

    Transitions {
        ANALYZE_COMPLETE -> Gate(analyze_review)
        ANALYZE_ERROR    -> analyze
    }
}

Phase("implement") {
    Actions {
        Display("Starting implement phase for ${TICKET_ID}: ${TICKET_TITLE}")
        Command("/collab.implement")
    }

    Signals {
        IMPLEMENT_COMPLETE
        IMPLEMENT_WAITING
        IMPLEMENT_ERROR
    }

    Transitions {
        IMPLEMENT_COMPLETE -> blindqa
        IMPLEMENT_ERROR    -> implement
    }
}

Phase("blindqa") {
    GoalGate(.always)
    OrchestratorContext(file: ".collab/config/orchestrator-contexts/blindqa.md")

    Actions {
        Display("${TICKET_ID} — Starting Blind QA verification phase")
        Command("/collab.blindqa")
    }

    Signals {
        BLINDQA_COMPLETE
        BLINDQA_FAILED
        BLINDQA_ERROR
        BLINDQA_QUESTION
        BLINDQA_WAITING
    }

    Transitions {
        BLINDQA_COMPLETE -> done
        BLINDQA_FAILED   -> blindqa
        BLINDQA_ERROR    -> blindqa
    }
}

Phase("done") {
    Terminal
}

Gate("plan_review") {
    Prompt(file: ".collab/config/gates/plan.md")
    SkipTo(tasks)

    Responses {
        APPROVED -> tasks
        REVISION_NEEDED -> plan {
            feedback: .enrich
            maxRetries: 3
            onExhaust: .skip
        }
    }
}

Gate("analyze_review") {
    Prompt(file: ".collab/config/gates/analyze.md")

    Responses {
        REMEDIATION_COMPLETE -> implement
        ESCALATION {
            feedback: .raw
        }
    }
}
```

## Appendix C: Finalized Schema Changes (v3.1)

> These are the **decided** schema changes, incorporating all gap decisions from 2026-02-21.

```jsonc
// pipeline.v3.schema.json → pipeline.v3.1.schema.json
// Changes annotated with gap number and decision outcome

// ── BREAKING: Gap 3 ───────────────────────────────────────────────────────────
// feedback: boolean → string enum. NO backwards compat. Migrate existing JSON.
"feedback": {
    "type": "string",
    "enum": ["enrich", "raw"],
    "description": "enrich = AI cross-references gate finding against ticket ACs and generates correction guidance. raw = verbatim gate response text sent back to agent."
}
// MIGRATION: "feedback": true → "feedback": "enrich"

// ── BREAKING: Gap 7 ───────────────────────────────────────────────────────────
// on_exhaust moves from gate top-level into gateResponse. Remove from gate.
// gate object: REMOVE "on_exhaust" property entirely.
// gateResponse object: ADD "on_exhaust" (optional, only needed with max_retries)
"gateResponse": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
        "to": {
            "type": "string",
            "description": "Target phase ID. Omit to retry current phase."
        },
        "feedback": {
            "type": "string",
            "enum": ["enrich", "raw"],
            "description": "Feedback mode when this response triggers a retry"
        },
        "max_retries": {
            "type": "number",
            "minimum": 0,
            "description": "Max retries before on_exhaust fires"
        },
        "on_exhaust": {
            "type": "string",
            "enum": ["skip", "abort", "escalate"],
            "description": "Required when max_retries is set. skip=advance via gate.skip_to. abort=terminate run. escalate=halt+notify+await manual resume."
        }
    }
}
// MIGRATION: gate-level "on_exhaust": "skip" → move into the retrying response

// ── Gap 1 (additive) ──────────────────────────────────────────────────────────
// skip_to added to gate. Required when any response uses on_exhaust: "skip".
"gate": {
    "type": "object",
    "required": ["prompt", "responses"],
    "additionalProperties": false,
    "properties": {
        "prompt": { /* see Gap 5 */ },
        "skip_to": {
            "type": "string",
            "description": "Phase to route to when a response exhausts via on_exhaust: skip. Required if any response uses skip."
        },
        "responses": {
            "type": "object",
            "additionalProperties": { "$ref": "#/$defs/gateResponse" }
        }
        // NOTE: on_exhaust removed from here (Breaking: Gap 7)
    }
}

// ── Gap 2 (additive) ──────────────────────────────────────────────────────────
// "escalate" added to on_exhaust enum (shown in gateResponse above).
// Runtime: halt pipeline (status="escalated"), notify user with diagnosis,
//          await /resume command. Pipeline CAN be resumed (unlike "abort").

// ── Gap 4 (additive, backwards compat) ───────────────────────────────────────
// display action: string OR object { ai: string } OR { file: string }
"action": {
    "type": "object",
    "oneOf": [
        {
            "required": ["display"],
            "additionalProperties": false,
            "properties": {
                "display": {
                    "oneOf": [
                        {
                            "type": "string",
                            "description": "Inline text shown in orchestrator window (supports ${TOKEN} interpolation)"
                        },
                        {
                            "type": "object",
                            "oneOf": [
                                {
                                    "required": ["ai"],
                                    "additionalProperties": false,
                                    "properties": {
                                        "ai": { "type": "string", "description": "Expression evaluated by orchestrator at runtime; result displayed as plain text" }
                                    }
                                },
                                {
                                    "required": ["file"],
                                    "additionalProperties": false,
                                    "properties": {
                                        "file": { "type": "string", "description": "File path read at dispatch time; contents displayed" }
                                    }
                                }
                            ]
                        }
                    ]
                }
            }
        },
        {
            "required": ["prompt"],
            "additionalProperties": false,
            "properties": {
                "prompt": { "type": "string", "description": "Sent to agent immediately, no signal wait" }
            }
        },
        {
            "required": ["command"],
            "additionalProperties": false,
            "properties": {
                "command": { "type": "string", "description": "Sent to agent; orchestrator waits for signal" }
            }
        }
    ]
}

// ── Gap 5 (additive, backwards compat) ───────────────────────────────────────
// gate prompt: string (file path) OR object { file } OR { inline }
"prompt": {
    "oneOf": [
        {
            "type": "string",
            "description": "File path (backwards compatible)"
        },
        {
            "type": "object",
            "oneOf": [
                {
                    "required": ["file"],
                    "additionalProperties": false,
                    "properties": { "file": { "type": "string" } }
                },
                {
                    "required": ["inline"],
                    "additionalProperties": false,
                    "properties": { "inline": { "type": "string" } }
                }
            ]
        }
    ]
}

// ── Gap 6 (additive, backwards compat) ───────────────────────────────────────
// orchestrator_context: string (file path) OR object { file } OR { inline }
"orchestrator_context": {
    "oneOf": [
        {
            "type": "string",
            "description": "File path (backwards compatible)"
        },
        {
            "type": "object",
            "oneOf": [
                {
                    "required": ["file"],
                    "additionalProperties": false,
                    "properties": { "file": { "type": "string" } }
                },
                {
                    "required": ["inline"],
                    "additionalProperties": false,
                    "properties": { "inline": { "type": "string" } }
                }
            ]
        }
    ]
}

// ── Gap 11 (runtime migration, not schema) ────────────────────────────────────
// Token syntax: resolve-tokens.ts migrates from {{TOKEN}} to ${TOKEN}.
// All gate prompt files under .collab/config/gates/ must be updated.
// Schema unchanged — token syntax is a string convention, not a schema concern.
```

## Appendix D: Files That Will Change

> Updated to reflect finalized decisions from 2026-02-21.

| File | Change Type | Reason |
|------|-------------|--------|
| `src/config/pipeline.v3.schema.json` | **Modify → rename v3.1** | 7 schema changes (2 breaking, 5 additive) |
| `.collab/config/pipeline.json` | **Modify + eventually replaced** | Migrate breaking fields now; replaced by compiler output post-BRE-231 |
| `src/scripts/orchestrator/phase-dispatch.sh` | **Modify** | Handle new display object forms (`{ ai }`, `{ file }`) |
| `src/handlers/resolve-tokens.ts` | **Modify** | Migrate regex from `{{TOKEN}}` to `${TOKEN}` (Gap 11 decision) |
| `.collab/config/gates/plan.md` | **Modify** | Replace `{{TOKEN}}` with `${TOKEN}` throughout |
| `.collab/config/gates/analyze.md` | **Modify** | Replace `{{TOKEN}}` with `${TOKEN}` throughout |
| `collab/attractor/handlers/ai_gate.go` | **Modify** | Branch on `feedback: "enrich"` vs `"raw"` instead of boolean; handle per-response `on_exhaust`; handle `"escalate"` mode |
| **NEW:** `src/config/pipeline.pipeline` | **Create** | DSL source file (canonical authoring form) |
| **NEW:** `tools/pipelang/` | **Create** | Compiler (`pipelang compile`), tree-sitter grammar, two-pass validator |
| **NEW:** `tools/pipelang/compiler/conditions.ts` | **Create** | Known condition constants registry (Gap 10) |
| **NEW:** `tools/pipelang-lsp/` | **Create** | LSP server (TypeScript, vscode-languageserver-node + web-tree-sitter) |
| **NEW:** `extensions/vscode-pipeline/` | **Create** | VS Code extension (syntax highlighting, LSP client, `ai()` token styling) |
| `scripts/install.sh` | **Modify** | Add `pipelang compile src/config/pipeline.pipeline` step |
| `collab/attractor/handlers/ai_gate.go` | **Modify** | Handle feedback enum, per-response exhaust |
| **NEW:** `src/config/pipeline.pipeline` | **Create** | DSL source file |
| **NEW:** `cli/pipelang/` or `tools/pipelang/` | **Create** | Compiler + LSP |
| **NEW:** `grammar/` or `tree-sitter-pipeline/` | **Create** | Tree-sitter grammar |
| **NEW:** `extensions/vscode-pipeline/` | **Create** | VS Code extension |
| `scripts/install.sh` | **Modify** | Add `pipelang compile` step |
