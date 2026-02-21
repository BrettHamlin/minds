#!/usr/bin/env bash
# ============================================================================
# coordination-check.sh - Validate coordination.json files for cycles and refs
# ============================================================================
#
# Purpose:
#   Check all per-ticket coordination.json files for:
#   1. All wait_for.id references exist in the current session ticket list
#   2. No circular dependencies between tickets
#
# Input:
#   Ticket IDs as arguments, e.g.:
#     coordination-check.sh BRE-228 BRE-229 BRE-230
#
# Output (stdout):
#   "Coordination check passed: N tickets, no cycles or unknown references"
#
# Exit codes:
#   0 = valid (no cycles, no unknown references)
#   1 = validation error (cycle or unknown ticket reference)
# ============================================================================

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SPECS_DIR="$REPO_ROOT/specs"

# Nothing to check with fewer than 1 ticket
[ $# -eq 0 ] && exit 0

TICKET_IDS=("$@")

# Create temp directory for state files (bash 3.2 compatible, no assoc arrays)
TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT

VALID_FILE="$TMPDIR_LOCAL/valid.txt"
DEPS_FILE="$TMPDIR_LOCAL/deps.txt"
VISITED_FILE="$TMPDIR_LOCAL/visited.txt"

touch "$DEPS_FILE" "$VISITED_FILE"
printf "%s\n" "${TICKET_IDS[@]}" > "$VALID_FILE"

# ============================================================================
# Phase 1: Parse coordination.json files and build edge list
# Each line in DEPS_FILE: "FROM_TICKET DEP_TICKET"
# ============================================================================

for TICKET_ID in "${TICKET_IDS[@]}"; do
  COORD_FILE="$SPECS_DIR/$TICKET_ID/coordination.json"
  [ -f "$COORD_FILE" ] || continue

  # Validate JSON is parseable
  if ! jq '.' "$COORD_FILE" > /dev/null 2>&1; then
    echo "Error: Malformed coordination.json for ticket '$TICKET_ID'" >&2
    exit 1
  fi

  # Extract dep IDs (normalize object-form wait_for to array)
  DEP_IDS_FILE="$TMPDIR_LOCAL/dep_ids_${TICKET_ID}.txt"
  jq -r '
    if (.wait_for | type) == "object"
    then [.wait_for]
    else .wait_for
    end | .[] | .id
  ' "$COORD_FILE" > "$DEP_IDS_FILE" 2>/dev/null || touch "$DEP_IDS_FILE"

  # Validate each dep ID is in the current session and build edge list
  while IFS= read -r dep_id; do
    [ -z "$dep_id" ] && continue

    if ! grep -qFx "$dep_id" "$VALID_FILE"; then
      echo "Error: Ticket '$TICKET_ID' wait_for references unknown ticket '$dep_id'" >&2
      echo "       Tickets in current session: ${TICKET_IDS[*]}" >&2
      exit 1
    fi

    echo "$TICKET_ID $dep_id" >> "$DEPS_FILE"
  done < "$DEP_IDS_FILE"
done

# ============================================================================
# Phase 2: Cycle detection via DFS
# Uses colon-separated path string passed through function arguments.
# Bash 3.2 compatible (no associative arrays).
# ============================================================================

# dfs_check NODE PATH_STRING
# PATH_STRING: colon-separated e.g. "BRE-228:BRE-229"
dfs_check() {
  local node="$1"
  local path="$2"

  # Skip if fully explored
  if grep -qFx "$node" "$VISITED_FILE" 2>/dev/null; then
    return 0
  fi

  # Get direct dependencies of this node
  local deps
  deps=$(awk -v n="$node" '$1 == n { print $2 }' "$DEPS_FILE" 2>/dev/null || true)

  for dep in $deps; do
    # Check if dep appears in current path (cycle detection)
    case ":${path}:" in
      *":${dep}:"*)
        # Format cycle for display
        local display
        display=$(echo "$path" | tr ':' ' ' | sed 's/  */ → /g')
        echo "Error: Circular dependency: ${display} → ${dep}" >&2
        exit 1
        ;;
    esac

    # Recurse
    dfs_check "$dep" "${path}:${dep}"
  done

  # Mark as fully explored
  echo "$node" >> "$VISITED_FILE"
}

for TICKET_ID in "${TICKET_IDS[@]}"; do
  if ! grep -qFx "$TICKET_ID" "$VISITED_FILE" 2>/dev/null; then
    dfs_check "$TICKET_ID" "$TICKET_ID"
  fi
done

echo "Coordination check passed: ${#TICKET_IDS[@]} tickets, no cycles or unknown references"
