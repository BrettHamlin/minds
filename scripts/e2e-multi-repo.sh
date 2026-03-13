#!/usr/bin/env bash
# e2e-multi-repo.sh — End-to-end test runner for multi-repo minds implement pipeline.
#
# Runs 3 scenarios against the real `minds implement` CLI:
#   1. Happy path: 2 repos, cross-repo dependency, 2 waves
#   2. Single-repo backward compatibility (no workspace manifest)
#   3. N>2 repos: 3 repos, parallel minds in wave 2
#
# Each scenario creates temp git repos, writes minds.json + tasks.md,
# runs `minds implement`, and checks for successful completion.
#
# Usage:
#   scripts/e2e-multi-repo.sh           # run all 3 scenarios
#   scripts/e2e-multi-repo.sh 1         # run only scenario 1
#   scripts/e2e-multi-repo.sh 2         # run only scenario 2
#   scripts/e2e-multi-repo.sh 3         # run only scenario 3
#
# Requirements:
#   - tmux session (minds implement needs tmux for pane splitting)
#   - bun installed
#   - claude CLI installed (for drone spawning)

set -uo pipefail

# ── Constants ──────────────────────────────────────────────────────────────────

GRAVITAS_DIR="/Users/atlas/Code/projects/gravitas-multi-repo"
MINDS_CLI="$GRAVITAS_DIR/minds/cli/bin/minds.ts"
TIMESTAMP=$(date +%s)
SCENARIO_TIMEOUT=600  # 10 minutes per scenario
PASS_COUNT=0
FAIL_COUNT=0
TOTAL_SCENARIOS=0
SELECTED_SCENARIO="${1:-}"

# Success marker from implement.ts line 951
SUCCESS_MARKER="Implementation complete. All waves merged successfully."

# ── Helpers ────────────────────────────────────────────────────────────────────

log_header() {
  echo ""
  echo "================================================================"
  echo "  $1"
  echo "================================================================"
  echo ""
}

log_info() {
  echo "[INFO] $1"
}

