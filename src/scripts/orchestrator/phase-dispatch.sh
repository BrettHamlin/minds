#!/usr/bin/env bash
# ============================================================================
# phase-dispatch.sh - Dispatch a pipeline phase to the agent pane
# ============================================================================
#
# Purpose:
#   Read a phase's command from pipeline.json, check coordination.json for
#   hold conditions, read the agent pane from the registry, and send the
#   command to the agent via Tmux.ts.
#
#   This is a generic interpreter: it reads its rules from pipeline.json.
#   Adding, renaming, or reordering phases requires NO changes to this script.
#
# Usage:
#   phase-dispatch.sh <TICKET_ID> <PHASE_ID>
#
# Output (stdout):
#   "Dispatched <phase_id> to <agent_pane>: <command>"
#   If held: "HELD: <ticket_id> at <phase_id> — waiting for <dep_id>:<dep_phase>"
#
# Exit codes:
#   0 = dispatched (or held — caller should check stdout for HELD prefix)
#   1 = usage error
#   2 = validation error (phase not found in pipeline.json)
#   3 = file error (registry not found, pipeline.json missing)
# ============================================================================

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.collab/state/pipeline-registry"
CONFIG_FILE="$REPO_ROOT/.collab/config/pipeline.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Validate arguments ---
if [ $# -lt 2 ]; then
  echo "Usage: phase-dispatch.sh <TICKET_ID> <PHASE_ID>" >&2
  exit 1
fi

TICKET_ID="$1"
PHASE_ID="$2"

# --- Validate pipeline.json exists ---
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: pipeline.json not found: $CONFIG_FILE" >&2
  exit 3
fi

# --- Read registry for agent pane ---
REGISTRY_FILE="$REGISTRY_DIR/${TICKET_ID}.json"
if [ ! -f "$REGISTRY_FILE" ]; then
  echo "Error: Registry not found for ticket: $TICKET_ID" >&2
  exit 3
fi

AGENT_PANE=$(jq -r '.agent_pane_id // empty' "$REGISTRY_FILE" 2>/dev/null)
if [ -z "$AGENT_PANE" ]; then
  echo "Error: No agent_pane_id in registry for $TICKET_ID" >&2
  exit 3
fi

# --- Check coordination.json for hold conditions ---
COORD_FILE="$REPO_ROOT/specs/$TICKET_ID/coordination.json"
if [ -f "$COORD_FILE" ]; then
  # Read wait_for entries
  WAIT_FOR=$(jq -c '.wait_for // []' "$COORD_FILE" 2>/dev/null)
  WAIT_COUNT=$(echo "$WAIT_FOR" | jq 'length')

  if [ "$WAIT_COUNT" -gt 0 ]; then
    # Check each dependency
    HOLDING_DEP=""
    while IFS= read -r dep; do
      DEP_TICKET=$(echo "$dep" | jq -r '.ticket_id')
      DEP_PHASE=$(echo "$dep" | jq -r '.phase')

      # Check if dependency ticket's phase_history has a _COMPLETE entry for the required phase
      DEP_REGISTRY="$REGISTRY_DIR/${DEP_TICKET}.json"
      SATISFIED=false

      if [ -f "$DEP_REGISTRY" ]; then
        MATCH=$(jq -r --arg phase "$DEP_PHASE" \
          '.phase_history // [] | map(select(.phase == $phase and (.signal | endswith("_COMPLETE")))) | length' \
          "$DEP_REGISTRY" 2>/dev/null || echo "0")
        [ "$MATCH" -gt 0 ] && SATISFIED=true
      fi

      if [ "$SATISFIED" = false ]; then
        HOLDING_DEP="${DEP_TICKET}:${DEP_PHASE}"
        break
      fi
    done < <(echo "$WAIT_FOR" | jq -c '.[]')

    if [ -n "$HOLDING_DEP" ]; then
      # Update registry to held state
      "$SCRIPT_DIR/registry-update.sh" "$TICKET_ID" \
        status=held \
        held_at="$PHASE_ID" \
        waiting_for="$HOLDING_DEP"
      echo "HELD: $TICKET_ID at $PHASE_ID — waiting for $HOLDING_DEP"
      exit 0
    fi
  fi
fi

# --- Resolve phase command from pipeline.json ---
# Support both shorthand (command field) and actions array
HAS_COMMAND=$(jq -r --arg id "$PHASE_ID" \
  '.phases[] | select(.id == $id) | .command // empty' \
  "$CONFIG_FILE" 2>/dev/null)

HAS_ACTIONS=$(jq -r --arg id "$PHASE_ID" \
  '.phases[] | select(.id == $id) | if .actions then "yes" else empty end' \
  "$CONFIG_FILE" 2>/dev/null)

if [ -z "$HAS_COMMAND" ] && [ -z "$HAS_ACTIONS" ]; then
  # Check if phase exists at all
  PHASE_EXISTS=$(jq -r --arg id "$PHASE_ID" \
    '.phases[] | select(.id == $id) | .id' \
    "$CONFIG_FILE" 2>/dev/null)
  if [ -z "$PHASE_EXISTS" ]; then
    echo "Error: Phase '$PHASE_ID' not found in pipeline.json" >&2
    exit 2
  fi
  # Phase exists but has no command or actions (e.g. terminal phase)
  echo "Phase '$PHASE_ID' has no dispatchable command (terminal or no-op)."
  exit 0
fi

# --- Dispatch: command shorthand ---
if [ -n "$HAS_COMMAND" ]; then
  CMD="$HAS_COMMAND"
  bun "$SCRIPT_DIR/Tmux.ts" send -w "$AGENT_PANE" -t "$CMD" -d 5
  echo "Dispatched $PHASE_ID to $AGENT_PANE: $CMD"
  exit 0
fi

# --- Dispatch: actions array ---
# For each action, dispatch in order
# display: print to stdout (orchestrator output, not to agent)
# prompt / command: send to agent pane
ACTION_COUNT=$(jq -r --arg id "$PHASE_ID" \
  '.phases[] | select(.id == $id) | .actions | length' \
  "$CONFIG_FILE" 2>/dev/null || echo "0")

for i in $(seq 0 $((ACTION_COUNT - 1))); do
  ACTION_TYPE=$(jq -r --arg id "$PHASE_ID" --argjson i "$i" \
    '.phases[] | select(.id == $id) | .actions[$i] | keys[0]' \
    "$CONFIG_FILE" 2>/dev/null)
  ACTION_VALUE=$(jq -r --arg id "$PHASE_ID" --argjson i "$i" --arg type "$ACTION_TYPE" \
    '.phases[] | select(.id == $id) | .actions[$i][$type]' \
    "$CONFIG_FILE" 2>/dev/null)

  case "$ACTION_TYPE" in
    display)
      # Token substitution not performed here (requires AI context like TICKET_TITLE)
      # Print raw display value to stdout for orchestrator to see
      echo "[Display] $ACTION_VALUE"
      ;;
    prompt|command)
      bun "$SCRIPT_DIR/Tmux.ts" send -w "$AGENT_PANE" -t "$ACTION_VALUE" -d 1
      echo "Dispatched $PHASE_ID action '$ACTION_TYPE' to $AGENT_PANE: $ACTION_VALUE"
      ;;
    *)
      echo "Warning: Unknown action type '$ACTION_TYPE' in phase '$PHASE_ID'" >&2
      ;;
  esac
done

exit 0
