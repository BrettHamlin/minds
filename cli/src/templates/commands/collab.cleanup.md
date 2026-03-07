---
description: Clean up feature branch or worktree after completion
---

# Collab Cleanup Command

Clean up a completed feature by removing the branch or worktree, tmux pane, registry, and spec directories. Checks merge status and prompts for confirmation before destructive operations.

## Arguments

`$ARGUMENTS` = ticket ID (e.g., `BRE-191`)

## Workflow

### 1. Validate Input

```bash
TICKET_ID="$ARGUMENTS"

if [ -z "$TICKET_ID" ]; then
    echo "Usage: /collab.cleanup <ticket-id>"
    echo "Example: /collab.cleanup BRE-191"
    exit 1
fi

echo "🧹 Cleaning up $TICKET_ID..."
```

### 2. Detect Mode (Worktree vs Branch)

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
METADATA_FILE=""
WORKTREE_PATH=""
BRANCH_NAME=""

# Check for metadata.json in main repo specs
for metadata in "$REPO_ROOT"/specs/*/metadata.json; do
    if [ -f "$metadata" ]; then
        TICKET=$(jq -r '.ticket_id // empty' "$metadata" 2>/dev/null)
        if [ "$TICKET" = "$TICKET_ID" ]; then
            METADATA_FILE="$metadata"
            WORKTREE_PATH=$(jq -r '.worktree_path // empty' "$metadata")
            BRANCH_NAME=$(jq -r '.branch_name // empty' "$metadata")
            break
        fi
    fi
done

# If no metadata found, try to find branch directly
if [ -z "$BRANCH_NAME" ]; then
    # Look for branches matching pattern *-<ticket-name>
    TICKET_PATTERN=$(echo "$TICKET_ID" | sed 's/-/[^-]*-/')
    BRANCH_NAME=$(git branch --list "*-*" | grep -i "$TICKET_ID" | sed 's/^[* ]*//' | head -1)

    if [ -z "$BRANCH_NAME" ]; then
        echo "❌ No branch or worktree found for $TICKET_ID"
        exit 1
    fi
fi

MODE="branch"
if [ -n "$WORKTREE_PATH" ]; then
    MODE="worktree"
fi

echo "📍 Found: $BRANCH_NAME ($MODE mode)"
```

### 3. Check Merge Status

```bash
# Check if branch is merged into dev
git fetch origin dev:dev 2>/dev/null || true

if git merge-base --is-ancestor "$BRANCH_NAME" dev 2>/dev/null; then
    MERGED=true
    echo "✅ Branch is merged into dev"
else
    MERGED=false
    echo "⚠️  Branch is NOT merged into dev"
fi
```

### 4. Confirmation (if unmerged)

If branch is not merged, use AskUserQuestion tool to confirm cleanup action:

```typescript
if (!MERGED) {
    // Use AskUserQuestion with two options
    const response = await AskUserQuestion({
        questions: [{
            question: `Branch ${BRANCH_NAME} is not merged into dev. What would you like to do?`,
            header: "Unmerged",
            multiSelect: false,
            options: [
                {
                    label: "Merge to dev, then cleanup",
                    description: "Merge the branch into dev before cleaning up. Preserves your work."
                },
                {
                    label: "Cleanup without merging",
                    description: "Delete the branch/worktree WITHOUT merging. Work will be lost!"
                }
            ]
        }]
    });

    const choice = response.answers["0"]; // Get first question answer

    if (choice === "Merge to dev, then cleanup") {
        // Merge to dev first
        await Bash({
            command: `git checkout dev && git merge ${BRANCH_NAME} && git push origin dev`,
            description: "Merge branch to dev"
        });
        echo "✅ Merged to dev";
    } else {
        echo "⚠️  Proceeding with cleanup WITHOUT merging";
    }
}
```

### 5. Kill Tmux Pane

```bash
SCRIPTS=.collab/scripts/orchestrator