log_pass() {
  echo "[PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

log_fail() {
  echo "[FAIL] $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

# Initialize a git repo at the given path
init_git_repo() {
  local repo_path="$1"
  mkdir -p "$repo_path"
  git -C "$repo_path" init -b main >/dev/null 2>&1
  git -C "$repo_path" config user.email "test@e2e.com"
  git -C "$repo_path" config user.name "E2E Test"
}

# Commit all files in a repo
commit_all() {
  local repo_path="$1"
  local message="${2:-initial commit}"
  git -C "$repo_path" add -A >/dev/null 2>&1
  git -C "$repo_path" commit -m "$message" --allow-empty >/dev/null 2>&1
}

# Write minds.json to a repo's .minds/ directory
write_minds_json() {
  local repo_path="$1"
  local content="$2"
  local minds_dir="$repo_path/.minds"
  mkdir -p "$minds_dir"
  echo "$content" > "$minds_dir/minds.json"
}

# Kill any bus processes associated with a ticket
cleanup_bus_processes() {
  local ticket_id="$1"
  # Kill any minds-bus processes for this ticket
  pkill -f "minds-bus.*${ticket_id}" 2>/dev/null || true
  pkill -f "minds-bridge.*${ticket_id}" 2>/dev/null || true
  pkill -f "minds-aggregator.*${ticket_id}" 2>/dev/null || true
  # Also kill any leftover bun processes from the implement run
  pkill -f "minds.ts implement ${ticket_id}" 2>/dev/null || true
  # Kill any leftover aggregator/dashboard on the default port
  pkill -f "status-aggregator" 2>/dev/null || true
  pkill -f "signal-bridge" 2>/dev/null || true
  # Free port 3737 (dashboard) if still in use
  lsof -ti:3737 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
}

# Clean up a workspace directory
cleanup_workspace() {
  local workspace_dir="$1"
  if [[ -d "$workspace_dir" ]]; then
    # Remove any git worktrees first (they have .git files pointing back)
    find "$workspace_dir" -maxdepth 3 -name ".git" -type f 2>/dev/null | while read -r gitfile; do
      local wt_dir
      wt_dir=$(dirname "$gitfile")
      local parent_repo
      parent_repo=$(grep -o 'gitdir: .*' "$gitfile" 2>/dev/null | sed 's|gitdir: ||' | sed 's|/\.git/worktrees/.*||')
      if [[ -n "$parent_repo" && -d "$parent_repo" ]]; then
        git -C "$parent_repo" worktree remove --force "$wt_dir" 2>/dev/null || true
      fi
    done
    rm -rf "$workspace_dir"
  fi
}

# Run a command in a DEDICATED tmux window so drones have full terminal height
# for pane splits. This prevents "no space for new pane" errors when multiple
# parallel minds do retry iterations.
#
# Usage: run_in_tmux_window <window_name> <log_file> <cwd> <env_vars> <cmd...>
#   env_vars is a semicolon-delimited list of KEY=VALUE pairs (or "" for none)
run_in_tmux_window() {
  local window_name="$1"
  local log_file="$2"
  local cwd="$3"
  local env_vars="$4"
  shift 4

  local sentinel="/tmp/minds-e2e-done-${window_name}-${TIMESTAMP}"
  rm -f "$sentinel"

  # Build the command to run inside the new window.
  # Export env vars, cd to working dir, run the command, capture exit code.
  local env_exports=""
  if [[ -n "$env_vars" ]]; then
    IFS=';' read -ra PAIRS <<< "$env_vars"
    for pair in "${PAIRS[@]}"; do
      env_exports+="export ${pair}; "
    done
  fi

  local inner_cmd="${env_exports}cd ${cwd} && $* > ${log_file} 2>&1; echo \$? > ${sentinel}"

  # Create a new tmux window (detached — stays in background)
  tmux new-window -d -n "$window_name" "bash -c '${inner_cmd}'"

  # Wait for the sentinel file with timeout
  local elapsed=0
  while [[ ! -f "$sentinel" ]]; do
    if [[ $elapsed -ge $SCENARIO_TIMEOUT ]]; then
      echo "[TIMEOUT] Scenario exceeded ${SCENARIO_TIMEOUT}s limit" >&2
      tmux kill-window -t "$window_name" 2>/dev/null || true
      echo "124" > "$sentinel"
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  local exit_code
  exit_code=$(cat "$sentinel" 2>/dev/null || echo "1")
  rm -f "$sentinel"

  # Kill the window (may already be gone if the command exited)
  tmux kill-window -t "$window_name" 2>/dev/null || true

  return "$exit_code"
}

# Check if the log file contains the success marker
check_success() {
  local log_file="$1"
  if grep -q "$SUCCESS_MARKER" "$log_file" 2>/dev/null; then
    return 0
  fi
  return 1
}

# ── Scenario 1: Happy Path — 2 repos, cross-repo dependency ───────────────────

scenario_1() {
  local scenario_name="Scenario 1: Happy Path — 2 repos, cross-repo dependency"
  local workspace_dir="/tmp/minds-e2e-scenario1-${TIMESTAMP}"
  local ticket_id="E2E-S1-${TIMESTAMP}"
  local log_file="/tmp/minds-e2e-scenario1-${TIMESTAMP}.log"

  log_header "$scenario_name"
  TOTAL_SCENARIOS=$((TOTAL_SCENARIOS + 1))

  # ── Create workspace directory structure ──
  mkdir -p "$workspace_dir"

  local frontend_dir="$workspace_dir/frontend"
  local backend_dir="$workspace_dir/backend"

  # ── Set up backend repo ──
  log_info "Setting up backend repo..."
  init_git_repo "$backend_dir"

  mkdir -p "$backend_dir/src/api"
  cat > "$backend_dir/src/api/types.ts" << 'TSEOF'
// Backend API types — placeholder
export interface Placeholder {
  id: string;
}
TSEOF

  cat > "$backend_dir/package.json" << 'JSONEOF'
{
  "name": "backend",
  "version": "1.0.0",
  "type": "module"
}
JSONEOF

  write_minds_json "$backend_dir" '[
  {
    "name": "api",
    "domain": "Backend API layer",
    "keywords": ["api", "rest", "types"],
    "owns_files": ["backend:**"],
    "capabilities": ["typescript"],
    "repo": "backend"
  }
]'

  commit_all "$backend_dir" "initial backend"

  # ── Set up frontend repo (orchestrator) ──
  log_info "Setting up frontend repo (orchestrator)..."
  init_git_repo "$frontend_dir"

  mkdir -p "$frontend_dir/src/ui"
  cat > "$frontend_dir/src/ui/app.ts" << 'TSEOF'
// Frontend UI — placeholder
export function render(): string {
  return "hello";
}
TSEOF

  cat > "$frontend_dir/package.json" << 'JSONEOF'
{
  "name": "frontend",
  "version": "1.0.0",
  "type": "module"
}
JSONEOF

  write_minds_json "$frontend_dir" '[
  {
    "name": "ui",
    "domain": "Frontend UI layer",
    "keywords": ["ui", "frontend", "components"],
    "owns_files": ["frontend:**"],
    "capabilities": ["typescript"],
    "repo": "frontend"
  }
]'

  # Create specs directory with tasks
  mkdir -p "$frontend_dir/specs/${ticket_id}"
  cat > "$frontend_dir/specs/${ticket_id}/tasks.md" << MDEOF
# ${ticket_id}: E2E Happy Path Test

## @api Tasks (repo: backend, owns: backend:**)

- [ ] T001 @api Add UserResponse type to src/api/types.ts — produces: UserResponse at src/api/types.ts

## @ui Tasks (repo: frontend, owns: frontend:**, depends on: @api)

- [ ] T002 @ui Add user display comment — consumes: UserResponse from src/api/types.ts
MDEOF

  commit_all "$frontend_dir" "initial frontend with specs"

  # ── Write workspace manifest ──
  cat > "$workspace_dir/minds-workspace.json" << JSONEOF
{
  "version": 1,
  "orchestratorRepo": "frontend",
  "repos": [
    { "alias": "frontend", "path": "./frontend", "testCommand": "echo tests-pass" },
    { "alias": "backend", "path": "./backend", "testCommand": "echo tests-pass" }
  ]
}
JSONEOF

  # ── Run the pipeline in a dedicated tmux window ──
  log_info "Running minds implement ${ticket_id}..."
  log_info "Workspace manifest: $workspace_dir/minds-workspace.json"
  log_info "Log file: $log_file"

  run_in_tmux_window "e2e-s1" "$log_file" "$frontend_dir" \
    "MINDS_WORKSPACE=$workspace_dir/minds-workspace.json" \
    bun "$MINDS_CLI" implement "$ticket_id"

  # ── Check result ──
  if check_success "$log_file"; then
    log_pass "$scenario_name"
  else
    log_fail "$scenario_name"
    echo "--- Last 40 lines of log ---"
    tail -40 "$log_file" 2>/dev/null || true
    echo "--- End log ---"
  fi

  # ── Cleanup ──
  cleanup_bus_processes "$ticket_id"
  cleanup_workspace "$workspace_dir"
  rm -f "$log_file"
}

