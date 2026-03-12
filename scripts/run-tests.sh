#!/usr/bin/env bash
# run-tests.sh — Run bun tests in a separate tmux window to avoid Claude Code crashes.
#
# Bun's test runner crashes on exit with certain multi-file combinations (bun bug).
# This script works around it by running tests in an isolated tmux window, parsing
# the pass/fail counts from output, and using those as the source of truth.
#
# Usage:
#   scripts/run-tests.sh [bun test args...]
#
# Examples:
#   scripts/run-tests.sh minds/lib/          # test a directory
#   scripts/run-tests.sh minds/lib/contracts.test.ts  # test a single file
#   scripts/run-tests.sh minds/              # full suite
#   scripts/run-tests.sh                     # full suite (no args = minds/)
#
# Output is written to /tmp/gravitas-test-result.txt

set -euo pipefail

RESULT_FILE="/tmp/gravitas-test-result.txt"
RUNNER="/tmp/gravitas-test-runner.sh"
WINDOW_NAME="bun-test-$$"
WORK_DIR="$PWD"

# Default to minds/ if no args
ARGS="${*:-minds/}"

# Clean previous results
rm -f "$RESULT_FILE"

# Write a runner script (avoids tmux quoting issues)
# Note: bun test may crash on exit with multi-file runs (bun bug), so we
# don't rely on the exit code echo — pass/fail counts from output are the
# source of truth.
cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
cd "$WORK_DIR"
bun test $ARGS > "$RESULT_FILE" 2>&1 || true
echo "GRAVITAS_EXIT:\$?" >> "$RESULT_FILE" 2>/dev/null || true
EOF
chmod +x "$RUNNER"

# Run in a new tmux window that auto-closes on completion
tmux new-window -n "$WINDOW_NAME" "$RUNNER"

# Poll for completion (window disappears when done)
echo "Running: bun test $ARGS"
echo "Waiting for results..."
while tmux list-windows -F '#{window_name}' 2>/dev/null | grep -q "^${WINDOW_NAME}$"; do
  sleep 2
done

# Display results
if [ ! -f "$RESULT_FILE" ]; then
  echo "ERROR: No result file found. Tests may have crashed."
  exit 1
fi

# Extract summary from bun's output format: " N pass" and " N fail"
PASS_COUNT=$(grep -c "(pass)" "$RESULT_FILE" 2>/dev/null || true)
PASS_COUNT="${PASS_COUNT:-0}"
FAIL_COUNT=$(grep -c "(fail)" "$RESULT_FILE" 2>/dev/null || true)
FAIL_COUNT="${FAIL_COUNT:-0}"

# Try to get bun's summary line (e.g., "Ran 85 tests across 5 files.")
SUMMARY=$(grep "^Ran " "$RESULT_FILE" 2>/dev/null | tail -1 || true)

echo ""
echo "════════════════════════════════════════"
echo "  PASS: $PASS_COUNT"
echo "  FAIL: $FAIL_COUNT"
if [ -n "$SUMMARY" ]; then
  echo "  $SUMMARY"
fi
echo "════════════════════════════════════════"

# Show failures if any
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  echo "FAILURES:"
  grep "(fail)" "$RESULT_FILE"
fi

echo ""
echo "Full output: $RESULT_FILE"

# Clean up runner
rm -f "$RUNNER"

# Exit based on fail count (bun's exit code is unreliable due to crash-on-exit bug)
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
else
  exit 0
fi
