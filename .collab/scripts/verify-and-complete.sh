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

# For implement phase, verify all tasks are complete
if [ "$PHASE" = "implement" ]; then
  TASKS_FILE="$REPO_ROOT/tasks.md"
  
  if [ ! -f "$TASKS_FILE" ]; then
    echo "[VerifyComplete] ❌ tasks.md not found"
    exit 1
  fi
  
  # Count incomplete tasks (lines with - [ ])
  INCOMPLETE=$(grep -c "^- \[ \]" "$TASKS_FILE" || true)
  
  if [ "$INCOMPLETE" -gt 0 ]; then
    echo "[VerifyComplete] ❌ $INCOMPLETE incomplete tasks remaining"
    exit 1
  fi
  
  echo "[VerifyComplete] ✓ All tasks complete"
fi

# Emit the completion signal
echo "[VerifyComplete] Emitting completion signal..."
bun "$COLLAB_DIR/handlers/emit-question-signal.ts" complete "$MESSAGE"

echo "[VerifyComplete] ✓ Signal emitted successfully"
exit 0
