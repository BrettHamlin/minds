#!/usr/bin/env bash
#
# Relay Orchestrator Installation Script
#
# Creates symlinks from relay project to ~/.claude/ for:
# - Orchestrated commands (relay.clarify, relay.blindqa)
# - Signal emitters (emit-question-signal.ts, emit-blindqa-signal.ts)
#
# This allows version control in the relay repo while maintaining
# Claude Code command discovery in ~/.claude/
#

set -euo pipefail

# Get absolute path to relay project root
RELAY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Ensure target directories exist
mkdir -p ~/.claude/commands
mkdir -p ~/.claude/hooks/handlers

echo "🔗 Creating symlinks for Relay commands..."

# Symlink orchestrator commands
ln -sf "$RELAY_ROOT/src/commands/collab.clarify.md" ~/.claude/commands/collab.clarify.md
ln -sf "$RELAY_ROOT/src/commands/collab.blindqa.md" ~/.claude/commands/collab.blindqa.md

echo "  ✓ ~/.claude/commands/collab.clarify.md"
echo "  ✓ ~/.claude/commands/collab.blindqa.md"

# Symlink relay workflow commands
ln -sf "$RELAY_ROOT/src/commands/collab.specify.md" ~/.claude/commands/collab.specify.md
ln -sf "$RELAY_ROOT/src/commands/collab.plan.md" ~/.claude/commands/collab.plan.md
ln -sf "$RELAY_ROOT/src/commands/collab.tasks.md" ~/.claude/commands/collab.tasks.md
ln -sf "$RELAY_ROOT/src/commands/collab.analyze.md" ~/.claude/commands/collab.analyze.md
ln -sf "$RELAY_ROOT/src/commands/collab.implement.md" ~/.claude/commands/collab.implement.md
ln -sf "$RELAY_ROOT/src/commands/collab.checklist.md" ~/.claude/commands/collab.checklist.md
ln -sf "$RELAY_ROOT/src/commands/collab.constitution.md" ~/.claude/commands/collab.constitution.md
ln -sf "$RELAY_ROOT/src/commands/collab.taskstoissues.md" ~/.claude/commands/collab.taskstoissues.md

echo "  ✓ ~/.claude/commands/collab.specify.md"
echo "  ✓ ~/.claude/commands/collab.plan.md"
echo "  ✓ ~/.claude/commands/collab.tasks.md"
echo "  ✓ ~/.claude/commands/collab.analyze.md"
echo "  ✓ ~/.claude/commands/collab.implement.md"
echo "  ✓ ~/.claude/commands/collab.checklist.md"
echo "  ✓ ~/.claude/commands/collab.constitution.md"
echo "  ✓ ~/.claude/commands/collab.taskstoissues.md"

# Symlink handlers
ln -sf "$RELAY_ROOT/src/handlers/emit-question-signal.ts" ~/.claude/hooks/handlers/emit-question-signal.ts
ln -sf "$RELAY_ROOT/src/handlers/emit-blindqa-signal.ts" ~/.claude/hooks/handlers/emit-blindqa-signal.ts

echo "  ✓ ~/.claude/hooks/handlers/emit-question-signal.ts"
echo "  ✓ ~/.claude/hooks/handlers/emit-blindqa-signal.ts"

# Make handlers executable
chmod +x ~/.claude/hooks/handlers/emit-question-signal.ts
chmod +x ~/.claude/hooks/handlers/emit-blindqa-signal.ts

echo "  ✓ Made handlers executable"

echo ""
echo "✅ Installation complete!"
echo ""
echo "Symlinks created:"
echo "  Orchestrator: ~/.claude/commands/collab.{clarify,blindqa}.md"
echo "  Workflow:      ~/.claude/commands/collab.{specify,plan,tasks,analyze,implement,checklist,constitution,taskstoissues}.md"
echo "  Handlers:     ~/.claude/hooks/handlers/emit-{question,blindqa}-signal.ts"
echo ""
echo "Source of truth: $RELAY_ROOT/src/"