# ── Scenario 2: Single-repo backward compatibility ─────────────────────────────

scenario_2() {
  local scenario_name="Scenario 2: Single-repo backward compatibility"
  local workspace_dir="/tmp/minds-e2e-scenario2-${TIMESTAMP}"
  local ticket_id="E2E-S2-${TIMESTAMP}"
  local log_file="/tmp/minds-e2e-scenario2-${TIMESTAMP}.log"

  log_header "$scenario_name"
  TOTAL_SCENARIOS=$((TOTAL_SCENARIOS + 1))

  # ── Create single repo ──
  log_info "Setting up single repo..."
  init_git_repo "$workspace_dir"

  mkdir -p "$workspace_dir/src/core"
  cat > "$workspace_dir/src/core/index.ts" << 'TSEOF'
// Core module — placeholder
export const VERSION = "1.0.0";
TSEOF

  cat > "$workspace_dir/package.json" << 'JSONEOF'
{
  "name": "single-repo",
  "version": "1.0.0",
  "type": "module"
}
JSONEOF

  # Add a passing test so `bun test` succeeds (supervisor defaults to bun test
  # when no testCommand is provided in single-repo mode)
  mkdir -p "$workspace_dir/src/core"
  cat > "$workspace_dir/src/core/index.test.ts" << 'TSEOF'
import { expect, test } from "bun:test";
import { VERSION } from "./index.ts";
test("VERSION is defined", () => { expect(VERSION).toBe("1.0.0"); });
TSEOF

  write_minds_json "$workspace_dir" '[
  {
    "name": "core",
    "domain": "Core module",
    "keywords": ["core"],
    "owns_files": ["src/**"],
    "capabilities": ["typescript"]
  }
]'

  # Create specs directory with tasks (NO repo: annotation, NO depends on)
  mkdir -p "$workspace_dir/specs/${ticket_id}"
  cat > "$workspace_dir/specs/${ticket_id}/tasks.md" << MDEOF
# ${ticket_id}: E2E Single Repo Test

## @core Tasks (owns: src/**)

