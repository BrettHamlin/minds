#!/usr/bin/env bash
# ============================================================================
# registry-read.sh - Read ticket registry file
# ============================================================================
#
# Purpose:
#   Read and output the JSON registry for a given ticket ID.
#
# Input:
#   Ticket ID as first argument, e.g.:
#     registry-read.sh BRE-158
#
# Output (stdout):
#   JSON contents of the registry file
#
# Exit codes:
#   0 = success
#   1 = usage error (missing argument)
#   3 = file error (not found, malformed JSON)
# ============================================================================

set -euo pipefail

# Detect repo root and use local state directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.relay/state/pipeline-registry"

# --- Validate arguments ---
if [ $# -lt 1 ]; then
  echo "Usage: registry-read.sh <TICKET_ID>" >&2
  exit 1
fi

TICKET_ID="$1"
REGISTRY_FILE="$REGISTRY_DIR/${TICKET_ID}.json"

# --- Check file exists ---
if [ ! -f "$REGISTRY_FILE" ]; then
  echo "Error: Registry not found: $REGISTRY_FILE" >&2
  exit 3
fi

# --- Validate and output JSON ---
if ! jq '.' "$REGISTRY_FILE" 2>/dev/null; then
  echo "Error: Malformed JSON in $REGISTRY_FILE" >&2
  exit 3
fi
