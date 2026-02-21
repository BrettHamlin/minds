#!/usr/bin/env bash
# ============================================================================
# transition-resolve.sh - Look up the matching transition in pipeline.json
# ============================================================================
#
# Purpose:
#   Given a current phase and incoming signal type, find the matching
#   transition row in pipeline.json and output its target and gate info.
#
#   This is a generic interpreter: changing transitions in pipeline.json
#   requires NO changes to this script.
#
# Usage:
#   transition-resolve.sh <CURRENT_PHASE> <SIGNAL_TYPE>
#
# Output (stdout, JSON):
#   {"to": "tasks", "gate": null}
#   {"to": null, "gate": "plan_review"}
#   {"error": "No transition found for clarify → CLARIFY_COMPLETE"}
#
# Exit codes:
#   0 = match found (check output for gate vs to)
#   1 = usage error
#   2 = no matching transition found
#   3 = file error (pipeline.json missing/malformed)
# ============================================================================

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CONFIG_FILE="$REPO_ROOT/.collab/config/pipeline.json"

# --- Validate arguments ---
if [ $# -lt 2 ]; then
  echo "Usage: transition-resolve.sh <CURRENT_PHASE> <SIGNAL_TYPE>" >&2
  exit 1
fi

CURRENT_PHASE="$1"
SIGNAL_TYPE="$2"

# --- Validate pipeline.json ---
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: pipeline.json not found: $CONFIG_FILE" >&2
  exit 3
fi

if ! jq '.' "$CONFIG_FILE" > /dev/null 2>&1; then
  echo "Error: pipeline.json is malformed" >&2
  exit 3
fi

# --- Look up transition ---
# Priority rules (FR-014):
#   1. Rows with an "if" field are evaluated first, in array order — first match wins
#   2. If no conditional row matches, use the first plain row (no "if" field)
#   3. If no match at all, error

# Get all transitions matching from + signal
MATCHES=$(jq -c \
  --arg from "$CURRENT_PHASE" \
  --arg signal "$SIGNAL_TYPE" \
  '[.transitions[] | select(.from == $from and .signal == $signal)]' \
  "$CONFIG_FILE" 2>/dev/null)

MATCH_COUNT=$(echo "$MATCHES" | jq 'length')

if [ "$MATCH_COUNT" -eq 0 ]; then
  jq -n \
    --arg from "$CURRENT_PHASE" \
    --arg signal "$SIGNAL_TYPE" \
    '{"error": ("No transition found for " + $from + " → " + $signal)}' >&2
  exit 2
fi

# Find first conditional row (has "if" field)
# NOTE: Conditional evaluation requires AI context (gate results, etc.)
# This script returns the conditional row with its "if" value so the
# orchestrator (AI) can evaluate it. If a plain row is desired, use --plain flag.
PLAIN_ONLY=false
if [ "${3:-}" = "--plain" ]; then
  PLAIN_ONLY=true
fi

if [ "$PLAIN_ONLY" = false ]; then
  # Try conditional rows first
  CONDITIONAL=$(echo "$MATCHES" | jq -c 'map(select(.if != null)) | first // empty')
  if [ -n "$CONDITIONAL" ] && [ "$CONDITIONAL" != "null" ]; then
    # Return the conditional match — AI will evaluate the "if" field
    echo "$CONDITIONAL" | jq '{to: (.to // null), gate: (.gate // null), "if": .if, conditional: true}'
    exit 0
  fi
fi

# Fall back to first plain row
PLAIN=$(echo "$MATCHES" | jq -c 'map(select(.if == null)) | first // empty')
if [ -z "$PLAIN" ] || [ "$PLAIN" = "null" ]; then
  # No plain row, but we had conditional rows — return first one anyway
  FIRST=$(echo "$MATCHES" | jq -c 'first')
  echo "$FIRST" | jq '{to: (.to // null), gate: (.gate // null), "if": (.if // null), conditional: (.if != null)}'
  exit 0
fi

echo "$PLAIN" | jq '{to: (.to // null), gate: (.gate // null), "if": null, conditional: false}'
exit 0