- [ ] T001 @core Add version comment to index.ts
MDEOF

  commit_all "$workspace_dir" "initial single-repo"

  # ── Run the pipeline in a dedicated tmux window (NO MINDS_WORKSPACE) ──
  log_info "Running minds implement ${ticket_id} (single-repo mode)..."
  log_info "Log file: $log_file"

  run_in_tmux_window "e2e-s2" "$log_file" "$workspace_dir" "" \
    bun "$MINDS_CLI" implement "$ticket_id"

  # ── Check result ──
  if check_success "$log_file"; then
    log_pass "$scenario_name"
  else
    log_fail "$scenario_name"
    echo "--- Last 40 lines of log ---"
    tail -40 "$log_file" 2>/dev/null || true
    echo "--- End log ---"
  fi

  # ── Cleanup ──
  cleanup_bus_processes "$ticket_id"
  cleanup_workspace "$workspace_dir"
  rm -f "$log_file"
}

# ── Scenario 3: N>2 repos — 3 repos, complex wave structure ───────────────────

scenario_3() {
  local scenario_name="Scenario 3: N>2 repos — 3 repos, parallel wave 2"
  local workspace_dir="/tmp/minds-e2e-scenario3-${TIMESTAMP}"
  local ticket_id="E2E-S3-${TIMESTAMP}"
  local log_file="/tmp/minds-e2e-scenario3-${TIMESTAMP}.log"

  log_header "$scenario_name"
  TOTAL_SCENARIOS=$((TOTAL_SCENARIOS + 1))

  mkdir -p "$workspace_dir"

  local frontend_dir="$workspace_dir/frontend"
  local backend_dir="$workspace_dir/backend"
  local shared_dir="$workspace_dir/shared"

  # ── Set up shared repo ──
  log_info "Setting up shared repo..."
  init_git_repo "$shared_dir"

  mkdir -p "$shared_dir/src/types"
  cat > "$shared_dir/src/types/index.ts" << 'TSEOF'
// Shared types — placeholder
export interface BaseEntity {
  id: string;
}
TSEOF

  cat > "$shared_dir/package.json" << 'JSONEOF'
{
  "name": "shared",
  "version": "1.0.0",
  "type": "module"
}
JSONEOF

  write_minds_json "$shared_dir" '[
  {
    "name": "types",
    "domain": "Shared type definitions",
    "keywords": ["types", "shared", "interfaces"],
    "owns_files": ["shared:**"],
    "capabilities": ["typescript"],
    "repo": "shared"
  }
]'

  commit_all "$shared_dir" "initial shared"

  # ── Set up backend repo ──
  log_info "Setting up backend repo..."
  init_git_repo "$backend_dir"

  mkdir -p "$backend_dir/src/api"
  cat > "$backend_dir/src/api/handler.ts" << 'TSEOF'
// Backend API handler — placeholder
export function handleRequest(): string {
  return "ok";
}
TSEOF

  cat > "$backend_dir/package.json" << 'JSONEOF'
{
  "name": "backend",
  "version": "1.0.0",
  "type": "module"
}
JSONEOF

  write_minds_json "$backend_dir" '[
  {
    "name": "api",
    "domain": "Backend API layer",
    "keywords": ["api", "rest"],
    "owns_files": ["backend:**"],
    "capabilities": ["typescript"],
    "repo": "backend"
  }
]'

  commit_all "$backend_dir" "initial backend"

  # ── Set up frontend repo (orchestrator) ──
  log_info "Setting up frontend repo (orchestrator)..."
  init_git_repo "$frontend_dir"

  mkdir -p "$frontend_dir/src/ui"
  cat > "$frontend_dir/src/ui/app.ts" << 'TSEOF'
// Frontend UI — placeholder
export function render(): string {
  return "hello";
}
TSEOF

  cat > "$frontend_dir/package.json" << 'JSONEOF'
{
  "name": "frontend",
  "version": "1.0.0",
  "type": "module"
}
JSONEOF

  write_minds_json "$frontend_dir" '[
  {
    "name": "ui",
    "domain": "Frontend UI layer",
    "keywords": ["ui", "frontend"],
    "owns_files": ["frontend:**"],
    "capabilities": ["typescript"],
    "repo": "frontend"
  }
]'

  # Create specs directory with tasks — 3-mind, 2-wave structure
  # Wave 1: @types (no deps)
  # Wave 2: @api (depends on @types), @ui (depends on @types) — parallel
  mkdir -p "$frontend_dir/specs/${ticket_id}"
  cat > "$frontend_dir/specs/${ticket_id}/tasks.md" << MDEOF
