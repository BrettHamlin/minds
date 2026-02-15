#!/usr/bin/env bash
# ============================================================================
# registry-update.sh - Update ticket registry atomically
# ============================================================================
#
# Purpose:
#   Apply field=value updates to a ticket registry file using atomic
#   write (tmp + mv) to prevent corruption.
#
# Input:
#   Ticket ID + field=value pairs as arguments, e.g.:
#     registry-update.sh BRE-158 current_step=plan
#     registry-update.sh BRE-158 current_step=implement status=active
#
# Output (stdout):
#   Confirmation message listing applied updates
#
# Exit codes:
#   0 = success
#   1 = usage error (missing arguments, invalid field=value format)
#   2 = validation error (invalid field name)
#   3 = file error (registry not found, write failure)
# ============================================================================

set -euo pipefail

# Detect repo root and use local state directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.relay/state/pipeline-registry"

# --- Allowed fields (whitelist to prevent garbage data) ---
ALLOWED_FIELDS="current_step nonce status color_index group_id agent_pane_id orchestrator_pane_id worktree_path last_signal last_signal_at error_count"

# --- Validate arguments ---
if [ $# -lt 2 ]; then
  echo "Usage: registry-update.sh <TICKET_ID> <field=value> [field=value ...]" >&2
  exit 1
fi

TICKET_ID="$1"
shift

REGISTRY_FILE="$REGISTRY_DIR/${TICKET_ID}.json"
TMP_FILE="$REGISTRY_DIR/${TICKET_ID}.json.tmp"

# --- Check file exists ---
if [ ! -f "$REGISTRY_FILE" ]; then
  echo "Error: Registry not found: $REGISTRY_FILE" >&2
  exit 3
fi

# --- Read existing registry ---
REGISTRY=$(jq '.' "$REGISTRY_FILE" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$REGISTRY" ]; then
  echo "Error: Malformed JSON in $REGISTRY_FILE" >&2
  exit 3
fi

# --- Parse and apply updates ---
UPDATES=()
JQ_FILTER="."

for pair in "$@"; do
  # Validate field=value format
  if [[ ! "$pair" =~ ^([a-z_]+)=(.+)$ ]]; then
    echo "Error: Invalid format '$pair'. Expected field=value" >&2
    exit 1
  fi

  FIELD="${BASH_REMATCH[1]}"
  VALUE="${BASH_REMATCH[2]}"

  # Validate field name against whitelist
  FIELD_VALID=false
  for allowed in $ALLOWED_FIELDS; do
    if [ "$FIELD" = "$allowed" ]; then
      FIELD_VALID=true
      break
    fi
  done

  if [ "$FIELD_VALID" = false ]; then
    echo "Error: Invalid field name '$FIELD'. Allowed: $ALLOWED_FIELDS" >&2
    exit 2
  fi

  # Build jq filter chain - handle numeric values
  if [[ "$VALUE" =~ ^[0-9]+$ ]]; then
    JQ_FILTER="$JQ_FILTER | .${FIELD} = ${VALUE}"
  else
    JQ_FILTER="$JQ_FILTER | .${FIELD} = \"${VALUE}\""
  fi

  UPDATES+=("${FIELD}=${VALUE}")
done

# --- Add updated_at timestamp ---
JQ_FILTER="$JQ_FILTER | .updated_at = \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""

# --- Write atomically ---
echo "$REGISTRY" | jq "$JQ_FILTER" > "$TMP_FILE" 2>/dev/null
if [ $? -ne 0 ]; then
  rm -f "$TMP_FILE"
  echo "Error: Failed to apply updates" >&2
  exit 3
fi

# Validate the output is valid JSON before committing
if ! jq '.' "$TMP_FILE" > /dev/null 2>&1; then
  rm -f "$TMP_FILE"
  echo "Error: Generated invalid JSON, aborting" >&2
  exit 3
fi

mv "$TMP_FILE" "$REGISTRY_FILE"

# --- Output confirmation ---
echo "Updated ${TICKET_ID}: ${UPDATES[*]}"
