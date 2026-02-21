#!/usr/bin/env bash
# ============================================================================
# signal-validate.sh - Parse and validate signals from agent pane
# ============================================================================
#
# Purpose:
#   Parse signal strings from agent panes, validate against the ticket registry
#   (nonce match, phase correctness), and output structured JSON.
#
# Input:
#   Signal string from stdin, e.g.:
#     [SIGNAL:BRE-158:abc12] CLARIFY_COMPLETE | All questions answered
#
# Output (stdout):
#   JSON object with parsed + validated signal data
#
# Exit codes:
#   0 = valid signal
#   1 = usage error (no input)
#   2 = validation error (bad format, nonce mismatch, wrong phase)
#   3 = file error (registry not found)
# ============================================================================

set -euo pipefail

# Detect repo root and use local state directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.collab/state/pipeline-registry"
CONFIG_FILE="$REPO_ROOT/.collab/config/pipeline.json"

# --- Phase validation function ---
# Returns valid signal types for a given phase, read from pipeline.json
valid_signals_for_phase() {
  local phase="$1"
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: pipeline.json not found at $CONFIG_FILE" >&2
    exit 2
  fi
  if ! jq '.' "$CONFIG_FILE" > /dev/null 2>&1; then
    echo "Error: pipeline.json is malformed at $CONFIG_FILE" >&2
    exit 2
  fi
  jq -r --arg id "$phase" \
    '.phases[] | select(.id == $id) | .signals | join(" ")' \
    "$CONFIG_FILE" 2>/dev/null || echo ""
}

# --- Read signal from stdin ---
if [ -t 0 ] && [ $# -eq 0 ]; then
  echo '{"valid":false,"error":"No signal provided. Pipe signal string to stdin."}' >&2
  exit 1
fi

if [ $# -gt 0 ]; then
  SIGNAL="$*"
else
  read -r SIGNAL
fi

if [ -z "$SIGNAL" ]; then
  echo '{"valid":false,"error":"Empty signal string"}' >&2
  exit 1
fi

# --- Parse signal format ---
# Expected: [SIGNAL:{TICKET_ID}:{NONCE}] {SIGNAL_TYPE} | {DETAIL}
SIGNAL_REGEX='^\[SIGNAL:([A-Z]+-[0-9]+):([a-f0-9]+)\] ([A-Z_]+) \| (.+)$'

if [[ ! "$SIGNAL" =~ $SIGNAL_REGEX ]]; then
  jq -n --arg signal "$SIGNAL" '{
    valid: false,
    error: "Signal format invalid",
    raw: $signal
  }' >&2
  exit 2
fi

TICKET_ID="${BASH_REMATCH[1]}"
NONCE="${BASH_REMATCH[2]}"
SIGNAL_TYPE="${BASH_REMATCH[3]}"
DETAIL="${BASH_REMATCH[4]}"

# --- Read registry ---
REGISTRY_FILE="$REGISTRY_DIR/${TICKET_ID}.json"

if [ ! -f "$REGISTRY_FILE" ]; then
  jq -n --arg ticket "$TICKET_ID" '{
    valid: false,
    error: "Registry not found for ticket",
    ticket_id: $ticket
  }' >&2
  exit 3
fi

REGISTRY=$(jq '.' "$REGISTRY_FILE" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$REGISTRY" ]; then
  jq -n --arg ticket "$TICKET_ID" '{
    valid: false,
    error: "Registry file is malformed JSON",
    ticket_id: $ticket
  }' >&2
  exit 3
fi

EXPECTED_NONCE=$(echo "$REGISTRY" | jq -r '.nonce')
CURRENT_STEP=$(echo "$REGISTRY" | jq -r '.current_step')

# --- Validate nonce ---
if [ "$NONCE" != "$EXPECTED_NONCE" ]; then
  jq -n \
    --arg ticket "$TICKET_ID" \
    --arg expected "$EXPECTED_NONCE" \
    --arg received "$NONCE" '{
    valid: false,
    error: "Nonce mismatch",
    ticket_id: $ticket,
    expected_nonce: $expected,
    received_nonce: $received
  }' >&2
  exit 2
fi

# --- Validate signal type for current phase ---
ALLOWED=$(valid_signals_for_phase "$CURRENT_STEP")

if [ -z "$ALLOWED" ]; then
  jq -n \
    --arg ticket "$TICKET_ID" \
    --arg step "$CURRENT_STEP" '{
    valid: false,
    error: "Unknown current_step in registry",
    ticket_id: $ticket,
    current_step: $step
  }' >&2
  exit 2
fi

SIGNAL_VALID=false
for valid_type in $ALLOWED; do
  if [ "$SIGNAL_TYPE" = "$valid_type" ]; then
    SIGNAL_VALID=true
    break
  fi
done

if [ "$SIGNAL_VALID" = false ]; then
  jq -n \
    --arg ticket "$TICKET_ID" \
    --arg signal_type "$SIGNAL_TYPE" \
    --arg step "$CURRENT_STEP" \
    --arg allowed "$ALLOWED" '{
    valid: false,
    error: "Signal type not valid for current phase",
    ticket_id: $ticket,
    signal_type: $signal_type,
    current_step: $step,
    allowed_signals: ($allowed | split(" "))
  }' >&2
  exit 2
fi

# --- Output valid result ---
jq -n \
  --arg ticket "$TICKET_ID" \
  --arg signal_type "$SIGNAL_TYPE" \
  --arg detail "$DETAIL" \
  --arg step "$CURRENT_STEP" \
  --arg nonce "$NONCE" '{
  valid: true,
  ticket_id: $ticket,
  signal_type: $signal_type,
  detail: $detail,
  current_step: $step,
  nonce: $nonce
}'