# ${ticket_id}: E2E Three Repo Test

## @types Tasks (repo: shared, owns: shared:**)

- [ ] T001 @types Add UserEntity type — produces: UserEntity at src/types/index.ts

## @api Tasks (repo: backend, owns: backend:**, depends on: @types)

- [ ] T002 @api Add user handler comment — consumes: UserEntity from src/types/index.ts

## @ui Tasks (repo: frontend, owns: frontend:**, depends on: @types)

- [ ] T003 @ui Add user display comment to src/ui/app.ts — consumes: UserEntity from src/types/index.ts
MDEOF

  commit_all "$frontend_dir" "initial frontend with specs"

  # ── Write workspace manifest ──
  cat > "$workspace_dir/minds-workspace.json" << JSONEOF
{
  "version": 1,
  "orchestratorRepo": "frontend",
  "repos": [
    { "alias": "frontend", "path": "./frontend", "testCommand": "echo tests-pass" },
    { "alias": "backend", "path": "./backend", "testCommand": "echo tests-pass" },
    { "alias": "shared", "path": "./shared", "testCommand": "echo tests-pass" }
  ]
}
JSONEOF

  # ── Run the pipeline in a dedicated tmux window ──
  log_info "Running minds implement ${ticket_id}..."
  log_info "Workspace manifest: $workspace_dir/minds-workspace.json"
  log_info "Log file: $log_file"

  run_in_tmux_window "e2e-s3" "$log_file" "$frontend_dir" \
    "MINDS_WORKSPACE=$workspace_dir/minds-workspace.json" \
    bun "$MINDS_CLI" implement "$ticket_id"

  # ── Check result ──
  if check_success "$log_file"; then
    log_pass "$scenario_name"
  else
    log_fail "$scenario_name"
    echo "--- Last 40 lines of log ---"
    tail -40 "$log_file" 2>/dev/null || true
    echo "--- End log ---"
  fi

  # ── Cleanup ──
  cleanup_bus_processes "$ticket_id"
  cleanup_workspace "$workspace_dir"
  rm -f "$log_file"
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
  log_header "E2E Multi-Repo Test Suite"
  echo "Gravitas dir: $GRAVITAS_DIR"
  echo "Timestamp: $TIMESTAMP"
  echo "Scenario timeout: ${SCENARIO_TIMEOUT}s"
  echo ""

  # Clean up any leftover processes from previous runs
  pkill -f "status-aggregator" 2>/dev/null || true
  pkill -f "signal-bridge" 2>/dev/null || true
  pkill -f "minds-bus" 2>/dev/null || true
  lsof -ti:3737 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1

  # Verify prerequisites
  if ! command -v bun &>/dev/null; then
    echo "ERROR: bun not found in PATH"
    exit 1
  fi

  if ! command -v tmux &>/dev/null; then
    echo "ERROR: tmux not found in PATH"
    exit 1
  fi

  if [[ -z "${TMUX:-}" ]]; then
    echo "ERROR: Not running inside a tmux session (minds implement needs tmux)"
    exit 1
  fi

  if [[ ! -f "$MINDS_CLI" ]]; then
    echo "ERROR: Minds CLI not found at $MINDS_CLI"
    exit 1
  fi

  if ! command -v claude &>/dev/null; then
    echo "ERROR: claude CLI not found in PATH (needed for drone spawning)"
    exit 1
  fi

  # Run selected or all scenarios
  if [[ -z "$SELECTED_SCENARIO" ]]; then
    scenario_1
    scenario_2
    scenario_3
  else
    case "$SELECTED_SCENARIO" in
      1) scenario_1 ;;
      2) scenario_2 ;;
      3) scenario_3 ;;
      *)
        echo "ERROR: Unknown scenario $SELECTED_SCENARIO (valid: 1, 2, 3)"
        exit 1
        ;;
    esac
  fi

  # ── Final Report ──
  log_header "E2E Test Results"
  echo "  Passed: $PASS_COUNT / $TOTAL_SCENARIOS"
  echo "  Failed: $FAIL_COUNT / $TOTAL_SCENARIOS"
  echo ""

  if [[ $FAIL_COUNT -eq 0 ]]; then
    echo "ALL SCENARIOS PASSED"
    exit 0
  else
    echo "SOME SCENARIOS FAILED"
    exit 1
  fi
}

main
