#!/usr/bin/env bash
set -e

# collab.install.sh - Install collab workflow system into current repository
# Description: Install collab workflow system into the current repository from GitHub

# Check if we're in a git repository
if [ ! -d .git ]; then
  echo "❌ ERROR: Not in a git repository. Run this command from the root of your project."
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
echo "📁 Installing collab into: $REPO_ROOT"

# Create temp directory for cloning
TEMP_DIR="/tmp/collab-install-$$"

echo "📦 Cloning collab from GitHub (dev branch)..."
git clone --depth 1 --branch dev https://github.com/BrettHamlin/collab "$TEMP_DIR"

if [ $? -ne 0 ]; then
  echo "❌ ERROR: Failed to clone collab repository"
  exit 1
fi

echo "✅ Clone successful"

# Create directory structure
echo "📂 Creating directory structure..."
mkdir -p "$REPO_ROOT/.claude/commands"
mkdir -p "$REPO_ROOT/.claude/skills"
mkdir -p "$REPO_ROOT/.collab/handlers"
mkdir -p "$REPO_ROOT/.collab/memory"
mkdir -p "$REPO_ROOT/.collab/scripts/orchestrator"
mkdir -p "$REPO_ROOT/.collab/state/pipeline-registry"
mkdir -p "$REPO_ROOT/.collab/state/pipeline-groups"
mkdir -p "$REPO_ROOT/.specify/scripts"
mkdir -p "$REPO_ROOT/.specify/templates"
echo "✅ Directories created"

# Copy collab files
echo "📋 Copying collab files..."

# Copy commands (excluding collab.install.md and collab.install.sh)
echo "  → Commands..."
find "$TEMP_DIR/src/commands" -name "*.md" ! -name "collab.install.md" -exec cp {} "$REPO_ROOT/.claude/commands/" \;
COMMAND_COUNT=$(find "$REPO_ROOT/.claude/commands" -name "collab.*.md" 2>/dev/null | wc -l | tr -d ' ')

