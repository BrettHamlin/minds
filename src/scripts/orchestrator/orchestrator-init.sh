#!/usr/bin/env bash
# Deterministic orchestrator initialization script
# Replaces AI logic for pane setup, worktree resolution, registry creation
# v3: Adds schema validation and coordination check at startup

set -euo pipefail

TICKET_ID="$1"
ORCHESTRATOR_PANE="$TMUX_PANE"
# Detect repo root and use local state directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.collab/state/pipeline-registry"
GROUPS_DIR="$REPO_ROOT/.collab/state/pipeline-groups"
CONFIG_FILE="$REPO_ROOT/.collab/config/pipeline.json"
SCHEMA_FILE="$REPO_ROOT/.collab/config/pipeline.v3.schema.json"
SCRIPTS_DIR="$REPO_ROOT/.collab/scripts/orchestrator"

# Ensure directories exist
mkdir -p "$REGISTRY_DIR" "$GROUPS_DIR"

# ============================================================================
# Step 1: Schema validation (before spawning any panes)
# ============================================================================

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "Error: Schema file not found: $SCHEMA_FILE" >&2
  echo "Run 'cp src/config/pipeline.v3.schema.json .collab/config/' to deploy it." >&2
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Pipeline config not found: $CONFIG_FILE" >&2
  exit 1
fi

echo "Validating pipeline.json against v3 schema..." >&2
AJV_BIN="$REPO_ROOT/node_modules/.bin/ajv"
if [ ! -f "$AJV_BIN" ]; then
  echo "Error: ajv CLI not found at $AJV_BIN" >&2
  echo "Run 'bun install' in the collab repo root ($REPO_ROOT) to install it." >&2
  exit 3
fi
VALIDATION_OUTPUT=$("$AJV_BIN" validate \
  --spec=draft2020 \
  --strict=false \
  -s "$SCHEMA_FILE" \
  -d "$CONFIG_FILE" \
  --errors=json \
  --all-errors 2>&1 || true)

if ! "$AJV_BIN" validate --spec=draft2020 --strict=false -s "$SCHEMA_FILE" -d "$CONFIG_FILE" --errors=json --all-errors > /dev/null 2>&1; then
  echo "Error: pipeline.json failed schema validation:" >&2
  echo "$VALIDATION_OUTPUT" >&2
  echo "Fix the errors above before running the pipeline." >&2
  exit 1
fi

echo "Schema validation passed." >&2

# ============================================================================
# Step 2: Coordination check (before spawning panes)
# ============================================================================

# Collect all existing session ticket IDs from registry
SESSION_TICKETS=()
for reg_file in "$REGISTRY_DIR"/*.json; do
  [ -f "$reg_file" ] || continue
  existing_id=$(jq -r '.ticket_id // empty' "$reg_file" 2>/dev/null)
  [ -n "$existing_id" ] && SESSION_TICKETS+=("$existing_id")
done
# Add new ticket
SESSION_TICKETS+=("$TICKET_ID")

# Run coordination check if the script exists
if [ -f "$SCRIPTS_DIR/coordination-check.sh" ]; then
  echo "Running coordination check for ${#SESSION_TICKETS[@]} tickets..." >&2
  if ! "$SCRIPTS_DIR/coordination-check.sh" "${SESSION_TICKETS[@]}"; then
    echo "Error: Coordination check failed. Fix coordination.json files before running." >&2
    exit 1
  fi
fi

# ============================================================================
# Step 3: Resolve repo and worktree paths
# ============================================================================

# Find main repo root (handles worktree case)
REPO_ROOT=$(git rev-parse --show-superproject-working-tree 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
fi

# Scan for metadata.json matching ticket ID
WORKTREE_PATH=""
for metadata in "$REPO_ROOT"/specs/*/metadata.json; do
  if [ -f "$metadata" ]; then
    TICKET=$(jq -r '.ticket_id // empty' "$metadata" 2>/dev/null)
    if [ "$TICKET" = "$TICKET_ID" ]; then
      WORKTREE_PATH=$(jq -r '.worktree_path // empty' "$metadata" 2>/dev/null)
      if [ -d "$WORKTREE_PATH" ]; then
        echo "Using worktree: $WORKTREE_PATH" >&2
        break
      else
        echo "ERROR: Worktree path does not exist: $WORKTREE_PATH" >&2
        exit 1
      fi
    fi
  fi
done

# Determine spawn command
if [ -n "$WORKTREE_PATH" ]; then
  SPAWN_CMD="cd '$WORKTREE_PATH' && claude --dangerously-skip-permissions"
else
  echo "No worktree metadata found, using current directory" >&2
  SPAWN_CMD="claude --dangerously-skip-permissions"
fi

# ============================================================================
# Step 4: Set up symlinks
# ============================================================================

# Ensure .claude/ symlink exists in worktree
if [ -n "$WORKTREE_PATH" ] && [ -d "$REPO_ROOT/.claude" ]; then
  if [ -e "$WORKTREE_PATH/.claude" ] && [ ! -L "$WORKTREE_PATH/.claude" ]; then
    rm -rf "$WORKTREE_PATH/.claude"
    echo "Removed non-symlink .claude/ directory in worktree" >&2
  fi
  if [ ! -e "$WORKTREE_PATH/.claude" ]; then
    ln -sf "$REPO_ROOT/.claude" "$WORKTREE_PATH/.claude"
    echo "Created .claude/ symlink in worktree" >&2
  fi
fi

# Ensure .collab/ symlink exists in worktree (for signal handlers)
if [ -n "$WORKTREE_PATH" ] && [ -d "$REPO_ROOT/.collab" ]; then
  if [ -e "$WORKTREE_PATH/.collab" ] && [ ! -L "$WORKTREE_PATH/.collab" ]; then
    rm -rf "$WORKTREE_PATH/.collab"
    echo "Removed non-symlink .collab/ directory in worktree" >&2
  fi
  if [ ! -e "$WORKTREE_PATH/.collab" ]; then
    ln -sf "$REPO_ROOT/.collab" "$WORKTREE_PATH/.collab"
    echo "Created .collab/ symlink in worktree" >&2
  fi
fi

# ============================================================================
# Step 5: Spawn agent pane
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_PANE=$(bun "$SCRIPT_DIR/Tmux.ts" split \
  -w "$ORCHESTRATOR_PANE" --horizontal --percentage 70 -c "$SPAWN_CMD")

# Label agent pane
bun "$SCRIPT_DIR/Tmux.ts" label \
  -w "$AGENT_PANE" -T "$TICKET_ID" --color 1

# ============================================================================
# Step 6: Create registry
# ============================================================================

# Generate nonce
NONCE=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 5)

# Read first phase ID from pipeline.json
FIRST_PHASE=$(jq -r '.phases[0].id' "$CONFIG_FILE" 2>/dev/null || echo "clarify")

# Create registry atomically
cat > "$REGISTRY_DIR/${TICKET_ID}.json.tmp" <<EOF
{
  "orchestrator_pane_id": "$ORCHESTRATOR_PANE",
  "agent_pane_id": "$AGENT_PANE",
  "ticket_id": "$TICKET_ID",
  "nonce": "$NONCE",
  "current_step": "$FIRST_PHASE",
  "color_index": 1,
  "phase_history": [],
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
mv "$REGISTRY_DIR/${TICKET_ID}.json.tmp" "$REGISTRY_DIR/${TICKET_ID}.json"

# Output for orchestrator
echo "AGENT_PANE=$AGENT_PANE"
echo "NONCE=$NONCE"
echo "REGISTRY=$REGISTRY_DIR/${TICKET_ID}.json"
