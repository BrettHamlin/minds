#!/usr/bin/env bash
# ============================================================================
# group-manage.sh - Manage coordination groups
# ============================================================================
#
# Purpose:
#   Create and manage coordination groups that link multiple tickets together
#   for synchronized pipeline operations (e.g., deploy gates).
#
# Subcommands:
#   create {ticket_ids...}  - Create group from ticket IDs
#   add {group_id} {ticket_id} - Add ticket to existing group
#   query {ticket_id}       - Get group info for a ticket
#   list {group_id}         - List tickets in a group
#
# Input examples:
#   group-manage.sh create BRE-92 BRE-180
#   group-manage.sh add abc123 BRE-200
#   group-manage.sh query BRE-92
#   group-manage.sh list abc123
#
# Output:
#   JSON for query/list/create operations, confirmation for mutations
#
# Exit codes:
#   0 = success
#   1 = usage error (invalid subcommand, missing args)
#   2 = validation error (ticket not found in registry)
#   3 = file error (group file corruption, write failure)
# ============================================================================

set -euo pipefail

REGISTRY_DIR="$HOME/.claude/MEMORY/STATE/pipeline-registry"
GROUPS_DIR="$HOME/.claude/MEMORY/STATE/pipeline-groups"

mkdir -p "$REGISTRY_DIR" "$GROUPS_DIR"

# --- Usage ---
usage() {
  echo "Usage: group-manage.sh <subcommand> [args...]" >&2
  echo "" >&2
  echo "Subcommands:" >&2
  echo "  create <ticket_id> [ticket_id ...]  Create coordination group" >&2
  echo "  add <group_id> <ticket_id>          Add ticket to group" >&2
  echo "  query <ticket_id>                   Get group for ticket" >&2
  echo "  list <group_id>                     List tickets in group" >&2
  exit 1
}

# --- Validate ticket exists in registry ---
validate_ticket() {
  local ticket="$1"
  if [ ! -f "$REGISTRY_DIR/${ticket}.json" ]; then
    echo "Error: No registry for ticket $ticket" >&2
    exit 2
  fi
}

# --- Generate group ID from sorted ticket IDs ---
generate_group_id() {
  local sorted
  sorted=$(printf '%s\n' "$@" | sort | tr '\n' ':')
  echo -n "$sorted" | shasum -a 256 | cut -c1-12
}

# --- Subcommand: create ---
cmd_create() {
  if [ $# -lt 2 ]; then
    echo "Error: create requires at least 2 ticket IDs" >&2
    exit 1
  fi

  # Validate all tickets exist
  for ticket in "$@"; do
    validate_ticket "$ticket"
  done

  # Generate deterministic group ID
  GROUP_ID=$(generate_group_id "$@")
  GROUP_FILE="$GROUPS_DIR/${GROUP_ID}.json"
  TMP_FILE="$GROUPS_DIR/${GROUP_ID}.json.tmp"

  # Build ticket array for jq
  TICKET_ARRAY=$(printf '%s\n' "$@" | jq -R . | jq -s .)

  # Create group file atomically
  jq -n \
    --arg group_id "$GROUP_ID" \
    --argjson tickets "$TICKET_ARRAY" \
    --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
    group_id: $group_id,
    tickets: $tickets,
    created_at: $created_at,
    updated_at: $created_at
  }' > "$TMP_FILE"

  mv "$TMP_FILE" "$GROUP_FILE"

  # Update each ticket registry with group_id
  for ticket in "$@"; do
    TICKET_FILE="$REGISTRY_DIR/${ticket}.json"
    TICKET_TMP="$REGISTRY_DIR/${ticket}.json.tmp"
    jq --arg gid "$GROUP_ID" '.group_id = $gid' "$TICKET_FILE" > "$TICKET_TMP"
    mv "$TICKET_TMP" "$TICKET_FILE"
  done

  # Output result
  jq '.' "$GROUP_FILE"
}

