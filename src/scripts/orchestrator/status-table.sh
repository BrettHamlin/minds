#!/usr/bin/env bash
# ============================================================================
# status-table.sh - Render status table from all registries
# ============================================================================
#
# Purpose:
#   Scan all ticket registry files and render a formatted ASCII table showing
#   the current state of all pipeline tickets.
#
# Input:
#   None (reads all files in pipeline-registry directory)
#
# Output (stdout):
#   ASCII table with columns: Ticket, Phase, Status, Gate, Detail
#
# Exit codes:
#   0 = success (even if no registries found - renders empty table)
# ============================================================================

set -euo pipefail

# Detect repo root and use local state directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY_DIR="$REPO_ROOT/.collab/state/pipeline-registry"
GROUPS_DIR="$REPO_ROOT/.collab/state/pipeline-groups"

mkdir -p "$REGISTRY_DIR" "$GROUPS_DIR"

# --- Column widths ---
COL_TICKET=13
COL_PHASE=10
COL_STATUS=14
COL_GATE=17
COL_DETAIL=30

# --- Formatting helpers ---
pad() {
  local str="$1"
  local width="$2"
  printf "%-${width}s" "$str"
}

hr_top() {
  printf "%s" "+"
  printf '%0.s-' $(seq 1 $((COL_TICKET + 2))); printf "%s" "+"
  printf '%0.s-' $(seq 1 $((COL_PHASE + 2))); printf "%s" "+"
  printf '%0.s-' $(seq 1 $((COL_STATUS + 2))); printf "%s" "+"
  printf '%0.s-' $(seq 1 $((COL_GATE + 2))); printf "%s" "+"
  printf '%0.s-' $(seq 1 $((COL_DETAIL + 2))); printf "%s" "+"
  echo
}

hr_mid() {
  printf "%s" "|"
  printf '%0.s-' $(seq 1 $((COL_TICKET + 2))); printf "%s" "|"
  printf '%0.s-' $(seq 1 $((COL_PHASE + 2))); printf "%s" "|"
  printf '%0.s-' $(seq 1 $((COL_STATUS + 2))); printf "%s" "|"
  printf '%0.s-' $(seq 1 $((COL_GATE + 2))); printf "%s" "|"
  printf '%0.s-' $(seq 1 $((COL_DETAIL + 2))); printf "%s" "|"
  echo
}

row() {
  local ticket="$1" phase="$2" status="$3" gate="$4" detail="$5"
  printf "| %s | %s | %s | %s | %s |\n" \
    "$(pad "$ticket" $COL_TICKET)" \
    "$(pad "$phase" $COL_PHASE)" \
    "$(pad "$status" $COL_STATUS)" \
    "$(pad "$gate" $COL_GATE)" \
    "$(pad "$detail" $COL_DETAIL)"
}

# --- Determine status from registry data ---
derive_status() {
  local reg="$1"
  local last_signal
  last_signal=$(echo "$reg" | jq -r '.last_signal // empty')
  local status
  status=$(echo "$reg" | jq -r '.status // empty')

  if [ -n "$status" ]; then
    echo "$status"
  elif [ -z "$last_signal" ]; then
    echo "running"
  elif [[ "$last_signal" == *_COMPLETE ]]; then
    echo "completed"
  elif [[ "$last_signal" == *_ERROR ]]; then
    echo "error"
  elif [[ "$last_signal" == *_FAILED ]]; then
    echo "failed"
  elif [[ "$last_signal" == *_WAITING ]]; then
    echo "waiting"
  elif [[ "$last_signal" == *_QUESTION ]]; then
    echo "needs_input"
  else
    echo "running"
  fi
}

# --- Determine gate status ---
derive_gate() {
  local reg="$1"
  local group_id
  group_id=$(echo "$reg" | jq -r '.group_id // empty')

  if [ -z "$group_id" ]; then
    echo "--"
    return
  fi

  local group_file="$GROUPS_DIR/${group_id}.json"
  if [ ! -f "$group_file" ]; then
    echo "group:missing"
    return
  fi

  # Check if all tickets in group are at implement or beyond
  local all_ready=true
  for ticket in $(jq -r '.tickets[]' "$group_file"); do
    local reg_file="$REGISTRY_DIR/${ticket}.json"
    if [ -f "$reg_file" ]; then
      local step
      step=$(jq -r '.current_step' "$reg_file")
      case "$step" in
        implement|blindqa|done) ;; # past the gate
        *) all_ready=false ;;
      esac
    else
      all_ready=false
    fi
  done

  if [ "$all_ready" = true ]; then
    echo "group:ready"
  else
    echo "group:waiting"
  fi
}

# --- Derive detail string ---
derive_detail() {
  local reg="$1"
  local reg_status
  reg_status=$(echo "$reg" | jq -r '.status // empty')
  local last_signal
  last_signal=$(echo "$reg" | jq -r '.last_signal // empty')
  local last_signal_at
  last_signal_at=$(echo "$reg" | jq -r '.last_signal_at // empty')
  local step
  step=$(echo "$reg" | jq -r '.current_step')

  # Held agents show their wait target
  if [ "$reg_status" = "held" ]; then
    local waiting_for
    waiting_for=$(echo "$reg" | jq -r '.waiting_for // "unknown"')
    echo "held | waiting for ${waiting_for}"
    return
  fi

  if [ -n "$last_signal" ] && [ -n "$last_signal_at" ]; then
    # Truncate to fit column
    local detail="${last_signal} @ ${last_signal_at}"
    echo "${detail:0:$COL_DETAIL}"
  else
    echo "Working on ${step} phase"
  fi
}

# --- Collect registry files ---
REGISTRIES=()
for f in "$REGISTRY_DIR"/*.json; do
  [ -f "$f" ] && REGISTRIES+=("$f")
done

# --- Render table ---
hr_top
row "Ticket" "Phase" "Status" "Gate" "Detail"
hr_mid

if [ ${#REGISTRIES[@]} -eq 0 ]; then
  row "(none)" "--" "--" "--" "No active tickets"
else
  for reg_file in "${REGISTRIES[@]}"; do
    REG=$(jq '.' "$reg_file" 2>/dev/null || echo '{}')

    TICKET=$(echo "$REG" | jq -r '.ticket_id // "unknown"')
    PHASE=$(echo "$REG" | jq -r '.current_step // "unknown"')
    STATUS=$(derive_status "$REG")
    GATE=$(derive_gate "$REG")
    DETAIL=$(derive_detail "$REG")

    row "$TICKET" "$PHASE" "$STATUS" "$GATE" "$DETAIL"
  done
fi

hr_top
