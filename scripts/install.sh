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

echo "🔗 Creating symlinks for Relay orchestrator commands..."

# Symlink commands
ln -sf "$RELAY_ROOT/src/commands/relay.clarify.md" ~/.claude/commands/relay.clarify.md
ln -sf "$RELAY_ROOT/src/commands/relay.blindqa.md" ~/.claude/commands/relay.blindqa.md

echo "  ✓ ~/.claude/commands/relay.clarify.md"
echo "  ✓ ~/.claude/commands/relay.blindqa.md"

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
echo "  Commands: ~/.claude/commands/relay.{clarify,blindqa}.md"
echo "  Handlers: ~/.claude/hooks/handlers/emit-{question,blindqa}-signal.ts"
echo ""
echo "Source of truth: $RELAY_ROOT/src/"
