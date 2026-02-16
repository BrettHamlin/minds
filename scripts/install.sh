#!/usr/bin/env bash
#
# Collab Workflow Installation Script
#
# Installs collab workflow system to repo-local .claude/ directory:
# - Commands: .claude/commands/
# - Skills: .claude/skills/
# - Handlers: .claude/hooks/handlers/
#
# This makes the repo fully self-contained with zero external dependencies.
# All components are copied (not symlinked) from src/ to .claude/
#

set -euo pipefail

# Get absolute path to collab project root
COLLAB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Create repo-local .claude directories
mkdir -p "$COLLAB_ROOT/.claude/commands"
mkdir -p "$COLLAB_ROOT/.claude/skills"
mkdir -p "$COLLAB_ROOT/.claude/hooks/handlers"

echo "📦 Installing collab workflow to repo-local .claude/..."
echo ""

# Copy commands (all .md files from src/commands/)
echo "🔗 Copying commands..."
cp "$COLLAB_ROOT/src/commands/"*.md "$COLLAB_ROOT/.claude/commands/"

echo "  ✓ .claude/commands/collab.clarify.md"
echo "  ✓ .claude/commands/collab.blindqa.md"
echo "  ✓ .claude/commands/collab.spec-critique.md"
echo "  ✓ .claude/commands/collab.specify.md"
echo "  ✓ .claude/commands/collab.plan.md"
echo "  ✓ .claude/commands/collab.tasks.md"
echo "  ✓ .claude/commands/collab.analyze.md"
echo "  ✓ .claude/commands/collab.implement.md"
echo "  ✓ .claude/commands/collab.checklist.md"
echo "  ✓ .claude/commands/collab.constitution.md"
echo "  ✓ .claude/commands/collab.taskstoissues.md"
echo "  ✓ .claude/commands/collab.cleanup.md"
echo "  ✓ .claude/commands/collab.install.md"
echo "  ✓ .claude/commands/collab.run.md"

echo ""
echo "📚 Copying skills..."

# Copy skills from src/skills/ to .claude/skills/
cp -r "$COLLAB_ROOT/src/skills/BlindQA" "$COLLAB_ROOT/.claude/skills/"
cp -r "$COLLAB_ROOT/src/skills/SpecCritique" "$COLLAB_ROOT/.claude/skills/"
cp -r "$COLLAB_ROOT/src/skills/SpecCreator" "$COLLAB_ROOT/.claude/skills/"

echo "  ✓ .claude/skills/BlindQA/ (copied from src/skills/)"
echo "  ✓ .claude/skills/SpecCritique/ (copied from src/skills/)"
echo "  ✓ .claude/skills/SpecCreator/ (copied from src/skills/)"

echo ""
echo "⚡ Copying signal handlers..."

# Copy handlers (all .ts files from src/handlers/)
cp "$COLLAB_ROOT/src/handlers/"*.ts "$COLLAB_ROOT/.claude/hooks/handlers/"
chmod +x "$COLLAB_ROOT/.claude/hooks/handlers/"*.ts

echo "  ✓ .claude/hooks/handlers/emit-question-signal.ts"
echo "  ✓ .claude/hooks/handlers/emit-blindqa-signal.ts"
echo "  ✓ .claude/hooks/handlers/emit-spec-critique-signal.ts"
echo "  ✓ Made handlers executable"

echo ""
echo "✅ Installation complete!"
echo ""
echo "Repo-local installation:"
echo "  Commands:  $COLLAB_ROOT/.claude/commands/"
echo "  Skills:    $COLLAB_ROOT/.claude/skills/"
echo "  Handlers:  $COLLAB_ROOT/.claude/hooks/handlers/"
echo ""
echo "Source of truth: $COLLAB_ROOT/src/"
echo ""
echo "This repo is now fully self-contained with zero external dependencies."
