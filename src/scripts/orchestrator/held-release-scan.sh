#!/usr/bin/env bash
# ============================================================================
# held-release-scan.sh - Scan registries and release held agents
# ============================================================================
#
# Purpose:
#   After a phase completes, scan all pipeline registry files for agents
#   with status=held. For each held agent, check if all wait_for dependencies
#   in coordination.json are now satisfied (dependency phase appears in
#   phase_history with a _COMPLETE signal). Release satisfied agents.
#
#   This is a generic interpreter: coordination rules live in coordination.json,
#   not in this script. Adding or changing dependencies requires no script changes.
#
# Usage:
#   held-release-scan.sh [COMPLETED_TICKET_ID]
#
#   COMPLETED_TICKET_ID is optional — provided for logging context only.
#
# Output (stdout):
#   "Released <ticket_id> (was held waiting for <dep>)"
#   "Still held: <ticket_id> — waiting for <dep_id>:<dep_phase>"
#   "No held agents found."
#
# Exit codes:
#   0 = scan completed (whether or not any agents were released)
#   1 = usage error
#   3 = file error (registry dir missing)
# ============================================================================

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.collab/state/pipeline-registry"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

COMPLETED_TICKET="${1:-}"

# --- Validate registry dir ---
if [ ! -d "$REGISTRY_DIR" ]; then
  echo "Error: Registry directory not found: $REGISTRY_DIR" >&2
  exit 3
fi

# --- Scan all registry files ---
HELD_COUNT=0
RELEASED_COUNT=0

for reg_file in "$REGISTRY_DIR"/*.json; do
  [ -f "$reg_file" ] || continue

  STATUS=$(jq -r '.status // empty' "$reg_file" 2>/dev/null)
  [ "$STATUS" = "held" ] || continue

  HELD_COUNT=$((HELD_COUNT + 1))
  HELD_TICKET=$(jq -r '.ticket_id' "$reg_file" 2>/dev/null)
  HELD_AT=$(jq -r '.held_at // empty' "$reg_file" 2>/dev/null)

  # Read coordination.json for this ticket
  COORD_FILE="$REPO_ROOT/specs/$HELD_TICKET/coordination.json"
  if [ ! -f "$COORD_FILE" ]; then
    echo "Warning: $HELD_TICKET is held but has no coordination.json — releasing" >&2
    "$SCRIPT_DIR/registry-update.sh" "$HELD_TICKET" status=running held_at= waiting_for=
    RELEASED_COUNT=$((RELEASED_COUNT + 1))
    continue
  fi

  WAIT_FOR=$(jq -c '.wait_for // []' "$COORD_FILE" 2>/dev/null)
  WAIT_COUNT=$(echo "$WAIT_FOR" | jq 'length')

  if [ "$WAIT_COUNT" -eq 0 ]; then
    echo "Warning: $HELD_TICKET is held but wait_for is empty — releasing" >&2
    "$SCRIPT_DIR/registry-update.sh" "$HELD_TICKET" status=running held_at= waiting_for=
    RELEASED_COUNT=$((RELEASED_COUNT + 1))
    continue
  fi

  # Check each dependency
  ALL_SATISFIED=true
  BLOCKING_DEP=""

  while IFS= read -r dep; do
    DEP_TICKET=$(echo "$dep" | jq -r '.ticket_id')
    DEP_PHASE=$(echo "$dep" | jq -r '.phase')

    DEP_REGISTRY="$REGISTRY_DIR/${DEP_TICKET}.json"
    SATISFIED=false

    if [ -f "$DEP_REGISTRY" ]; then
      MATCH=$(jq -r --arg phase "$DEP_PHASE" \
        '.phase_history // [] | map(select(.phase == $phase and (.signal | endswith("_COMPLETE")))) | length' \
        "$DEP_REGISTRY" 2>/dev/null || echo "0")
      [ "$MATCH" -gt 0 ] && SATISFIED=true
    fi

    if [ "$SATISFIED" = false ]; then
      ALL_SATISFIED=false
      BLOCKING_DEP="${DEP_TICKET}:${DEP_PHASE}"
      break
    fi
  done < <(echo "$WAIT_FOR" | jq -c '.[]')

  if [ "$ALL_SATISFIED" = true ]; then
    "$SCRIPT_DIR/registry-update.sh" "$HELD_TICKET" status=running held_at= waiting_for=
    echo "Released $HELD_TICKET (was held at $HELD_AT)"
    RELEASED_COUNT=$((RELEASED_COUNT + 1))
  else
    echo "Still held: $HELD_TICKET — waiting for $BLOCKING_DEP"
  fi
done

if [ "$HELD_COUNT" -eq 0 ]; then
  echo "No held agents found."
fi

exit 0
