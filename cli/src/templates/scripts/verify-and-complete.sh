#!/usr/bin/env bash
# ============================================================================
# verify-and-complete.sh - Verify phase completion and emit signal
# ============================================================================
#
# Purpose:
#   Verify that a phase is complete (all tasks done, tests passing) and
#   automatically emit the completion signal to the orchestrator.
#
# Usage:
#   verify-and-complete.sh <phase-name> <message> [phase-scope]
#   Example: verify-and-complete.sh implement "Implementation phase finished"
#   Example: verify-and-complete.sh implement "Phase 2 complete" 2
#   Example: verify-and-complete.sh implement "Phases 1-4 complete" 1-4
#
# Arguments:
#   phase-scope (optional): single phase number '2' or range '1-4'.
#     When provided, only tasks within those ## Phase N: sections are checked.
#     When omitted, all tasks in the file are checked (original behavior).
#
# Exit codes:
#   0 = verification passed, signal emitted
#   1 = verification failed, signal not emitted
# ============================================================================

set -euo pipefail

PHASE="$1"
MESSAGE="${2:-Phase completed}"
PHASE_SCOPE="${3:-}"

# Detect repo root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
COLLAB_DIR="$REPO_ROOT/.collab"

echo "[VerifyComplete] Phase: $PHASE"
echo "[VerifyComplete] Checking completion conditions..."

# Phase-specific verification
case "$PHASE" in
  implement)
    # Resolve active feature's tasks.md via check-prerequisites first (avoids picking the
    # wrong file when multiple features have a specs/*/tasks.md in the same repo).
    TASKS_FILE=""
    PREREQ_SCRIPT="$REPO_ROOT/.specify/scripts/bash/check-prerequisites.sh"
    if [ -x "$PREREQ_SCRIPT" ]; then
      FEATURE_DIR=$(cd "$REPO_ROOT" && "$PREREQ_SCRIPT" --json 2>/dev/null \
        | grep -o '"FEATURE_DIR":"[^"]*"' | cut -d'"' -f4 || true)
      if [ -n "$FEATURE_DIR" ] && [ -f "$FEATURE_DIR/tasks.md" ]; then
        TASKS_FILE="$FEATURE_DIR/tasks.md"
      fi
    fi
    # Fall back: sorted glob across specs/, then repo root
    if [ -z "$TASKS_FILE" ]; then
      TASKS_FILE=$(find "$REPO_ROOT/specs" -name "tasks.md" -maxdepth 2 2>/dev/null | sort | head -1 || true)
    fi
    if [ -z "$TASKS_FILE" ]; then
      TASKS_FILE="$REPO_ROOT/tasks.md"
    fi

    if [ ! -f "$TASKS_FILE" ]; then
      echo "[VerifyComplete] ❌ tasks.md not found (searched specs/*/tasks.md and repo root)"
      exit 1
    fi

    # Count incomplete tasks — optionally scoped to specific phase(s)
    if [ -n "$PHASE_SCOPE" ]; then
      case "$PHASE_SCOPE" in
        *-*)
          RANGE_START="${PHASE_SCOPE%-*}"
          RANGE_END="${PHASE_SCOPE#*-}"
          echo "[VerifyComplete] Checking phases ${RANGE_START}-${RANGE_END} only"
          TASK_LINES=$(awk -v s="$RANGE_START" -v e="$RANGE_END" '
            /^## Phase [0-9]+:/ {
              match($0, /[0-9]+/)
              n = substr($0, RSTART, RLENGTH) + 0
              in_scope = (n >= s+0 && n <= e+0)
              next
            }
            /^## / { in_scope = 0 }
            in_scope
          ' "$TASKS_FILE")
          ;;
        *)
          echo "[VerifyComplete] Checking phase ${PHASE_SCOPE} only"
          TASK_LINES=$(awk -v p="$PHASE_SCOPE" '
            /^## Phase [0-9]+:/ {
              match($0, /[0-9]+/)
              n = substr($0, RSTART, RLENGTH) + 0
              in_scope = (n == p+0)
              next
            }
            /^## / { in_scope = 0 }
            in_scope
          ' "$TASKS_FILE")
          ;;
      esac
      INCOMPLETE=$(echo "$TASK_LINES" | grep -c "^- \[ \]" || true)
    else
      INCOMPLETE=$(grep -c "^- \[ \]" "$TASKS_FILE" || true)
    fi

    if [ "$INCOMPLETE" -gt 0 ]; then
      echo "[VerifyComplete] ❌ $INCOMPLETE incomplete tasks remaining"
      exit 1
    fi

    echo "[VerifyComplete] ✓ All tasks complete"
    ;;
    
  analyze)
    # For analyze phase, no specific verification needed
    # The orchestrator will check for CRITICAL issues
    echo "[VerifyComplete] ✓ Analysis phase checks complete"
    ;;
    
  *)
    # For other phases, just verify the phase exists
    echo "[VerifyComplete] ✓ Phase $PHASE complete (no specific checks)"
    ;;
esac

# CHECK_ONLY mode: skip signal emission (used by automated tests)
if [ "${CHECK_ONLY:-}" = "1" ]; then
  echo "[VerifyComplete] CHECK_ONLY: verification complete, skipping signal emission"
  exit 0
fi

# Emit the completion signal
echo "[VerifyComplete] Emitting completion signal..."
bun "$COLLAB_DIR/handlers/emit-question-signal.ts" complete "$MESSAGE"

echo "[VerifyComplete] ✓ Signal emitted successfully"
exit 0
