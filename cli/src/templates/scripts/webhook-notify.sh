#!/usr/bin/env bash
# ============================================================================
# webhook-notify.sh - Send phase change notifications to OpenClaw webhook
# ============================================================================
#
# Called from the orchestrator after phase changes.
# Sends a POST to OpenClaw /hooks/collab which forwards to Discord.
#
# Usage:
#   webhook-notify.sh <ticket_id> <from_phase> <to_phase> <status>
#
# Example:
#   webhook-notify.sh BRE-202 clarify plan running
# ============================================================================

set -euo pipefail

# Configuration
HOOKS_TOKEN="63010287709179dece1406557973ad6415e7e548420069b43821c54b49598170"
HOOKS_URL="http://127.0.0.1:18789/hooks/collab"

# Validate arguments
if [ $# -lt 4 ]; then
  echo "Usage: webhook-notify.sh <ticket> <from> <to> <status>" >&2
  exit 1
fi

TICKET="$1"
FROM="$2"
TO="$3"
STATUS="$4"

# Send to OpenClaw webhook
curl -s -X POST "$HOOKS_URL" \
  -H "Authorization: Bearer $HOOKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ticket\":\"$TICKET\",\"from\":\"$FROM\",\"to\":\"$TO\",\"status\":\"$STATUS\"}"

echo "Webhook sent for $TICKET: $FROM → $TO ($STATUS)"
