#!/usr/bin/env bash
# Deterministic orchestrator initialization script
# Replaces AI logic for pane setup, worktree resolution, registry creation

set -euo pipefail

TICKET_ID="$1"
ORCHESTRATOR_PANE="$TMUX_PANE"
# Detect repo root and use local state directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.collab/state/pipeline-registry"
GROUPS_DIR="$REPO_ROOT/.collab/state/pipeline-groups"

# Ensure directories exist
mkdir -p "$REGISTRY_DIR" "$GROUPS_DIR"

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

# Spawn agent pane (70% horizontal split)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_PANE=$(bun "$SCRIPT_DIR/Tmux.ts" split \
  -w "$ORCHESTRATOR_PANE" --horizontal --percentage 70 -c "$SPAWN_CMD")

# Label agent pane
bun "$SCRIPT_DIR/Tmux.ts" label \
  -w "$AGENT_PANE" -T "$TICKET_ID" --color 1

# Generate nonce
NONCE=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 5)

# Create registry atomically
cat > "$REGISTRY_DIR/${TICKET_ID}.json.tmp" <<EOF
{
  "orchestrator_pane_id": "$ORCHESTRATOR_PANE",
  "agent_pane_id": "$AGENT_PANE",
  "ticket_id": "$TICKET_ID",
  "nonce": "$NONCE",
  "current_step": "clarify",
  "color_index": 1,
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
mv "$REGISTRY_DIR/${TICKET_ID}.json.tmp" "$REGISTRY_DIR/${TICKET_ID}.json"

# Output for orchestrator
echo "AGENT_PANE=$AGENT_PANE"
echo "NONCE=$NONCE"
echo "REGISTRY=$REGISTRY_DIR/${TICKET_ID}.json"
