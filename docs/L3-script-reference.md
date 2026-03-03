# L3 — Script & File Reference

**Last verified**: 2026-02-21

This document provides function-level documentation for every script, handler, config file, command, and template in the collab codebase. Every entry was verified by reading the source file directly.

---

## Table of Contents

1. [Orchestrator Scripts](#1-orchestrator-scripts)
2. [Utility Scripts](#2-utility-scripts)
3. [Signal Handlers](#3-signal-handlers)
4. [Hooks](#4-hooks)
5. [Config Files](#5-config-files)
6. [Phase Commands](#6-phase-commands)
7. [Workflow Scripts](#7-workflow-scripts)
8. [Templates](#8-templates)

---

## 1. Orchestrator Scripts

All orchestrator scripts live in `src/scripts/orchestrator/` and are deployed to `.collab/scripts/orchestrator/`.

---

### orchestrator-init.sh

**Path**: `src/scripts/orchestrator/orchestrator-init.sh`
**Language**: Bash
**Purpose**: Deterministic orchestrator initialization. Validates pipeline schema, runs coordination checks, resolves worktree paths, sets up symlinks, spawns an agent pane via tmux, and creates the ticket registry file.
**Called by**: `/collab.run` command (Setup step 3)
**Dependencies**: `jq`, `bunx ajv-cli`, `git`, `bun`, `Tmux.ts`, `coordination-check.sh`, pipeline.json, pipeline.v3.schema.json

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (TICKET_ID) | Yes | Ticket identifier (e.g., BRE-168) |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Schema validation failed or schema file missing |

**Output**: Three lines to stdout for the orchestrator to parse:
- `AGENT_PANE=%N` (tmux pane ID)
- `NONCE=xxxxx` (5-char hex nonce)
- `REGISTRY=path/to/registry.json`

**Key Logic**:
1. Validates `pipeline.v3.schema.json` exists and runs `bunx ajv-cli validate` against `pipeline.json`.
2. Scans existing registry files to build a session ticket list, then runs `coordination-check.sh` with all ticket IDs.
3. Resolves the main repo root (handling worktree case via `git rev-parse --show-superproject-working-tree`).
4. Scans `specs/*/metadata.json` for matching `ticket_id` to find the `worktree_path`.
5. Creates `.claude/` and `.collab/` symlinks in the worktree pointing back to the main repo.
6. Splits the orchestrator's tmux pane horizontally (70%) using `Tmux.ts split` and labels it.
7. Generates a random 5-char hex nonce, reads the first phase ID from `pipeline.json`, and atomically writes the registry JSON (tmp + mv).

---

### phase-dispatch.sh

**Path**: `src/scripts/orchestrator/phase-dispatch.sh`
**Language**: Bash
**Purpose**: Read a phase's command from pipeline.json, check coordination.json for hold conditions, and send the command to the agent pane via Tmux.ts. This is a generic interpreter -- adding or renaming phases requires NO changes to this script.
**Called by**: `/collab.run` orchestrator (Setup step 5, Signal Processing advance step, Command Processing)
**Dependencies**: `jq`, `bun`, `Tmux.ts`, `registry-update.sh`, pipeline.json, registry files, coordination.json (optional)

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (TICKET_ID) | Yes | Ticket identifier |
| `$2` (PHASE_ID) | Yes | Phase to dispatch (e.g., "clarify", "plan") |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Dispatched successfully (or held -- check stdout for `HELD:` prefix) |
| 1 | Usage error (missing arguments) |
| 2 | Validation error (phase not found in pipeline.json) |
| 3 | File error (registry or pipeline.json missing) |

**Output**: One of:
- `Dispatched <phase_id> to <agent_pane>: <command>` (success)
- `HELD: <ticket_id> at <phase_id> -- waiting for <dep_id>:<dep_phase>` (coordination hold)
- `Phase '<phase_id>' has no dispatchable command (terminal or no-op).` (terminal phase)

**Key Logic**:
1. Reads the agent pane ID from the ticket registry.
2. Checks `specs/{ticket_id}/coordination.json` for `wait_for` dependencies. For each dependency, checks the dependency ticket's `phase_history` for a `_COMPLETE` signal on the required phase. If unsatisfied, updates registry to `status=held` and exits.
3. Resolves the phase command: supports both `command` shorthand (single string) and `actions` array (sequence of display/prompt/command actions).
4. For `command`: sends via `Tmux.ts send` with 5-second delay.
5. For `actions`: iterates each action -- `display` prints to stdout, `prompt`/`command` sends to agent pane with 1-second delay.

---

### phase-advance.sh

**Path**: `src/scripts/orchestrator/phase-advance.sh`
**Language**: Bash
**Purpose**: Determine the next phase after the current phase completes by reading the phase sequence from pipeline.json. Pure function with no side effects.
**Called by**: Not directly called by the orchestrator (the orchestrator uses transition-resolve.ts instead for routing). Available as a utility.
**Dependencies**: `jq`, `git`, pipeline.json

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (current_phase) | Yes | Current phase name (e.g., "clarify") |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error (missing argument) |
| 2 | Validation error (invalid phase name) |
| 3 | File error (pipeline.json missing or malformed) |

**Output**: Next phase name to stdout (e.g., "plan"), or "done" if pipeline is complete.

**Key Logic**:
1. Returns "done" immediately if current phase is "done" (sentinel).
2. Finds the index of the current phase in the `phases` array.
3. Returns `phases[index + 1].id`, or "done" if at the last phase.

---

### transition-resolve.sh

**Path**: `src/scripts/orchestrator/transition-resolve.sh`
**Language**: Bash
**Purpose**: Look up the matching transition in pipeline.json given a current phase and incoming signal type. Returns the target phase and/or gate information as JSON.
**Called by**: Orchestrator signal processing (the `.ts` version is preferred)
**Dependencies**: `jq`, `git`, pipeline.json

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (CURRENT_PHASE) | Yes | Current phase name |
| `$2` (SIGNAL_TYPE) | Yes | Incoming signal type (e.g., "CLARIFY_COMPLETE") |
| `$3` | No | `--plain` to skip conditional rows |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Match found |
| 1 | Usage error |
| 2 | No matching transition found |
| 3 | File error (pipeline.json missing or malformed) |

**Output**: JSON object to stdout, e.g.:
```json
{"to": "tasks", "gate": null, "if": null, "conditional": false}
```

**Key Logic**:
1. Filters transitions by matching `from` and `signal` fields.
2. Priority rules (FR-014): conditional rows (with `if` field) evaluated first, then plain rows.
3. With `--plain` flag, conditional rows are skipped entirely.

---

### transition-resolve.ts

**Path**: `src/scripts/orchestrator/transition-resolve.ts`
**Language**: TypeScript (Bun)
**Purpose**: TypeScript equivalent of transition-resolve.sh. Exports the `resolveTransition()` pure function for use by other TypeScript scripts, and provides identical CLI behavior.
**Called by**: `/collab.run` orchestrator signal processing (step c)
**Dependencies**: `orchestrator-utils.ts`, pipeline.json

**Arguments**: Same as the `.sh` version.

**Exit Codes**: Same as the `.sh` version.

**Exported Functions**:
- `resolveTransition(currentPhase, signalType, pipeline, plainOnly?)`: Returns `TransitionResult | null`. Pure function with no I/O.

**Output**: Same JSON format as the `.sh` version.

---

### signal-validate.sh

**Path**: `src/scripts/orchestrator/signal-validate.sh`
**Language**: Bash
**Purpose**: Parse signal strings from agent panes, validate against the ticket registry (nonce match, phase correctness), and output structured JSON.
**Called by**: Orchestrator signal processing (the `.ts` version is preferred)
**Dependencies**: `jq`, `git`, pipeline.json, registry files

**Arguments**: Signal string via stdin or as positional arguments.

**Signal Format**: `[SIGNAL:{TICKET_ID}:{NONCE}] {SIGNAL_TYPE} | {DETAIL}`

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Valid signal (JSON on stdout) |
| 1 | Usage error (no input) |
| 2 | Validation error (bad format, nonce mismatch, signal type not allowed for current phase) |
| 3 | File error (registry not found, malformed JSON) |

**Output**: JSON object on stdout for valid signals:
```json
{"valid": true, "ticket_id": "BRE-158", "signal_type": "CLARIFY_COMPLETE", "detail": "...", "current_step": "clarify", "nonce": "abc12"}
```
Error JSON on stderr for invalid signals.

**Key Logic**:
1. Parses signal with regex: `^\[SIGNAL:([A-Z]+-[0-9]+):([a-f0-9]+)\] ([A-Z_]+) \| (.+)$`
2. Reads registry for the extracted ticket ID.
3. Validates nonce matches the registry's stored nonce.
4. Reads allowed signal types from `pipeline.json` for the current phase and validates the signal type is in the allowed set.

---

### signal-validate.ts

**Path**: `src/scripts/orchestrator/signal-validate.ts`
**Language**: TypeScript (Bun)
**Purpose**: TypeScript equivalent of signal-validate.sh. Exports `parseSignal()` and `validateSignal()` pure functions.
**Called by**: `/collab.run` orchestrator signal processing (step 1)
**Dependencies**: `orchestrator-utils.ts`, pipeline.json, registry files

**Arguments**: Signal string as CLI arguments (joined with spaces).

**Exit Codes**: Same as the `.sh` version.

**Exported Functions**:
- `parseSignal(raw: string)`: Returns `ParsedSignal | null`. Parses the signal regex.
- `validateSignal(parsed, registry, pipeline)`: Returns `ValidationResult`. Checks nonce and signal type validity. Pure function.

---

### goal-gate-check.sh

**Path**: `src/scripts/orchestrator/goal-gate-check.sh`
**Language**: Bash
**Purpose**: Before advancing to a terminal phase ("done"), verify that all phases with a `goal_gate` field in pipeline.json have been satisfied in the ticket's `phase_history`. Goal gates only apply when `NEXT_PHASE` is terminal; otherwise the script returns PASS immediately.
**Called by**: Orchestrator signal processing (step e)
**Dependencies**: `jq`, `git`, pipeline.json, registry files

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (TICKET_ID) | Yes | Ticket identifier |
| `$2` (NEXT_PHASE) | Yes | Phase being advanced to |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | All gates passed (stdout: "PASS") |
| 1 | Usage error |
| 2 | Gate failure (stdout: "REDIRECT:<phase_id>") |
| 3 | File error |

**Output**: `PASS` or `REDIRECT:<phase_id>` to stdout.

**Key Logic**:
1. Checks if `NEXT_PHASE` has `terminal: true` in pipeline.json. If not terminal, returns PASS immediately.
2. Reads all phases with `goal_gate` field. Two modes:
   - `"always"`: Phase MUST appear in `phase_history` with a `_COMPLETE` signal.
   - `"if_triggered"`: Only required if `phase_history` contains ANY entry for this phase; then it must have `_COMPLETE`.
3. Returns the first failing phase as `REDIRECT:<phase_id>`.

---

### goal-gate-check.ts

**Path**: `src/scripts/orchestrator/goal-gate-check.ts`
**Language**: TypeScript (Bun)
**Purpose**: TypeScript equivalent of goal-gate-check.sh. Exports the `checkGoalGates()` pure function.
**Called by**: `/collab.run` orchestrator signal processing (step e)
**Dependencies**: `orchestrator-utils.ts`, pipeline.json, registry files

**Arguments**: Same as the `.sh` version.

**Exit Codes**: Same as the `.sh` version.

**Exported Functions**:
- `checkGoalGates(phaseHistory, gatedPhases)`: Returns `string | null` (null = PASS, string = failing phase ID). Pure function with no I/O.

---

### registry-read.sh

**Path**: `src/scripts/orchestrator/registry-read.sh`
**Language**: Bash
**Purpose**: Read and output the JSON registry for a given ticket ID.
**Called by**: Orchestrator signal processing (step 2)
**Dependencies**: `jq`, `git`

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (TICKET_ID) | Yes | Ticket identifier |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error |
| 3 | File error (not found, malformed JSON) |

**Output**: Full JSON contents of the registry file to stdout (pretty-printed by jq).

**Key Logic**: Reads `.collab/state/pipeline-registry/{TICKET_ID}.json` and validates it is parseable JSON via `jq`.

---

### registry-update.sh

**Path**: `src/scripts/orchestrator/registry-update.sh`
**Language**: Bash
**Purpose**: Apply field=value updates to a ticket registry file using atomic write (tmp + mv). Supports a whitelisted set of field names to prevent garbage data. Also supports `--append-phase-history` mode for adding entries to the phase_history array.
**Called by**: Multiple orchestrator scripts (phase-dispatch.sh for holds, orchestrator signal processing, held-release-scan.sh)
**Dependencies**: `jq`, `git`

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (TICKET_ID) | Yes | Ticket identifier |
| `$2..N` (field=value) | Yes | One or more field=value pairs |
| `--append-phase-history` | Alt | Alternative mode: append JSON entry to phase_history |

**Allowed Fields**: `current_step`, `nonce`, `status`, `color_index`, `group_id`, `agent_pane_id`, `orchestrator_pane_id`, `worktree_path`, `last_signal`, `last_signal_at`, `error_count`, `retry_count`, `held_at`, `waiting_for`

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error (missing arguments, invalid field=value format) |
| 2 | Validation error (field name not in whitelist) |
| 3 | File error (registry not found, write failure, malformed JSON) |

**Output**: Confirmation message, e.g., `Updated BRE-158: current_step=plan status=running`

**Key Logic**:
1. For field=value mode: validates each field name against the whitelist, builds a jq filter chain, adds `updated_at` timestamp, writes atomically.
2. For `--append-phase-history` mode: parses the JSON entry argument, appends to the `phase_history` array (initializes if missing), writes atomically.
3. Numeric values (all digits) are stored as numbers; all others as strings.

---

### registry-update.ts

**Path**: `src/scripts/orchestrator/registry-update.ts`
**Language**: TypeScript (Bun)
**Purpose**: TypeScript equivalent of registry-update.sh. Exports `parseFieldValue()`, `applyUpdates()`, and `appendPhaseHistory()` pure functions plus the `ALLOWED_FIELDS` set.
**Called by**: `/collab.run` orchestrator signal processing
**Dependencies**: `orchestrator-utils.ts`

**Arguments**: Same as the `.sh` version.

**Exit Codes**: Same as the `.sh` version.

**Exported Functions**:
- `parseFieldValue(pair: string)`: Returns `{field, value} | null`. Parses `field=value` format.
- `applyUpdates(registry, updates)`: Returns new registry object with updates applied and `updated_at` set. Pure.
- `appendPhaseHistory(registry, entry)`: Returns new registry object with entry appended to `phase_history`. Pure.

---

### held-release-scan.sh

**Path**: `src/scripts/orchestrator/held-release-scan.sh`
**Language**: Bash
**Purpose**: After a phase completes, scan all pipeline registry files for agents with `status=held`. For each, check if all `wait_for` dependencies in `coordination.json` are now satisfied. Release satisfied agents by updating their status to `running`.
**Called by**: Orchestrator signal processing (advance step f)
**Dependencies**: `jq`, `git`, `registry-update.sh`, coordination.json files, registry files

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (COMPLETED_TICKET_ID) | No | Provided for logging context only |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Scan completed (whether or not any agents were released) |
| 3 | File error (registry directory missing) |

**Output**: One line per held agent:
- `Released <ticket_id> (was held at <phase>)` -- released
- `Still held: <ticket_id> -- waiting for <dep_id>:<dep_phase>` -- still blocked
- `No held agents found.` -- nothing to do

**Key Logic**:
1. Iterates all `.json` files in the registry directory.
2. Skips files where `status != "held"`.
3. Reads `coordination.json` for the held ticket. If missing or `wait_for` empty, releases anyway with a warning.
4. For each dependency, checks the dependency ticket's `phase_history` for a `_COMPLETE` signal.
5. If all dependencies satisfied, calls `registry-update.sh` to set `status=running` and clear `held_at`/`waiting_for`.

---

### held-release-scan.ts

**Path**: `src/scripts/orchestrator/held-release-scan.ts`
**Language**: TypeScript (Bun)
**Purpose**: TypeScript equivalent of held-release-scan.sh. Exports `isDependencySatisfied()` and `checkHeldTicket()` pure functions.
**Called by**: `/collab.run` orchestrator advance step
**Dependencies**: `orchestrator-utils.ts`, `registry-update.sh` (via execSync), coordination.json, registry files

**Arguments**: Same as the `.sh` version.

**Exit Codes**: Same as the `.sh` version.

**Exported Functions**:
- `isDependencySatisfied(dep, registryDir)`: Returns `boolean`. Checks a single dependency.
- `checkHeldTicket(heldTicketId, waitFor, registryDir)`: Returns `{satisfied: boolean, blockingDep?: string}`. Checks all dependencies for a held ticket.

---

### status-table.sh

**Path**: `src/scripts/orchestrator/status-table.sh`
**Language**: Bash
**Purpose**: Scan all ticket registry files and render a formatted ASCII table showing the current state of all pipeline tickets.
**Called by**: `/collab.run` orchestrator (after every state change)
**Dependencies**: `jq`, `git`, registry files, group files

**Arguments**: None.

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Always succeeds (even if no registries found) |

**Output**: ASCII table to stdout with columns: Ticket, Phase, Status, Gate, Detail. Example:
```
+---------------+------------+----------------+-------------------+--------------------------------+
| Ticket        | Phase      | Status         | Gate              | Detail                         |
|---------------|------------|----------------|-------------------|--------------------------------|
| BRE-168       | plan       | running        | --                | Working on plan phase          |
+---------------+------------+----------------+-------------------+--------------------------------+
```

**Key Logic**:
1. Derives status from registry fields: `status` field (if set), or from `last_signal` suffix (`_COMPLETE` -> completed, `_ERROR` -> error, etc.).
2. Derives gate status from `group_id`: checks if all tickets in the group are at `implement` or beyond.
3. Derives detail from `last_signal`/`last_signal_at`, or shows held wait target, or shows "Working on {phase} phase".

---

### coordination-check.sh

**Path**: `src/scripts/orchestrator/coordination-check.sh`
**Language**: Bash
**Purpose**: Validate all per-ticket `coordination.json` files for unknown references and circular dependencies. Uses DFS cycle detection.
**Called by**: `orchestrator-init.sh` (step 2)
**Dependencies**: `jq`, `git`, coordination.json files

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1..$N` (TICKET_IDs) | Yes | All ticket IDs in the current session |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Valid (no cycles, no unknown references) |
| 1 | Validation error (cycle detected or unknown ticket reference) |

**Output**:
- Success: `Coordination check passed: N tickets, no cycles or unknown references`
- Error: `Error: Ticket 'X' wait_for references unknown ticket 'Y'` or `Error: Circular dependency: A -> B -> A`

**Key Logic**:
1. Phase 1: Parses each `specs/{ticket}/coordination.json`, extracts `wait_for` dependency IDs, validates each references a ticket in the session list, and builds an edge list.
2. Phase 2: DFS cycle detection using colon-separated path strings (Bash 3.2 compatible -- no associative arrays). Uses temporary files for state tracking.

---

### group-manage.sh

**Path**: `src/scripts/orchestrator/group-manage.sh`
**Language**: Bash
**Purpose**: Create and manage coordination groups that link multiple tickets together for synchronized pipeline operations (e.g., deploy gates).
**Called by**: `/collab.run` orchestrator (CMD:add processing, manual use)
**Dependencies**: `jq`, `git`, registry files

**Subcommands**:

| Subcommand | Args | Description |
|------------|------|-------------|
| `create` | `ticket_id [ticket_id ...]` (min 2) | Create group from ticket IDs |
| `add` | `group_id ticket_id` | Add ticket to existing group |
| `query` | `ticket_id` | Get group info for a ticket |
| `list` | `group_id` | List tickets in a group with enriched status |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error |
| 2 | Validation error (ticket not found in registry) |
| 3 | File error (group file missing, write failure) |

**Output**: JSON for `query`/`list`/`create` operations; confirmation text for `add`.

**Key Logic**:
- `create`: Generates a deterministic group ID by SHA-256 hashing the sorted ticket IDs (first 12 chars). Creates group JSON atomically. Updates each ticket's registry with `group_id`.
- `add`: Appends ticket to existing group's `tickets` array. Updates ticket registry.
- `query`: Reads `group_id` from ticket registry, returns full group data.
- `list`: Enriches group data with each ticket's current status from their registry.

---

### Tmux.ts

**Path**: `src/scripts/orchestrator/Tmux.ts`
**Language**: TypeScript (Bun)
**Purpose**: Safe tmux interaction CLI. Wraps `tmux send-keys`, `capture-pane`, `split-window`, pane labeling, and pane existence checks. ALWAYS appends Enter (C-m) to `send-keys` calls unless `--no-enter` is explicitly used.
**Called by**: All orchestrator scripts that interact with tmux panes
**Dependencies**: `tmux`, `bun` shell (`$` template literal)

**Commands**:

| Command | Description |
|---------|-------------|
| `send` | Send text to a tmux target (auto-appends C-m) |
| `capture` | Capture current screen content from a target |
| `split` | Split a pane and return new pane ID |
| `label` | Set pane title and enable border display |
| `pane-exists` | Check if a pane ID exists (exit 0=exists, 1=not found) |
| `list` | List all available tmux windows |

**Key Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--window` | `-w` | Target: window name, @N (window ID), or %N (pane ID) |
| `--text` | `-t` | Text to send (required for `send`) |
| `--delay` | `-d` | Seconds to wait between text and Enter (default: 0) |
| `--no-enter` | | Skip the Enter keystroke (rare escape hatch) |
| `--scrollback` | `-s` | Lines of scrollback to capture |
| `--horizontal` | | Split horizontally (left/right) |
| `--percentage` | | Size percentage for new pane in split (default: 50) |
| `--command` | `-c` | Command to run in new split pane |
| `--title` | `-T` | Pane title for label command |
| `--color` | | Color index (1-5) for pane border |

**Key Logic -- `send`**:
1. Sends text via `tmux send-keys -t {target} {text}`.
2. Waits `delay` seconds (for the target application to process text).
3. Sends `tmux send-keys -t {target} C-m` (carriage return) as a separate call. This is critical because Claude Code ignores `\n` (Enter) but responds to `\r` (C-m).

**Key Logic -- `split`**:
1. Runs `tmux split-window` with `-P -F "#{pane_id}"` to capture the new pane ID.
2. Outputs the new pane ID to stdout for callers to capture.

**Key Logic -- `label`**:
1. Sets pane title via `tmux select-pane -T`.
2. Enables pane border status display.
3. If color index provided, rebuilds the pane-border-format string using conditional tmux format expressions that match pane titles to colors from a 5-color palette.

---

### orchestrator-utils.ts

**Path**: `src/scripts/orchestrator/orchestrator-utils.ts`
**Language**: TypeScript (Bun)
**Purpose**: Shared utility functions for all TypeScript orchestrator scripts. Pure functions for repo root detection, JSON file I/O, and registry path construction.
**Called by**: All `.ts` orchestrator scripts (transition-resolve.ts, signal-validate.ts, goal-gate-check.ts, registry-update.ts, held-release-scan.ts)
**Dependencies**: Node.js `fs`, `path`, `child_process`

**Exported Functions**:

| Function | Signature | Description |
|----------|-----------|-------------|
| `getRepoRoot()` | `() => string` | Returns git repo root via `git rev-parse --show-toplevel`, falls back to `process.cwd()` |
| `readJsonFile(filePath)` | `(string) => any \| null` | Reads and parses a JSON file. Returns null if file missing or malformed. |
| `writeJsonAtomic(filePath, data)` | `(string, any) => void` | Writes JSON to tmp file then renames (atomic write). Pretty-prints with 2-space indent. |
| `getRegistryPath(registryDir, ticketId)` | `(string, string) => string` | Returns `{registryDir}/{ticketId}.json` |

---

## 2. Utility Scripts

---

### verify-and-complete.ts

**Path**: `src/scripts/verify-and-complete.ts`
**Language**: Bash
**Purpose**: Verify that a phase is complete (phase-specific checks) and automatically emit the completion signal to the orchestrator via `emit-question-signal.ts`.
**Called by**: Phase commands (`collab.implement`, `collab.analyze`) at the end of their execution
**Dependencies**: `bun`, `emit-question-signal.ts`, `git`

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (phase-name) | Yes | Phase being completed (e.g., "implement", "analyze") |
| `$2` (message) | No | Completion message (default: "Phase completed") |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Verification passed, signal emitted |
| 1 | Verification failed, signal not emitted |

**Output**: Progress messages to stdout, completion signal via `emit-question-signal.ts`.

**Key Logic**:
1. For `implement` phase: Searches for `tasks.md` in `specs/*/tasks.md` (falls back to repo root). Counts lines matching `- [ ]` (incomplete tasks). Fails if any remain.
2. For `analyze` phase: No specific verification -- just passes through.
3. For other phases: No specific checks.
4. On success: Calls `bun .collab/handlers/emit-question-signal.ts complete "$MESSAGE"` to emit the completion signal.

---

### webhook-notify.ts

**Path**: `src/scripts/webhook-notify.ts`
**Language**: TypeScript
**Purpose**: Send phase change notifications to the OpenClaw webhook endpoint, which forwards to Discord.
**Called by**: `/collab.run` orchestrator after phase transitions
**Dependencies**: `curl`

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (ticket) | Yes | Ticket identifier |
| `$2` (from) | Yes | Previous phase |
| `$3` (to) | Yes | New phase |
| `$4` (status) | Yes | Current status (e.g., "running", "error", "complete") |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error (missing arguments) |

**Output**: `Webhook sent for {ticket}: {from} -> {to} ({status})`

**Key Logic**: Sends a POST request with JSON payload to `http://127.0.0.1:18789/hooks/collab` with a Bearer token. Contains ticket, from, to, and status fields.

---

## 3. Signal Handlers

All handlers live in `src/handlers/` and are deployed to `.collab/handlers/`.

---

### pipeline-signal.ts

**Path**: `src/handlers/pipeline-signal.ts`
**Language**: TypeScript (Bun)
**Purpose**: Shared signal utility functions used by all signal emitters. Provides `mapResponseState()`, `buildSignalMessage()`, `resolveRegistry()`, and `truncateDetail()`.
**Called by**: `emit-question-signal.ts`, `emit-blindqa-signal.ts` (via dynamic import)
**Dependencies**: `fs`, `path`, `child_process`, `bun`

**Exported Functions**:

| Function | Signature | Description |
|----------|-----------|-------------|
| `mapResponseState(state, currentStep)` | `(string, string) => string` | Maps response state + current step to signal type. E.g., `("completed", "plan")` -> `"PLAN_COMPLETE"`, `("awaitingInput", "clarify")` -> `"CLARIFY_QUESTION"` |
| `buildSignalMessage(registry, status, detail)` | `(any, string, string) => string` | Builds formatted signal: `[SIGNAL:{ticket_id}:{nonce}] {STATUS} \| {detail}` |
| `resolveRegistry()` | `() => Promise<any \| null>` | Scans registry files for one matching `agent_pane_id === $TMUX_PANE`. Returns null if not in orchestrated mode. |
| `truncateDetail(text, maxLength?)` | `(string, number?) => string` | Truncates text to 200 characters (default), appending "..." if truncated. |

**State Map**:
| State | Suffix |
|-------|--------|
| `completed` | `_COMPLETE` |
| `awaitingInput` | `_QUESTION` |
| `waiting` | `_WAITING` |
| `failed` | `_FAILED` |
| `error` | `_ERROR` |

---

### emit-question-signal.ts

**Path**: `src/handlers/emit-question-signal.ts`
**Language**: TypeScript (Bun)
**Purpose**: Emit PHASE_QUESTION or PHASE_COMPLETE signals to the orchestrator. Called directly by phase commands (collab.clarify, collab.plan, collab.tasks) before AskUserQuestion or at completion.
**Called by**: `collab.clarify` (before each AskUserQuestion and at completion), `collab.plan` (at completion), `collab.tasks` (at completion), `verify-and-complete.ts` (at completion)
**Dependencies**: `pipeline-signal.ts`, `Tmux.ts`, `bun`

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (mode) | No | "question" or "complete" (default: "question") |
| `$2` (text) | No | Detail text for the signal |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Signal sent successfully (or not in orchestrated mode -- silent exit) |
| 1 | Error during signal emission |

**Output**: Signal sent to orchestrator pane via `Tmux.ts send`. Logs to stderr.

**Key Logic**:
1. Resolves current registry by matching `$TMUX_PANE` to `agent_pane_id`.
2. Maps mode to state: "complete" -> "completed", "question" -> "awaitingInput".
3. Builds signal using `mapResponseState()` (e.g., `CLARIFY_QUESTION` or `PLAN_COMPLETE`).
4. Sends to orchestrator pane via Tmux.ts with 1-second delay.

---

### emit-blindqa-signal.ts

**Path**: `src/handlers/emit-blindqa-signal.ts`
**Language**: TypeScript (Bun)
**Purpose**: Emit BLINDQA lifecycle signals (start, pass, fail) to the orchestrator.
**Called by**: `collab.blindqa` command at lifecycle points
**Dependencies**: `pipeline-signal.ts`, `Tmux.ts`, `bun`

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (event) | Yes | "start", "pass", or "fail" |
| `$2` (detail) | No | Detail message (default: "BlindQA {event}") |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Signal sent (or not in orchestrated mode) |
| 1 | Error or missing arguments |

**Output**: Signal sent to orchestrator pane via Tmux.ts.

**Key Logic**:
1. Maps events to response states: `start` -> `awaitingInput` (emits `BLINDQA_QUESTION`), `pass` -> `completed` (emits `BLINDQA_COMPLETE`), `fail` -> `failed` (emits `BLINDQA_FAILED`).
2. Warns if `current_step` is not "blindqa".

---

### emit-spec-critique-signal.ts

**Path**: `src/handlers/emit-spec-critique-signal.ts`
**Language**: TypeScript (Bun)
**Purpose**: Emit SPEC_CRITIQUE lifecycle signals (start, pass, warn, fail).
**Called by**: `collab.spec-critique` command at lifecycle points
**Dependencies**: `child_process` (for ticket ID detection)

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (eventType) | Yes | "start", "pass", "warn", or "fail" |
| `$2` (message) | Yes | Detail message |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Signal emitted |
| 1 | Missing arguments or unknown event type |

**Output**: Signal string in orchestrator-compatible format to both stdout and stderr:
`[SIGNAL:{ticket_id}:{timestamp}] SPEC_CRITIQUE_{EVENT} | {message}`

**Key Logic**: Unlike other emitters, this one uses a timestamp as the nonce (not the registry nonce) and outputs directly to stdout rather than sending via Tmux.ts. It determines the ticket ID by scanning registry files.

**Signal Map**:
| Event | Signal |
|-------|--------|
| `start` | `SPEC_CRITIQUE_START` |
| `pass` | `SPEC_CRITIQUE_PASS` |
| `warn` | `SPEC_CRITIQUE_WARN` |
| `fail` | `SPEC_CRITIQUE_FAIL` |

---

### resolve-tokens.ts

**Path**: `src/handlers/resolve-tokens.ts`
**Language**: TypeScript (Bun)
**Purpose**: Pipeline v3 token expression resolver. Substitutes `{{TOKEN}}` expressions in template strings using a three-tier resolution strategy.
**Called by**: Orchestrator gate evaluation (when resolving gate prompt templates)
**Dependencies**: None (standalone)

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (template) | Yes | Template string with `{{TOKEN}}` expressions |
| `$2` (context-json) | Yes | JSON string with token values |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Always succeeds |

**Output**: Resolved template string to stdout.

**Token Resolution Tiers**:

| Tier | Pattern | Behavior |
|------|---------|----------|
| Tier 1 | `{{TICKET_ID}}`, `{{TICKET_TITLE}}`, `{{PHASE}}`, `{{INCOMING_SIGNAL}}`, `{{INCOMING_DETAIL}}`, `{{BRANCH}}`, `{{WORKTREE}}` | Substituted from context JSON. Empty string if missing. |
| Tier 2 | `{{ALL_CAPS_TOKEN}}` (unknown) | Warning to stderr, substituted with empty string. |
| Tier 3 | `{{lowercase_or_mixed}}` | Returned unresolved (AI handles inline). |

---

## 4. Hooks

---

### question-signal.hook.ts

**Path**: `src/hooks/question-signal.hook.ts`
**Language**: TypeScript (Bun)
**Purpose**: Emit PHASE_QUESTION signal to the orchestrator when an agent calls AskUserQuestion. Fires on `PreToolUse:AskUserQuestion` in orchestrated agent sessions.
**Called by**: Claude Code hook system (PreToolUse trigger, AskUserQuestion matcher)
**Dependencies**: `tmux`, `bun`, registry files

**Trigger**: PreToolUse
**Matcher**: AskUserQuestion

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Always (never blocks the UI) |

**Output**: Sends signal to orchestrator pane via `tmux send-keys`.

**Key Logic**:
1. Reads `$TMUX_PANE` environment variable. Exits silently if not in tmux.
2. Scans `.collab/state/pipeline-registry/` for an entry where `agent_pane_id` matches `$TMUX_PANE`.
3. Builds signal: `[SIGNAL:{ticket_id}:{nonce}] {PHASE}_QUESTION | agent awaiting input`.
4. Sends via two separate `tmux send-keys` calls with 1-second sleep between text and C-m (required for Claude Code to register the submit).
5. The registry directory is resolved relative to `import.meta.dir` (resolves symlinks), not from git root, ensuring it works in worktrees with symlinked `.collab/`.

---

## 5. Config Files

---

### pipeline.json

**Path**: `src/config/pipeline.json`
**Language**: JSON
**Purpose**: Defines the complete pipeline structure: phases, gates, and transitions. This is the single source of truth for phase ordering, signal types, gate evaluation, and routing. All orchestrator scripts are generic interpreters of this file.
**Called by**: Every orchestrator script reads this file
**Dependencies**: Must conform to `pipeline.v3.schema.json`

**Schema Version**: `3.0`

**Phases** (7 total):

| Phase ID | Command | Signals | Goal Gate | Terminal |
|----------|---------|---------|-----------|----------|
| `clarify` | `/collab.clarify` | CLARIFY_COMPLETE, CLARIFY_QUESTION, CLARIFY_ERROR | -- | No |
| `plan` | `/collab.plan` | PLAN_COMPLETE, PLAN_ERROR | -- | No |
| `tasks` | `/collab.tasks` | TASKS_COMPLETE, TASKS_ERROR | -- | No |
| `analyze` | `/collab.analyze` | ANALYZE_COMPLETE, ANALYZE_ERROR | -- | No |
| `implement` | actions array (display + `/collab.implement`) | IMPLEMENT_COMPLETE, IMPLEMENT_WAITING, IMPLEMENT_ERROR | -- | No |
| `blindqa` | actions array (display + `/collab.blindqa`) | BLINDQA_COMPLETE, BLINDQA_FAILED, BLINDQA_ERROR, BLINDQA_QUESTION, BLINDQA_WAITING | `always` | No |
| `done` | -- | (none) | -- | Yes |

**Gates** (2):

| Gate Name | Prompt File | Responses | On Exhaust |
|-----------|-------------|-----------|------------|
| `plan_review` | `.collab/config/gates/plan.md` | APPROVED -> tasks, REVISION_NEEDED -> plan (with feedback, max 3 retries) | skip |
| `analyze_review` | `.collab/config/gates/analyze.md` | REMEDIATION_COMPLETE -> implement, ESCALATION -> (feedback, no `to`) | abort |

**Transitions** (12 rows):

| From | Signal | Target/Gate |
|------|--------|-------------|
| clarify | CLARIFY_COMPLETE | -> plan |
| plan | PLAN_COMPLETE | gate: plan_review |
| plan | PLAN_ERROR | -> plan |
| tasks | TASKS_COMPLETE | -> analyze |
| tasks | TASKS_ERROR | -> tasks |
| analyze | ANALYZE_COMPLETE | gate: analyze_review |
| analyze | ANALYZE_ERROR | -> analyze |
| implement | IMPLEMENT_COMPLETE | -> blindqa |
| implement | IMPLEMENT_ERROR | -> implement |
| blindqa | BLINDQA_COMPLETE | -> done |
| blindqa | BLINDQA_FAILED | -> blindqa |
| blindqa | BLINDQA_ERROR | -> blindqa |

---

### pipeline.v3.schema.json

**Path**: `src/config/pipeline.v3.schema.json`
**Language**: JSON Schema (draft/2020-12)
**Purpose**: JSON Schema for validating `pipeline.json`. Enforces structure, mutual exclusivity constraints, and type safety.
**Called by**: `orchestrator-init.sh` (via `bunx ajv-cli validate`)

**Top-Level Required Fields**: `version` (must be "3.0"), `phases`, `transitions`

**Key Schema Rules**:
- **Phase**: `id` required. `command` and `actions` are mutually exclusive. `actions` array may contain at most one `command` action. `goal_gate` must be "always" or "if_triggered". `terminal` is boolean.
- **Action**: Must be exactly one of `{display}`, `{prompt}`, or `{command}` (oneOf).
- **Gate**: Requires `prompt` (file path) and `responses` (keyword -> routing map). Optional `on_exhaust` ("skip" or "abort").
- **Gate Response**: Optional `to` (target phase), `feedback` (boolean), `max_retries` (number).
- **Transition**: Requires `from` and `signal`. Must have exactly one of `to` or `gate` (oneOf). Optional `if` for conditional evaluation.

---

### coordination.schema.json

**Path**: `src/config/coordination.schema.json`
**Language**: JSON Schema (draft/2020-12)
**Purpose**: Schema for per-ticket `coordination.json` files that declare cross-ticket phase dependencies.
**Called by**: Referenced for documentation; validated implicitly by `coordination-check.sh`

**Location**: Lives at `specs/{TICKET_ID}/coordination.json`

**Required Fields**: `wait_for`

**`wait_for` format**: Either a single dependency object or an array of dependencies (AND logic). Each dependency has:
- `id` (string): Ticket ID of the dependency
- `phase` (string): Phase ID that must have `_COMPLETE` in phase_history

---

### verify-config.json

**Path**: `src/config/verify-config.json`
**Language**: JSON
**Purpose**: Configuration for the verification command. Currently contains test runner settings.
**Called by**: Not directly referenced by current scripts (placeholder/legacy)

**Contents**:
```json
{
  "command": "go test ./...",
  "timeout": 120,
  "working_dir": null
}
```

---

### verify-patterns.json

**Path**: `src/config/verify-patterns.json`
**Language**: JSON
**Purpose**: Pattern definitions for verification matching. Currently an empty array.
**Called by**: Not directly referenced by current scripts (placeholder/legacy)

**Contents**: `[]`

---

### gates/plan.md

**Path**: `src/config/gates/plan.md`
**Language**: Markdown (with YAML front matter)
**Purpose**: Gate prompt for plan review. Evaluated by the orchestrator after PLAN_COMPLETE signal. Contains instructions for reviewing the implementation plan against the spec.
**Called by**: Orchestrator gate evaluation for `plan_review` gate

**Front Matter Context Variables**:
- `SPEC_MD`: `specs/{{TICKET_ID}}/spec.md`
- `PLAN_MD`: `specs/{{TICKET_ID}}/plan.md`

**Evaluation Criteria**: Requirements coverage, data model completeness, phase ordering, acceptance criteria alignment, constitution compliance.

**Expected Responses**: `APPROVED` or `REVISION_NEEDED: <issues>`

---

### gates/plan-review-prompt.md

**Path**: `src/config/gates/plan-review-prompt.md`
**Language**: Markdown
**Purpose**: Alternative/legacy plan review prompt. Similar to `plan.md` but without YAML front matter. Contains the same evaluation criteria and expected responses.
**Called by**: Not directly referenced in current pipeline.json (plan.md is used instead)

---

### gates/analyze.md

**Path**: `src/config/gates/analyze.md`
**Language**: Markdown (with YAML front matter)
**Purpose**: Gate prompt for analysis review. Evaluated by the orchestrator after ANALYZE_COMPLETE signal. Contains instructions for reviewing analysis findings and deciding whether to advance to implementation.
**Called by**: Orchestrator gate evaluation for `analyze_review` gate

**Front Matter Context Variables**:
- `SPEC_MD`: `specs/{{TICKET_ID}}/spec.md`
- `TASKS_MD`: `specs/{{TICKET_ID}}/tasks.md`
- `ANALYSIS_MD`: `specs/{{TICKET_ID}}/analysis.md`

**Critical Rule**: The verdict must be based solely on the Analysis Report (ANALYSIS_MD). The orchestrator must NOT substitute its own independent artifact review.

**Expected Responses**: `REMEDIATION_COMPLETE` or `ESCALATION: <finding-by-finding instructions>`

---

### gates/analyze-review-prompt.md

**Path**: `src/config/gates/analyze-review-prompt.md`
**Language**: Markdown
**Purpose**: Alternative/legacy analysis review prompt. Two-phase approach: apply findings, then confirm resolution.
**Called by**: Not directly referenced in current pipeline.json (analyze.md is used instead)

---

### orchestrator-contexts/blindqa.md

**Path**: `src/config/orchestrator-contexts/blindqa.md`
**Language**: Markdown
**Purpose**: Scoping context loaded by the orchestrator during the blindqa phase. Puts the orchestrator into "skeptical overseer mode" where it challenges all success claims and demands concrete evidence.
**Called by**: `/collab.run` orchestrator (loaded when `orchestrator_context` field is set on the blindqa phase in pipeline.json)

**Behavioral Rules**:
1. Challenge all success claims -- ask for specific evidence.
2. Demand concrete artifacts (test output, file diffs, runtime results).
3. Never accept BLINDQA_COMPLETE without verification of actual test suite output.
4. Look for evasion patterns (claiming tests pass without showing output).
5. Redirect incomplete work with specific evidence requirements.

---

### displays/blindqa-header.md

**Path**: `src/config/displays/blindqa-header.md`
**Language**: Markdown
**Purpose**: Display template for the blindqa phase header. Contains token placeholders for ticket information.
**Called by**: Referenced for display actions (not currently used in pipeline.json actions)

**Token Placeholders**: `{{TICKET_ID}}`, `{{TICKET_TITLE}}`

---

## 6. Phase Commands

All phase commands live in `src/commands/` and are deployed to `.claude/commands/`. They are Markdown files that instruct Claude Code agents on how to execute each pipeline phase.

---

### collab.specify.md

**Path**: `src/commands/collab.specify.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Create or update the feature specification from a natural language description or ticket ID. Creates a git branch/worktree, initializes the spec directory, and generates the specification document.
**Called by**: User directly, or `/collab.run` (step 0)

**Key Behaviors**:
1. If `$ARGUMENTS` matches `[A-Z]+-[0-9]+`, treats it as a Linear ticket ID -- fetches via MCP, extracts title and description.
2. Generates a 2-4 word short name for the branch from the feature description.
3. Checks existing branches (local, remote, specs directories) to determine the next feature number.
4. Source repo detection: if ticket project differs from current repo, prompts user for the target repo path.
5. Runs `create-new-feature.ts` with `--json --worktree` to create the branch and directory structure.
6. Loads the spec template and fills it with derived requirements, user scenarios, acceptance criteria.
7. Runs specification quality validation with a self-generated checklist at `checklists/requirements.md`.
8. Resolves any `[NEEDS CLARIFICATION]` markers by making informed guesses based on context.
9. Stays in the main repo (does not `cd` into worktree) so the orchestrator can run afterward.

---

### collab.clarify.md

**Path**: `src/commands/collab.clarify.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Detect and reduce ambiguity in the feature specification using AskUserQuestion for orchestrator-compatible interaction. Max 3 questions per session.
**Called by**: Orchestrator phase dispatch (first phase in pipeline)

**Signal Contract**:
- Before each question: `bun .collab/handlers/emit-question-signal.ts question "question§option1§option2§..."`
- At completion: `bun .collab/handlers/emit-question-signal.ts complete "Clarification phase finished"`

**Key Behaviors**:
1. Runs `check-prerequisites.sh --json --paths-only` to get feature paths.
2. Scans spec across taxonomy categories (functional scope, data model, UX flow, non-functional, integration, edge cases, terminology).
3. Generates max 3 questions with 2-4 options each, including a recommended option.
4. Emits `CLARIFY_QUESTION` signal with question and options encoded with `§` separator BEFORE calling AskUserQuestion.
5. Integrates each answer into the spec's `## Clarifications` section.

---

### collab.plan.md

**Path**: `src/commands/collab.plan.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Execute the implementation planning workflow. Fills the plan template with technical context, generates research.md, data-model.md, contracts/, and quickstart.md.
**Called by**: Orchestrator phase dispatch

**Signal Contract**: At completion: `bun .collab/handlers/emit-question-signal.ts complete "Plan phase finished"`

**Key Behaviors**:
1. Runs `setup-plan.sh --json` to copy plan template and get paths.
2. Loads feature spec and constitution.
3. Phase 0 (Outline & Research): Extracts unknowns from Technical Context, researches each, consolidates in `research.md`.
4. Phase 1 (Design & Contracts): Generates `data-model.md`, API contracts in `contracts/`, `quickstart.md`.
5. Runs `update-agent-context.sh claude` to update CLAUDE.md with new tech stack info.
6. Re-evaluates Constitution Check after design.

---

### collab.tasks.md

**Path**: `src/commands/collab.tasks.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Generate an actionable, dependency-ordered tasks.md organized by user story from spec.md.
**Called by**: Orchestrator phase dispatch

**Signal Contract**: At completion: `bun .collab/handlers/emit-question-signal.ts complete "Task generation phase finished"`

**Key Behaviors**:
1. Runs `check-prerequisites.sh --json` to validate plan.md exists.
2. Loads plan.md (tech stack), spec.md (user stories with priorities), and optional design documents.
3. Generates tasks in strict checklist format: `- [ ] [TaskID] [P?] [Story?] Description with file path`.
4. Organizes by phase: Setup -> Foundational -> User Stories (by priority) -> Polish.
5. Tests are OPTIONAL (only if explicitly requested in spec).
6. Each user story phase is independently testable.

---

### collab.analyze.md

**Path**: `src/commands/collab.analyze.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Perform non-destructive cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md. Read-only during initial analysis; applies orchestrator-directed remediations afterward.
**Called by**: Orchestrator phase dispatch

**Signal Contract**: At completion: `.collab/scripts/verify-and-complete.ts analyze "Analysis phase finished"`

**Key Behaviors**:
1. Runs `check-prerequisites.sh --json --require-tasks --include-tasks`.
2. Builds semantic models: requirements inventory, user story inventory, task coverage mapping, constitution rule set.
3. Detection passes: duplication, ambiguity, underspecification, constitution alignment, coverage gaps, inconsistency.
4. Severity assignment: CRITICAL, HIGH, MEDIUM, LOW.
5. Writes analysis report to `$FEATURE_DIR/analysis.md` (the analyze gate reads this file).
6. Constitution conflicts are automatically CRITICAL.
7. After orchestrator sends remediation instructions: applies changes to artifacts, re-runs verification script.

---

### collab.implement.md

**Path**: `src/commands/collab.implement.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Execute the implementation plan by processing all tasks in tasks.md. Follows TDD approach, respects task dependencies and parallel markers.
**Called by**: Orchestrator phase dispatch

**Signal Contract**: At completion: `.collab/scripts/verify-and-complete.ts implement "Implementation phase finished"`

**Key Behaviors**:
1. Runs `check-prerequisites.sh --json --require-tasks --include-tasks`.
2. Checks checklists status -- if any checklist is incomplete, prompts before proceeding.
3. Sets up project structure: creates/verifies ignore files based on detected technology stack.
4. Parses tasks.md structure and executes phase-by-phase.
5. Follows TDD: test tasks before implementation tasks.
6. Marks completed tasks as `[X]` in tasks.md.
7. After orchestrator rejection: fixes issues, re-runs test suite, re-emits signal.

---

### collab.blindqa.md

**Path**: `src/commands/collab.blindqa.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Execute blind adversarial verification of completed implementation with zero implementation context. Retry loop up to 3 attempts.
**Called by**: Orchestrator phase dispatch

**Signal Contract**:
- Start: `bun .collab/handlers/emit-blindqa-signal.ts start "Starting blind verification"`
- Pass: `bun .collab/handlers/emit-blindqa-signal.ts pass "All checks passed"`
- Fail: `bun .collab/handlers/emit-blindqa-signal.ts fail "N issues remain"`

**Key Behaviors**:
1. Validates ticket ID and verifies registry state.
2. Emits BLINDQA_START signal on first attempt.
3. Invokes BlindQA skill (with optional `--interactive` flag).
4. On PASS: emits BLINDQA_PASS, exits 0.
5. On FAIL with retries remaining: increments attempt, retries.
6. On FAIL after max attempts: emits BLINDQA_FAIL, exits 1.

---

### collab.checklist.md

**Path**: `src/commands/collab.checklist.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Generate custom checklists that validate requirements quality (not implementation correctness). Checklists are "unit tests for English."
**Called by**: User directly

**Key Behaviors**:
1. Runs `check-prerequisites.sh --json`.
2. Derives up to 3 contextual clarifying questions based on the user's request.
3. Generates checklist items that test requirement quality dimensions: completeness, clarity, consistency, measurability, coverage.
4. Creates file at `FEATURE_DIR/checklists/{domain}.md` with sequentially numbered items (CHK001+).
5. Each run creates a new file (never overwrites).

**Prohibited Patterns**: "Verify...", "Test...", "Confirm..." + implementation behavior. Checklists must ask about requirements quality, not system behavior.

---

### collab.cleanup.md

**Path**: `src/commands/collab.cleanup.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Clean up a completed feature by removing the branch/worktree, tmux pane, registry, and spec directories. Checks merge status and prompts for confirmation before destructive operations.
**Called by**: User directly

**Key Behaviors**:
1. Detects mode (worktree vs branch) by scanning `specs/*/metadata.json`.
2. Checks if branch is merged into dev.
3. If unmerged: prompts via AskUserQuestion (merge first, or cleanup without merging).
4. Kills the agent's tmux pane.
5. Removes: worktree (if applicable), local branch, remote branch (if merged), registry file, spec directory, metadata file.

---

### collab.constitution.md

**Path**: `src/commands/collab.constitution.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Create or update the project constitution at `.collab/memory/constitution.md`. Fills template placeholders with concrete values, handles version bumping, and propagates changes across dependent templates.
**Called by**: User directly

**Key Behaviors**:
1. Loads existing constitution template and identifies placeholder tokens.
2. Collects/derives values from user input, repo context, or inference.
3. Version bumping follows semver (MAJOR/MINOR/PATCH).
4. Consistency propagation: validates plan-template.md, spec-template.md, tasks-template.md, and command files for alignment.
5. Produces a Sync Impact Report as HTML comment at top of file.

---

### collab.install.md

**Path**: `src/commands/collab.install.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Install the collab workflow system into a target repository by cloning from GitHub and running the install script.
**Called by**: User directly

**Key Behaviors**:
1. Clones the collab repo from GitHub (branch: dev, depth: 1) into a temp directory.
2. Runs `src/commands/collab.install.ts` from the cloned repo.
3. Cleans up temp directory.
4. Installs: `.claude/commands/`, `.claude/skills/`, `.collab/handlers/`, `.collab/scripts/`, `.collab/memory/`, `.specify/scripts/`, `.specify/templates/`.

---

### collab.run.md

**Path**: `src/commands/collab.run.md`
**Language**: Markdown (Claude Code command)
**Purpose**: The main orchestrator command. Drives the entire pipeline by spawning agent panes in tmux and processing signal responses. Max 5 concurrent agents.
**Called by**: User directly

**Key Behaviors**:

**Setup Phase**:
1. Step 0: Runs `/collab.specify $ARGUMENTS` inline (pre-orchestration). MUST continue to steps 1-5 afterward.
2. Step 1: Crash recovery -- scans registries for matching orchestrator pane, recovers or cleans up.
3. Step 2: Validates arguments.
4. Step 3: Runs `orchestrator-init.sh` to create registry and spawn agent pane.
5. Step 4: Fetches Linear ticket via MCP.
6. Step 5: Dispatches first phase via `phase-dispatch.sh`.

**Input Routing**: `[SIGNAL:...]` -> Signal Processing. `[CMD:...]` -> Command Processing. Other -> ignore.

**Signal Processing**:
- `_QUESTION`/`_WAITING`: Parses question and options from detail (split on `§`), reasons about best answer, navigates tmux to select it.
- `_COMPLETE`: Appends to phase_history, loads orchestrator_context, resolves transition, evaluates gate (if any), checks goal gates, advances to next phase.
- `_ERROR`/`_FAILED`: Captures screen, re-dispatches current phase.

**Command Processing**: `[CMD:add {ticket_id}]`, `[CMD:status]`, `[CMD:remove {ticket_id}]`.

**Rules**: One input = one response. Never loop or poll. All routing from pipeline.json. No hardcoded phase logic.

---

### collab.spec-critique.md

**Path**: `src/commands/collab.spec-critique.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Execute adversarial specification analysis to find gaps before implementation. Iterates until zero HIGH severity issues remain.
**Called by**: User directly (not currently in the standard pipeline sequence)

**Signal Contract**:
- Start: `bun .collab/handlers/emit-spec-critique-signal.ts start "..."`
- Pass: `bun .collab/handlers/emit-spec-critique-signal.ts pass "..."`
- Warn: `bun .collab/handlers/emit-spec-critique-signal.ts warn "..."`
- Fail: `bun .collab/handlers/emit-spec-critique-signal.ts fail "..."`

---

### collab.taskstoissues.md

**Path**: `src/commands/collab.taskstoissues.md`
**Language**: Markdown (Claude Code command)
**Purpose**: Convert tasks from tasks.md into GitHub Issues. Only proceeds if the remote is a GitHub URL.
**Called by**: User directly

**Key Behaviors**:
1. Runs `check-prerequisites.sh --json --require-tasks --include-tasks`.
2. Gets git remote URL.
3. For each task: creates a GitHub issue via the GitHub MCP server.
4. CRITICAL: Never creates issues in repositories that do not match the remote URL.

---

## 7. Workflow Scripts

All workflow scripts live in `.specify/scripts/`.

---

### create-new-feature.ts

**Path**: `.specify/scripts/create-new-feature.ts`
**Language**: TypeScript
**Purpose**: Create a new feature branch (or worktree), spec directory, and initialize spec.md from template. Supports auto-numbering, worktree mode, and source repo override.
**Called by**: `collab.specify` command
**Dependencies**: `git`, `jq` (for metadata.json), spec-template.md

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `--json` | No | Output in JSON format |
| `--short-name <name>` | No | Custom short name for branch |
| `--number N` | No | Override auto-detected branch number |
| `--worktree` | No | Create git worktree instead of switching branches |
| `--worktree-path <dir>` | No | Custom worktree base directory (default: `../worktrees/`) |
| `--source-repo <path>` | No | Create branch/worktree from this repo instead of current |
| Feature description | Yes | Positional argument(s) -- the feature description text |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Missing feature description or argument errors |

**Output (JSON mode)**:
```json
{"BRANCH_NAME":"001-feature-name","SPEC_FILE":"/path/to/spec.md","FEATURE_NUM":"001","WORKTREE_DIR":"/path/to/worktree"}
```

**Key Logic**:
1. Parses all CLI arguments (bash 3.2 compatible, no associative arrays).
2. If `--source-repo` provided, overrides `REPO_ROOT`.
3. Generates branch name: filters stop words, takes first 3-4 meaningful words, joins with hyphens.
4. Auto-detects next feature number by scanning all branches (local + remote) and specs directories for the highest `NNN-` prefix.
5. Truncates branch name to GitHub's 244-byte limit if necessary.
6. In worktree mode: creates worktree at `{worktree_path}/{branch_name}`, creates `metadata.json` in the main repo's specs directory for worktree discovery.
7. Extracts ticket ID from feature description using regex `([A-Z]+)-([0-9]+)` and stores in metadata.json.
8. Copies spec template to the feature directory.

---

### check-prerequisites.sh

**Path**: `.specify/scripts/bash/check-prerequisites.sh`
**Language**: Bash
**Purpose**: Unified prerequisite checking for the Spec-Driven Development workflow. Validates feature branch, required files, and builds a list of available documents.
**Called by**: `collab.analyze`, `collab.tasks`, `collab.implement`, `collab.checklist`, `collab.taskstoissues`
**Dependencies**: `common.sh`, `git`

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `--json` | No | Output in JSON format |
| `--require-tasks` | No | Require tasks.md to exist |
| `--include-tasks` | No | Include tasks.md in AVAILABLE_DOCS |
| `--paths-only` | No | Only output paths (no validation) |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | All prerequisites met |
| 1 | Missing required files or invalid branch |

**Output (JSON mode)**:
```json
{"FEATURE_DIR":"/path/to/specs/001-feature","AVAILABLE_DOCS":["research.md","data-model.md"]}
```

**Key Logic**:
1. Sources `common.sh` for shared functions.
2. Gets feature paths via `get_feature_paths()` (handles worktrees, non-git repos, SPECIFY_FEATURE env var).
3. In `--paths-only` mode: outputs paths without validation.
4. Otherwise: validates feature directory exists, plan.md exists, tasks.md exists (if `--require-tasks`).
5. Scans for optional documents: research.md, data-model.md, contracts/, quickstart.md, tasks.md.

---

### common.sh

**Path**: `.specify/scripts/bash/common.sh`
**Language**: Bash
**Purpose**: Shared functions and variables for all `.specify` scripts. Provides repo root detection, branch resolution, feature directory lookup, and path generation.
**Called by**: `check-prerequisites.sh`, `setup-plan.sh`, `update-agent-context.sh` (via `source`)
**Dependencies**: `git` (optional -- supports non-git repos)

**Exported Functions**:

| Function | Description |
|----------|-------------|
| `get_repo_root()` | Returns git repo root, or falls back to script-relative path for non-git repos |
| `get_current_branch()` | Returns `$SPECIFY_FEATURE` env var, or git branch, or latest numbered specs directory, or "main" |
| `has_git()` | Returns 0 if git repo detected |
| `check_feature_branch(branch, has_git)` | Validates branch matches `NNN-*` pattern (git repos only) |
| `get_feature_dir(repo_root, branch)` | Returns `{repo_root}/specs/{branch}` |
| `find_feature_dir_by_prefix(repo_root, branch)` | Finds feature dir by numeric prefix (e.g., `004-*`). Handles exact match first, then prefix search. Warns on multiple matches. |
| `get_feature_paths()` | Returns all feature-related paths as evaluable shell assignments (REPO_ROOT, CURRENT_BRANCH, FEATURE_DIR, FEATURE_SPEC, IMPL_PLAN, TASKS, RESEARCH, DATA_MODEL, QUICKSTART, CONTRACTS_DIR) |
| `check_file(path, label)` | Prints checkmark or X for file existence |
| `check_dir(path, label)` | Prints checkmark or X for non-empty directory |

---

### setup-plan.sh

**Path**: `.specify/scripts/bash/setup-plan.sh`
**Language**: Bash
**Purpose**: Initialize the planning phase by copying the plan template to the feature directory.
**Called by**: `collab.plan` command
**Dependencies**: `common.sh`, `git`, plan-template.md

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `--json` | No | Output in JSON format |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Not on a feature branch |

**Output (JSON mode)**:
```json
{"FEATURE_SPEC":"/path/spec.md","IMPL_PLAN":"/path/plan.md","SPECS_DIR":"/path/specs/001-feature","BRANCH":"001-feature","HAS_GIT":"true"}
```

**Key Logic**:
1. Sources `common.sh`, gets feature paths.
2. Validates feature branch.
3. Creates feature directory if missing.
4. Copies plan template to `plan.md` (creates empty file if template missing).

---

### update-agent-context.sh

**Path**: `.specify/scripts/bash/update-agent-context.sh`
**Language**: Bash
**Purpose**: Update AI agent context files (CLAUDE.md, GEMINI.md, etc.) with project information extracted from plan.md.
**Called by**: `collab.plan` command (Phase 1)
**Dependencies**: `common.sh`, `git`, agent-file-template.md

**Arguments**:
| Arg | Required | Description |
|-----|----------|-------------|
| `$1` (agent_type) | No | Specific agent to update (claude, gemini, copilot, cursor-agent, qwen, opencode, codex, windsurf, kilocode, auggie, roo, codebuddy, qoder, amp, shai, q, bob). If empty, updates all existing agent files. |

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Environment validation failed or parse error |

**Key Logic**:
1. Validates environment: checks for current branch and plan.md existence.
2. Parses plan.md for: Language/Version, Primary Dependencies, Storage, Project Type (using `**Field**: value` pattern matching).
3. For new files: copies agent-file-template.md, substitutes all `[PLACEHOLDER]` tokens.
4. For existing files: appends new technology entries to `## Active Technologies` section, adds change entry to `## Recent Changes` (keeps only last 3), updates timestamp.
5. Supports 17 agent types with agent-specific file paths and naming conventions.

---

### create-new-feature.test.ts (replaces test-ticket-extraction.sh)

**Path**: `.specify/scripts/create-new-feature.test.ts`
**Language**: TypeScript (bun:test)
**Purpose**: Tests for ticket ID extraction regex patterns and feature creation logic. Replaced the former `test-ticket-extraction.sh` bash script with bun:test.
**Called by**: `bun test`
**Dependencies**: `bun:test`

**Test Cases**: BRE-123, PROJ-456, FEAT-789, CUSTOM-999, ABC-1, JIRA-12345, no-ticket strings, edge cases (multiple IDs, lowercase).

---

## 8. Templates

All templates live in `.specify/templates/`.

---

### spec-template.md

**Path**: `.specify/templates/spec-template.md`
**Language**: Markdown
**Purpose**: Template for feature specifications. Defines the structure that `collab.specify` fills in.

**Sections**:
- Header: Feature name, branch, date, status, input
- **User Scenarios & Testing** (mandatory): Prioritized user stories (P1, P2, P3) with acceptance scenarios in Given/When/Then format. Each story must be independently testable.
- **Edge Cases**: Boundary conditions and error scenarios.
- **Requirements** (mandatory): Functional Requirements (FR-001+) with `[NEEDS CLARIFICATION]` markers for unclear items. Key Entities section.
- **Success Criteria** (mandatory): Measurable, technology-agnostic outcomes (SC-001+).

---

### plan-template.md

**Path**: `.specify/templates/plan-template.md`
**Language**: Markdown
**Purpose**: Template for implementation plans. Defines the structure that `collab.plan` fills in.

**Sections**:
- Header: Feature name, branch, date, spec link
- **Summary**: Primary requirement + technical approach
- **Technical Context**: Language/Version, Primary Dependencies, Storage, Testing, Target Platform, Project Type, Performance Goals, Constraints, Scale/Scope
- **Constitution Check**: Gate that must pass before Phase 0
- **Project Structure**: Documentation tree + source code tree (3 options: single, web, mobile)
- **Complexity Tracking**: Violation justification table

---

### tasks-template.md

**Path**: `.specify/templates/tasks-template.md`
**Language**: Markdown
**Purpose**: Template for task lists. Defines the structure and format rules that `collab.tasks` fills in.

**Task Format**: `- [ ] [TaskID] [P?] [Story?] Description with file path`

**Phase Structure**:
- Phase 1: Setup (shared infrastructure)
- Phase 2: Foundational (blocking prerequisites)
- Phase 3+: User Stories by priority (P1, P2, P3...)
- Final Phase: Polish & cross-cutting concerns

**Includes**: Dependencies section, parallel execution examples, implementation strategy (MVP first, incremental delivery, parallel team).

---

### checklist-template.md

**Path**: `.specify/templates/checklist-template.md`
**Language**: Markdown
**Purpose**: Template for checklists generated by `collab.checklist`. Provides structure for requirements quality validation items.

**Structure**:
- Header: Checklist type, feature name, purpose, date
- Category sections with `- [ ] CHK### Item` format
- Notes section with usage instructions

---

### constitution-template.md

**Path**: `.specify/templates/constitution-template.md`
**Language**: Markdown
**Purpose**: Template for project constitutions. Contains placeholder tokens that `collab.constitution` fills in.

**Placeholder Tokens**: `[PROJECT_NAME]`, `[PRINCIPLE_1_NAME]`, `[PRINCIPLE_1_DESCRIPTION]`, `[PRINCIPLE_2_NAME]`, etc., `[SECTION_2_NAME]`, `[GOVERNANCE_RULES]`, `[CONSTITUTION_VERSION]`, `[RATIFICATION_DATE]`, `[LAST_AMENDED_DATE]`

**Structure**: Core Principles (numbered), additional constraint sections, Governance section, version/date footer.

---

### agent-file-template.md

**Path**: `.specify/templates/agent-file-template.md`
**Language**: Markdown
**Purpose**: Template for AI agent context files (CLAUDE.md, GEMINI.md, etc.). Used by `update-agent-context.sh` when creating new agent files.

**Placeholder Tokens**: `[PROJECT NAME]`, `[DATE]`, `[EXTRACTED FROM ALL PLAN.MD FILES]`, `[ACTUAL STRUCTURE FROM PLANS]`, `[ONLY COMMANDS FOR ACTIVE TECHNOLOGIES]`, `[LANGUAGE-SPECIFIC, ONLY FOR LANGUAGES IN USE]`, `[LAST 3 FEATURES AND WHAT THEY ADDED]`

**Structure**: Active Technologies, Project Structure, Commands, Code Style, Recent Changes, Manual Additions markers.