# --- Subcommand: add ---
cmd_add() {
  if [ $# -ne 2 ]; then
    echo "Error: add requires <group_id> <ticket_id>" >&2
    exit 1
  fi

  local GROUP_ID="$1"
  local TICKET_ID="$2"
  local GROUP_FILE="$GROUPS_DIR/${GROUP_ID}.json"
  local TMP_FILE="$GROUPS_DIR/${GROUP_ID}.json.tmp"

  # Validate group exists
  if [ ! -f "$GROUP_FILE" ]; then
    echo "Error: Group not found: $GROUP_ID" >&2
    exit 3
  fi

  # Validate ticket exists
  validate_ticket "$TICKET_ID"

  # Check ticket isn't already in group
  if jq -e --arg t "$TICKET_ID" '.tickets | index($t)' "$GROUP_FILE" > /dev/null 2>&1; then
    echo "Warning: Ticket $TICKET_ID already in group $GROUP_ID" >&2
    jq '.' "$GROUP_FILE"
    return 0
  fi

  # Add ticket to group atomically
  jq --arg t "$TICKET_ID" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
    .tickets += [$t] | .updated_at = $now
  ' "$GROUP_FILE" > "$TMP_FILE"

  mv "$TMP_FILE" "$GROUP_FILE"

  # Update ticket registry with group_id
  TICKET_FILE="$REGISTRY_DIR/${TICKET_ID}.json"
  TICKET_TMP="$REGISTRY_DIR/${TICKET_ID}.json.tmp"
  jq --arg gid "$GROUP_ID" '.group_id = $gid' "$TICKET_FILE" > "$TICKET_TMP"
  mv "$TICKET_TMP" "$TICKET_FILE"

  echo "Added $TICKET_ID to group $GROUP_ID"
}

# --- Subcommand: query ---
cmd_query() {
  if [ $# -ne 1 ]; then
    echo "Error: query requires <ticket_id>" >&2
    exit 1
  fi

  local TICKET_ID="$1"
  validate_ticket "$TICKET_ID"

  # Read group_id from ticket registry
  local GROUP_ID
  GROUP_ID=$(jq -r '.group_id // empty' "$REGISTRY_DIR/${TICKET_ID}.json")

  if [ -z "$GROUP_ID" ]; then
    jq -n --arg ticket "$TICKET_ID" '{
      ticket_id: $ticket,
      group_id: null,
      message: "Ticket is not in any group"
    }'
    return 0
  fi

  local GROUP_FILE="$GROUPS_DIR/${GROUP_ID}.json"
  if [ ! -f "$GROUP_FILE" ]; then
    echo "Error: Group file missing for group_id $GROUP_ID" >&2
    exit 3
  fi

  # Return group data with queried ticket highlighted
  jq --arg ticket "$TICKET_ID" '. + {queried_ticket: $ticket}' "$GROUP_FILE"
}

# --- Subcommand: list ---
cmd_list() {
  if [ $# -ne 1 ]; then
    echo "Error: list requires <group_id>" >&2
    exit 1
  fi

  local GROUP_ID="$1"
  local GROUP_FILE="$GROUPS_DIR/${GROUP_ID}.json"

  if [ ! -f "$GROUP_FILE" ]; then
    echo "Error: Group not found: $GROUP_ID" >&2
    exit 3
  fi

  # Enrich with current status from each ticket registry
  local ENRICHED="[]"
  for ticket in $(jq -r '.tickets[]' "$GROUP_FILE"); do
    local REG_FILE="$REGISTRY_DIR/${ticket}.json"
    if [ -f "$REG_FILE" ]; then
      local ENTRY
      ENTRY=$(jq --arg t "$ticket" '{
        ticket_id: $t,
        current_step: .current_step,
        status: (.status // "running"),
        last_signal: (.last_signal // null)
      }' "$REG_FILE")
      ENRICHED=$(echo "$ENRICHED" | jq --argjson e "$ENTRY" '. + [$e]')
    else
      ENRICHED=$(echo "$ENRICHED" | jq --arg t "$ticket" '. + [{ticket_id: $t, current_step: "unknown", status: "missing_registry"}]')
    fi
  done

  jq -n --arg gid "$GROUP_ID" --argjson tickets "$ENRICHED" '{
    group_id: $gid,
    tickets: $tickets,
    count: ($tickets | length)
  }'
}

# --- Main dispatch ---
if [ $# -lt 1 ]; then
  usage
fi

SUBCOMMAND="$1"
shift

case "$SUBCOMMAND" in
  create) cmd_create "$@" ;;
  add)    cmd_add "$@" ;;
  query)  cmd_query "$@" ;;
  list)   cmd_list "$@" ;;
  *)
    echo "Error: Unknown subcommand '$SUBCOMMAND'" >&2
    usage
    ;;
esac
