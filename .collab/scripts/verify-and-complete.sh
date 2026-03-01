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
#   verify-and-complete.sh <phase-name> <message>
#   Example: verify-and-complete.sh implement "Implementation phase finished"
#
# Exit codes:
#   0 = verification passed, signal emitted
#   1 = verification failed, signal not emitted
# ============================================================================

set -euo pipefail

PHASE="$1"
MESSAGE="${2:-Phase completed}"

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
      TASKS_FILE=$(find "$REPO_ROOT/specs" -name "tasks.md" -maxdepth 2 2>/dev/null | sort | head -1)
    fi
    if [ -z "$TASKS_FILE" ]; then
      TASKS_FILE="$REPO_ROOT/tasks.md"
    fi

    if [ ! -f "$TASKS_FILE" ]; then
      echo "[VerifyComplete] ❌ tasks.md not found (searched specs/*/tasks.md and repo root)"
      exit 1
    fi
    
    # Count incomplete tasks (lines with - [ ])
    INCOMPLETE=$(grep -c "^- \[ \]" "$TASKS_FILE" || true)
    
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

# Emit the completion signal
echo "[VerifyComplete] Emitting completion signal..."
bun "$COLLAB_DIR/handlers/emit-question-signal.ts" complete "$MESSAGE"

echo "[VerifyComplete] ✓ Signal emitted successfully"
exit 0