# Find agent pane from registry
REGISTRY_PATH=$(bun .collab/scripts/orchestrator/resolve-path.ts ${TICKET_ID} registry)
if [ -f "$REGISTRY_PATH" ]; then
    AGENT_PANE=$(jq -r '.agent_pane_id' "$REGISTRY_PATH" 2>/dev/null)

    if [ -n "$AGENT_PANE" ]; then
        tmux kill-pane -t "$AGENT_PANE" 2>/dev/null && echo "✅ Killed pane $AGENT_PANE" || echo "⚠️  Pane not found"
    fi
fi
```

### 6. Clean Git Artifacts

**For Worktree Mode:**
```bash
if [ "$MODE" = "worktree" ] && [ -n "$WORKTREE_PATH" ]; then
    # Remove worktree
    if [ -d "$WORKTREE_PATH" ]; then
        git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || rm -rf "$WORKTREE_PATH"
        echo "✅ Removed worktree: $WORKTREE_PATH"
    fi

    # Prune worktree references
    git worktree prune

    # Delete branch (local and remote if merged)
    git branch -D "$BRANCH_NAME" 2>/dev/null && echo "✅ Deleted local branch: $BRANCH_NAME"

    if [ "$MERGED" = true ]; then
        git push origin --delete "$BRANCH_NAME" 2>/dev/null && echo "✅ Deleted remote branch: $BRANCH_NAME"
    fi
fi
```

**For Branch Mode:**
```bash
if [ "$MODE" = "branch" ]; then
    # Switch back to dev before deleting
    git checkout dev 2>/dev/null

    # Delete branch (local and remote if merged)
    git branch -D "$BRANCH_NAME" 2>/dev/null && echo "✅ Deleted local branch: $BRANCH_NAME"

    if [ "$MERGED" = true ]; then
        git push origin --delete "$BRANCH_NAME" 2>/dev/null && echo "✅ Deleted remote branch: $BRANCH_NAME"
    fi
fi
```

### 7. Clean Registry and Specs

```bash
# Remove pipeline registry
REGISTRY_PATH=$(bun .collab/scripts/orchestrator/resolve-path.ts ${TICKET_ID} registry)
if [ -f "$REGISTRY_PATH" ]; then
    rm -f "$REGISTRY_PATH"
    echo "✅ Removed registry"
fi

# Remove spec directory
SPEC_DIR="$REPO_ROOT/specs/${BRANCH_NAME}"
if [ -d "$SPEC_DIR" ]; then
    rm -rf "$SPEC_DIR"
    echo "✅ Removed spec directory"
fi

# Remove metadata file
if [ -n "$METADATA_FILE" ] && [ -f "$METADATA_FILE" ]; then
    rm -f "$METADATA_FILE"
    METADATA_DIR=$(dirname "$METADATA_FILE")
    rmdir "$METADATA_DIR" 2>/dev/null  # Remove dir if empty
    echo "✅ Removed metadata"
fi
```

### 8. Report Completion

```bash
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Cleanup complete for $TICKET_ID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Removed:"
echo "  • Tmux pane"
echo "  • Branch: $BRANCH_NAME"
if [ "$MODE" = "worktree" ]; then
    echo "  • Worktree: $WORKTREE_PATH"
fi
echo "  • Pipeline registry"
echo "  • Spec directory"
echo "  • Metadata file"
echo ""
```

## Safety Features

- **Merge Check**: Automatically detects if branch is merged to dev
- **Confirmation**: Asks user before cleaning unmerged work
- **Merge Option**: Can merge before cleanup to preserve work
- **Mode Detection**: Handles both worktree and branch cleanup
- **Complete Cleanup**: Removes all traces (pane, git, registry, specs)

## Usage Examples

<!-- lint:ok: user-facing examples showing what the human types, not AI skill invocations -->
```bash
# Cleanup merged feature
/collab.cleanup BRE-191

# Cleanup unmerged feature (will prompt)
/collab.cleanup BRE-192
```

## Notes

- Always checks merge status before destructive operations
- Prompts for confirmation if work is not merged
- Handles both worktree and branch modes automatically
- Safe to run multiple times (idempotent where possible)
