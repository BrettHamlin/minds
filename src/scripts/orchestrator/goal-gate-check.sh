#!/usr/bin/env bash
# ============================================================================
# goal-gate-check.sh - Verify goal gate requirements before terminal advance
# ============================================================================
#
# Purpose:
#   Before advancing to the terminal phase ("done"), check that all phases
#   with a goal_gate field in pipeline.json have been satisfied in this
#   ticket's phase_history.
#
#   goal_gate values:
#     "always"       — phase MUST appear in phase_history with a _COMPLETE signal
#     "if_triggered" — only required if phase_history contains ANY entry for this phase
#
#   This is a generic interpreter: goal gate requirements live in pipeline.json.
#   Adding, removing, or changing goal gates requires NO changes to this script.
#
# Usage:
#   goal-gate-check.sh <TICKET_ID>
#
# Output (stdout):
#   "PASS" — all goal gates satisfied, advance to terminal
#   "REDIRECT:<phase_id>" — first failing phase that must complete first
#
# Exit codes:
#   0 = all gates passed (stdout contains "PASS")
#   1 = usage error
#   2 = gate failure (stdout contains "REDIRECT:<phase_id>")
#   3 = file error (registry or pipeline.json missing)
# ============================================================================

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.collab/state/pipeline-registry"
CONFIG_FILE="$REPO_ROOT/.collab/config/pipeline.json"

# --- Validate arguments ---
if [ $# -lt 1 ]; then
  echo "Usage: goal-gate-check.sh <TICKET_ID>" >&2
  exit 1
fi

TICKET_ID="$1"

# --- Validate files ---
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: pipeline.json not found: $CONFIG_FILE" >&2
  exit 3
fi

REGISTRY_FILE="$REGISTRY_DIR/${TICKET_ID}.json"
if [ ! -f "$REGISTRY_FILE" ]; then
  echo "Error: Registry not found for ticket: $TICKET_ID" >&2
  exit 3
fi

# --- Read phase_history from registry ---
PHASE_HISTORY=$(jq -c '.phase_history // []' "$REGISTRY_FILE" 2>/dev/null)

# --- Get all phases with goal_gate field, in array order ---
GATED_PHASES=$(jq -c '[.phases[] | select(.goal_gate != null) | {id: .id, goal_gate: .goal_gate}]' \
  "$CONFIG_FILE" 2>/dev/null)

GATED_COUNT=$(echo "$GATED_PHASES" | jq 'length')

if [ "$GATED_COUNT" -eq 0 ]; then
  echo "PASS"
  exit 0
fi

# --- Evaluate each gated phase in order ---
FIRST_FAILING=""

for i in $(seq 0 $((GATED_COUNT - 1))); do
  PHASE_ID=$(echo "$GATED_PHASES" | jq -r ".[$i].id")
  GATE_TYPE=$(echo "$GATED_PHASES" | jq -r ".[$i].goal_gate")

  case "$GATE_TYPE" in
    always)
      # Phase MUST appear in phase_history with a _COMPLETE signal
      COMPLETE_COUNT=$(echo "$PHASE_HISTORY" | jq -r \
        --arg phase "$PHASE_ID" \
        'map(select(.phase == $phase and (.signal | endswith("_COMPLETE")))) | length')
      if [ "$COMPLETE_COUNT" -eq 0 ]; then
        FIRST_FAILING="$PHASE_ID"
        break
      fi
      ;;

    if_triggered)
      # Only check if phase_history has ANY entry for this phase
      ANY_COUNT=$(echo "$PHASE_HISTORY" | jq -r \
        --arg phase "$PHASE_ID" \
        'map(select(.phase == $phase)) | length')
      if [ "$ANY_COUNT" -gt 0 ]; then
        # Phase was triggered — verify it completed
        COMPLETE_COUNT=$(echo "$PHASE_HISTORY" | jq -r \
          --arg phase "$PHASE_ID" \
          'map(select(.phase == $phase and (.signal | endswith("_COMPLETE")))) | length')
        if [ "$COMPLETE_COUNT" -eq 0 ]; then
          FIRST_FAILING="$PHASE_ID"
          break
        fi
      fi
      # If not triggered, skip (no requirement)
      ;;

    *)
      echo "Warning: Unknown goal_gate type '$GATE_TYPE' for phase '$PHASE_ID'" >&2
      ;;
  esac
done

# --- Output result ---
if [ -n "$FIRST_FAILING" ]; then
  echo "REDIRECT:$FIRST_FAILING"
  exit 2
fi

echo "PASS"
exit 0