# Copy skills
echo "  → Skills..."
if [ -d "$TEMP_DIR/src/skills" ]; then
  cp -r "$TEMP_DIR/src/skills"/* "$REPO_ROOT/.claude/skills/"
  SKILL_COUNT=$(find "$REPO_ROOT/.claude/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
else
  SKILL_COUNT=0
  echo "  ⚠️  Warning: No skills directory found in source"
fi

# Copy handlers
echo "  → Handlers..."
find "$TEMP_DIR/src/handlers" -name "*.ts" -exec cp {} "$REPO_ROOT/.collab/handlers/" \;
find "$REPO_ROOT/.collab/handlers" -name "*.ts" -exec chmod +x {} \;
HANDLER_COUNT=$(find "$REPO_ROOT/.collab/handlers" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')

# Copy orchestrator scripts
echo "  → Orchestrator scripts..."
find "$TEMP_DIR/src/scripts/orchestrator" \( -name "*.sh" -o -name "Tmux.ts" \) -exec cp {} "$REPO_ROOT/.collab/scripts/orchestrator/" \;
ORCHESTRATOR_SCRIPT_COUNT=$(find "$REPO_ROOT/.collab/scripts/orchestrator" -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')

# Copy workflow scripts
echo "  → Workflow scripts..."
cp -r "$TEMP_DIR/.specify/scripts"/* "$REPO_ROOT/.specify/scripts/"
find "$REPO_ROOT/.specify/scripts/bash" -name "*.sh" -exec chmod +x {} \;
SCRIPT_COUNT=$(find "$REPO_ROOT/.specify/scripts/bash" -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')

# Copy templates
echo "  → Templates..."
cp -r "$TEMP_DIR/.specify/templates"/* "$REPO_ROOT/.specify/templates/"
TEMPLATE_COUNT=$(find "$REPO_ROOT/.specify/templates" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

# Copy constitution if it doesn't exist
if [ ! -f "$REPO_ROOT/.collab/memory/constitution.md" ]; then
  echo "  → Constitution (initializing)..."
  cp "$TEMP_DIR/.specify/templates/constitution-template.md" "$REPO_ROOT/.collab/memory/constitution.md"
else
  echo "  → Constitution (already exists, skipping)"
fi

echo "✅ Files copied"

# Set permissions
echo "🔧 Setting permissions..."
find "$REPO_ROOT/.collab/scripts/orchestrator" -name "*.sh" -exec chmod +x {} \;
echo "✅ Permissions set"

# Verify installation
echo "🔍 Verifying installation..."

# Verify collab.install.md was NOT copied
if [ -f "$REPO_ROOT/.claude/commands/collab.install.md" ]; then
  echo "  ⚠️  WARNING: collab.install.md was copied (should be excluded)"
else
  echo "  ✓ collab.install.md correctly excluded"
fi

# Verify collab.install.sh was NOT copied
if [ -f "$REPO_ROOT/.claude/commands/collab.install.sh" ]; then
  echo "  ⚠️  WARNING: collab.install.sh was copied (should be excluded)"
else
  echo "  ✓ collab.install.sh correctly excluded"
fi

# Verify expected files exist
if [ -f "$REPO_ROOT/.claude/commands/collab.specify.md" ]; then
  echo "  ✓ Command files present"
fi

if [ -d "$REPO_ROOT/.claude/skills" ] && [ "$(ls -A "$REPO_ROOT/.claude/skills")" ]; then
  echo "  ✓ Skills present"
fi

if [ -f "$REPO_ROOT/.collab/handlers/emit-question-signal.ts" ]; then
  echo "  ✓ Handlers present"
fi

echo "✅ Verification complete"

# Clean up
echo "🧹 Cleaning up..."
rm -rf "$TEMP_DIR" 2>/dev/null || echo "  ℹ️  Temp files in /tmp will be auto-cleaned by system"
echo "✅ Cleanup complete"

# Report installation summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Collab installation complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Installation Summary:"
echo "  • Commands:       $COMMAND_COUNT files → .claude/commands/"
echo "  • Skills:         $SKILL_COUNT dirs → .claude/skills/"
echo "  • Handlers:       $HANDLER_COUNT files → .collab/handlers/"
echo "  • Orchestrator:   $ORCHESTRATOR_SCRIPT_COUNT scripts → .collab/scripts/orchestrator/"
echo "  • Workflow:       $SCRIPT_COUNT scripts → .specify/scripts/bash/"
echo "  • Templates:      $TEMPLATE_COUNT files → .specify/templates/"
echo "  • Memory:         .collab/memory/constitution.md"
echo ""
echo "📍 Installed in: $REPO_ROOT"
echo ""
echo "🚀 Available Commands:"
echo "  • /collab.run        - Autonomous full pipeline orchestration"
echo "  • /collab.specify    - Create feature specification"
echo "  • /collab.clarify    - Clarify ambiguities in spec"
echo "  • /collab.plan       - Generate implementation plan"
echo "  • /collab.tasks      - Break plan into tasks"
echo "  • /collab.analyze    - Analyze spec/plan/tasks consistency"
echo "  • /collab.implement  - Execute implementation"
echo "  • /collab.checklist  - Generate quality checklist"
echo "  • /collab.constitution - Manage project principles"
echo "  • /collab.taskstoissues - Convert tasks to GitHub issues"
echo "  • /collab.blindqa    - Blind verification testing"
echo "  • /collab.cleanup    - Clean up completed feature (branch/worktree)"
echo ""
echo "💡 Next Steps:"
echo "  1. Run /collab.run BRE-XXX for fully autonomous workflow"
echo "  2. Or run /collab.specify to create feature spec manually"
echo "  3. Customize .collab/memory/constitution.md for your project"
echo ""
echo "🔄 To update collab, run: bash .claude/commands/collab.install.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
