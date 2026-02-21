#!/usr/bin/env bash
# ============================================================================
# phase-advance.sh - Determine next phase after current phase completes
# ============================================================================
#
# Purpose:
#   Read the phase sequence from pipeline.json and return the next phase name.
#   Pure function: reads config, no side effects.
#
# Input:
#   Current phase name as first argument, e.g.:
#     phase-advance.sh clarify
#
# Output (stdout):
#   Next phase name, or "done" if pipeline is complete
#
# Phase progression:
#   Defined by .collab/config/pipeline.json — no hardcoded sequence.
#
# Exit codes:
#   0 = success
#   1 = usage error (missing argument)
#   2 = validation error (invalid phase name, missing or malformed pipeline.json)
# ============================================================================

set -euo pipefail

# --- Validate arguments ---
if [ $# -lt 1 ]; then
  echo "Usage: phase-advance.sh <current_phase>" >&2
  exit 1
fi

CURRENT_PHASE="$1"

# --- Locate pipeline.json ---
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CONFIG_FILE="$REPO_ROOT/.collab/config/pipeline.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: pipeline.json not found at $CONFIG_FILE" >&2
  exit 3
fi

PIPELINE=$(jq '.' "$CONFIG_FILE" 2>/dev/null) || {
  echo "Error: pipeline.json is malformed at $CONFIG_FILE" >&2
  exit 3
}

# --- Sentinel: done is always done ---
if [ "$CURRENT_PHASE" = "done" ]; then
  echo "done"
  exit 0
fi

# --- Find current phase index ---
PHASE_INDEX=$(echo "$PIPELINE" | jq -r --arg id "$CURRENT_PHASE" \
  '.phases | to_entries[] | select(.value.id == $id) | .key')

if [ -z "$PHASE_INDEX" ]; then
  echo "Error: Invalid phase '$CURRENT_PHASE'" >&2
  echo "Valid phases: $(echo "$PIPELINE" | jq -r '[.phases[].id] | join(", ")')" >&2
  exit 2
fi

# --- Compute next phase ---
PHASE_COUNT=$(echo "$PIPELINE" | jq '.phases | length')
NEXT_INDEX=$((PHASE_INDEX + 1))

if [ "$NEXT_INDEX" -ge "$PHASE_COUNT" ]; then
  echo "done"
else
  echo "$PIPELINE" | jq -r ".phases[$NEXT_INDEX].id"
fi
