#!/usr/bin/env bash
# ============================================================================
# phase-advance.sh - Determine next phase after current phase completes
# ============================================================================
#
# Purpose:
#   Map current pipeline phase to the next phase in the defined progression.
#   Pure function: no side effects, no file I/O.
#
# Input:
#   Current phase name as first argument, e.g.:
#     phase-advance.sh clarify
#
# Output (stdout):
#   Next phase name, or "done" if pipeline is complete
#
# Phase progression:
#   clarify -> plan -> tasks -> analyze -> implement -> blindqa -> done
#
# Exit codes:
#   0 = success
#   1 = usage error (missing argument)
#   2 = validation error (invalid phase name)
# ============================================================================

set -euo pipefail

# --- Validate arguments ---
if [ $# -lt 1 ]; then
  echo "Usage: phase-advance.sh <current_phase>" >&2
  echo "" >&2
  echo "Valid phases: clarify, plan, tasks, analyze, implement, blindqa" >&2
  exit 1
fi

CURRENT_PHASE="$1"

# --- Phase progression map ---
case "$CURRENT_PHASE" in
  clarify)    echo "plan" ;;
  plan)       echo "tasks" ;;
  tasks)      echo "analyze" ;;
  analyze)    echo "implement" ;;
  implement)  echo "blindqa" ;;
  blindqa)    echo "done" ;;
  done)       echo "done" ;;
  *)
    echo "Error: Invalid phase '$CURRENT_PHASE'" >&2
    echo "Valid phases: clarify, plan, tasks, analyze, implement, blindqa, done" >&2
    exit 2
    ;;
esac
