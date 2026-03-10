#!/bin/bash
# Watch the dashboard worktree for a drone commit, then inject a contract violation
# Usage: ./inject-violation.sh

WORKTREE="/Users/atlas/Code/projects/gravitas-BRE-482-dashboard-supervisor"

echo "Waiting for dashboard worktree to exist..."
while [ ! -d "$WORKTREE" ]; do
  sleep 2
done
echo "Worktree found: $WORKTREE"

echo "Waiting for drone commit in worktree..."
LAST_COMMIT=""
while true; do
  if [ ! -d "$WORKTREE/.git" ] && [ ! -f "$WORKTREE/.git" ]; then
    sleep 2
    continue
  fi

  CURRENT_COMMIT=$(cd "$WORKTREE" && git log --oneline -1 2>/dev/null | awk '{print $1}')

  # Check if a new commit appeared (drone committed)
  if [ -n "$CURRENT_COMMIT" ] && [ "$CURRENT_COMMIT" != "$LAST_COMMIT" ] && [ -n "$LAST_COMMIT" ]; then
    # Verify it's a drone commit (not the initial)
    COMMIT_MSG=$(cd "$WORKTREE" && git log --oneline -1 2>/dev/null)
    if echo "$COMMIT_MSG" | grep -qi "dashboard\|feat\|add\|implement\|sse\|endpoint\|event"; then
      echo "Drone commit detected: $COMMIT_MSG"
      echo "Injecting contract violation..."

      cd "$WORKTREE"

      # Find route-handler.ts in either .minds/ or minds/
      FILE=""
      if [ -f ".minds/dashboard/route-handler.ts" ]; then
        FILE=".minds/dashboard/route-handler.ts"
      elif [ -f "minds/dashboard/route-handler.ts" ]; then
        FILE="minds/dashboard/route-handler.ts"
      fi

      if [ -n "$FILE" ]; then
        echo "Found route-handler at: $FILE"

        # Check if the file imports serializeEventForSSE
        if grep -q "import.*serializeEventForSSE" "$FILE"; then
          echo "Found serializeEventForSSE import — replacing with local implementation..."

          # Replace the import with a local reimplementation
          sed -i '' 's|import { serializeEventForSSE } from "@minds/transport/minds-events.js";|import type { MindsBusMessage } from "@minds/transport/minds-events.js";\
\
/** Local SSE serializer */\
export function serializeEventForSSE(event: MindsBusMessage): string {\
  const data = {\
    type: event.type,\
    timestamp: new Date().toISOString(),\
    mindName: (event.payload as Record<string, unknown>)?.mindName ?? "unknown",\
    waveId: (event.payload as Record<string, unknown>)?.waveId ?? null,\
    payload: event.payload,\
  };\
  return `event: ${event.type}\\ndata: ${JSON.stringify(data)}\\n\\n`;\
}|' "$FILE"

          # Also try alternate import patterns the drone might use
          sed -i '' 's|import { serializeEventForSSE } from "../../transport/minds-events.js";|import type { MindsBusMessage } from "../../transport/minds-events.js";\
\
/** Local SSE serializer */\
export function serializeEventForSSE(event: MindsBusMessage): string {\
  const data = {\
    type: event.type,\
    timestamp: new Date().toISOString(),\
    mindName: (event.payload as Record<string, unknown>)?.mindName ?? "unknown",\
    waveId: (event.payload as Record<string, unknown>)?.waveId ?? null,\
    payload: event.payload,\
  };\
  return `event: ${event.type}\\ndata: ${JSON.stringify(data)}\\n\\n`;\
}|' "$FILE"

          sed -i '' 's|import { serializeEventForSSE } from "../transport/minds-events.js";|import type { MindsBusMessage } from "../transport/minds-events.js";\
\
/** Local SSE serializer */\
export function serializeEventForSSE(event: MindsBusMessage): string {\
  const data = {\
    type: event.type,\
    timestamp: new Date().toISOString(),\
    mindName: (event.payload as Record<string, unknown>)?.mindName ?? "unknown",\
    waveId: (event.payload as Record<string, unknown>)?.waveId ?? null,\
    payload: event.payload,\
  };\
  return `event: ${event.type}\\ndata: ${JSON.stringify(data)}\\n\\n`;\
}|' "$FILE"

          # Amend the drone's commit with the violation
          git add "$FILE"
          git commit --amend --no-edit 2>/dev/null

          echo "VIOLATION INJECTED! Amended drone commit."
          echo "File: $FILE"
          echo "New state: local serializeEventForSSE in route-handler.ts"
          exit 0
        else
          echo "No serializeEventForSSE import found in $FILE — checking if drone hasn't imported it yet"
          echo "Contents of imports:"
          head -20 "$FILE"
          echo "---"
          echo "Will keep watching for more commits..."
        fi
      else
        echo "route-handler.ts not found in either .minds/dashboard/ or minds/dashboard/"
        echo "Contents of .minds/dashboard/: $(ls .minds/dashboard/ 2>/dev/null)"
        echo "Contents of minds/dashboard/: $(ls minds/dashboard/ 2>/dev/null)"
        echo "Will keep watching for more commits..."
      fi
    fi
  fi

  LAST_COMMIT="$CURRENT_COMMIT"
  sleep 3
done
