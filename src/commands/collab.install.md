---
description: Install collab workflow system into the current repository from GitHub
---

## Goal

Install the collab workflow system into the current repository by cloning from GitHub and copying files into the appropriate directories.

## Prerequisites

- Must be run from within a git repository
- Internet connection to clone from GitHub
- Git installed and configured

## Installation Steps

### 1. Verify Repository Context

```bash
# Check if we're in a git repository
if [ ! -d .git ]; then
  echo "❌ ERROR: Not in a git repository. Run this command from the root of your project."
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
# Note: Avoid cd to prevent zoxide/shell hook interference

echo "📁 Installing collab into: $REPO_ROOT"
```

### 2. Clone Collab from GitHub

```bash
# Create temp directory for cloning
TEMP_DIR="/tmp/collab-install-$$"

echo "📦 Cloning collab from GitHub (dev branch)..."

git clone --depth 1 --branch dev https://github.com/BrettHamlin/collab "$TEMP_DIR"

if [ $? -ne 0 ]; then
  echo "❌ ERROR: Failed to clone collab repository"
  exit 1
fi

echo "✅ Clone successful"
```

### 3. Create Directory Structure

```bash
echo "📂 Creating directory structure..."

mkdir -p .claude/commands
mkdir -p .collab/handlers
mkdir -p .collab/memory
mkdir -p .collab/scripts/orchestrator
mkdir -p .collab/state/pipeline-registry
mkdir -p .collab/state/pipeline-groups
mkdir -p .specify/scripts
mkdir -p .specify/templates

echo "✅ Directories created"
```

### 4. Copy Collab Files

```bash
echo "📋 Copying collab files..."

# Copy commands to .claude/commands/ (excluding collab.install.md)
# Use find instead of globs to avoid shell expansion issues
echo "  → Commands..."
find "$TEMP_DIR/src/commands" -name "*.md" ! -name "collab.install.md" -exec cp {} "$REPO_ROOT/.claude/commands/" \;
COMMAND_COUNT=$(find "$REPO_ROOT/.claude/commands" -name "collab.*.md" 2>/dev/null | wc -l | tr -d ' ')

# Copy handlers to .collab/handlers/
echo "  → Handlers..."
find "$TEMP_DIR/src/handlers" -name "*.ts" -exec cp {} "$REPO_ROOT/.collab/handlers/" \;
find "$REPO_ROOT/.collab/handlers" -name "*.ts" -exec chmod +x {} \;
HANDLER_COUNT=$(find "$REPO_ROOT/.collab/handlers" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')

# Copy orchestrator scripts to .collab/scripts/orchestrator/
echo "  → Orchestrator scripts..."
find "$TEMP_DIR/src/scripts/orchestrator" \( -name "*.sh" -o -name "Tmux.ts" \) -exec cp {} "$REPO_ROOT/.collab/scripts/orchestrator/" \;
ORCHESTRATOR_SCRIPT_COUNT=$(find "$REPO_ROOT/.collab/scripts/orchestrator" -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')

# Copy scripts to .specify/scripts/
echo "  → Workflow scripts..."
cp -r "$TEMP_DIR/.specify/scripts"/* "$REPO_ROOT/.specify/scripts/"
find "$REPO_ROOT/.specify/scripts/bash" -name "*.sh" -exec chmod +x {} \;
SCRIPT_COUNT=$(find "$REPO_ROOT/.specify/scripts/bash" -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')

# Copy templates to .specify/templates/
echo "  → Templates..."
cp -r "$TEMP_DIR/.specify/templates"/* "$REPO_ROOT/.specify/templates/"
TEMPLATE_COUNT=$(find "$REPO_ROOT/.specify/templates" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

# Copy constitution if it doesn't exist
if [ ! -f "$REPO_ROOT/.collab/memory/constitution.md" ]; then
  echo "  → Constitution (initializing)..."
  cp "$TEMP_DIR/.collab/memory/constitution.md" "$REPO_ROOT/.collab/memory/"
else
  echo "  → Constitution (already exists, skipping)"
fi

echo "✅ Files copied"
```

### 5. Set Permissions

```bash
echo "🔧 Setting permissions..."

# Make orchestrator scripts executable
find "$REPO_ROOT/.collab/scripts/orchestrator" -name "*.sh" -exec chmod +x {} \;

echo "✅ Permissions set"
```

### 6. Verify Installation

```bash
echo "🔍 Verifying installation..."

# Verify collab.install.md was NOT copied (self-exclusion check)
if [ -f "$REPO_ROOT/.claude/commands/collab.install.md" ]; then
  echo "⚠️  WARNING: collab.install.md was copied (should be excluded)"
else
  echo "  ✓ collab.install.md correctly excluded"
fi

# Verify expected files exist
if [ -f "$REPO_ROOT/.claude/commands/collab.specify.md" ]; then
  echo "  ✓ Command files present"
fi

if [ -f "$REPO_ROOT/.collab/handlers/emit-question-signal.ts" ]; then
  echo "  ✓ Handlers present"
fi

echo "✅ Verification complete"
```

### 7. Clean Up

```bash
echo "🧹 Cleaning up..."

# Note: Security hooks may block rm -rf commands
# Temp directory will be auto-cleaned by system if blocked
rm -rf "$TEMP_DIR" 2>/dev/null || echo "  ℹ️  Temp files in /tmp will be auto-cleaned by system"

echo "✅ Cleanup complete"
```

### 8. Report Installation Summary

```bash
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Collab installation complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Installation Summary:"
echo "  • Commands:       $COMMAND_COUNT files → .claude/commands/"
echo "  • Handlers:       $HANDLER_COUNT files → .collab/handlers/"
echo "  • Orchestrator:   $ORCHESTRATOR_SCRIPT_COUNT scripts → .collab/scripts/orchestrator/"
echo "  • Workflow:       $SCRIPT_COUNT scripts → .specify/scripts/bash/"
echo "  • Templates:      $TEMPLATE_COUNT files → .specify/templates/"
echo "  • Memory:         .collab/memory/constitution.md"
echo ""
echo "📍 Installed in: $REPO_ROOT"
echo ""
echo "🚀 Available Commands:"
echo "  • /collab.run   - Autonomous full pipeline orchestration"
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
echo "🔄 To update collab, run /collab.install again"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

## Notes

- **Source**: Clones from https://github.com/BrettHamlin/collab (dev branch)
- **Updates**: Re-running `/collab.install` updates all files to the latest version
- **Constitution**: Only initialized on first install, preserved on updates
- **Discovery**: Commands in `.claude/commands/` are automatically discovered by Claude Code
- **Exclusion**: `collab.install.md` is intentionally NOT copied to local repos (it's a system command, not a workflow command)
- **Security Hooks**: Cleanup may be blocked by PAI Security Validator; temp files in `/tmp` are auto-cleaned by system
- **Shell Compatibility**: Uses `find` instead of globs for reliable file operations across shells
- **Verification**: Confirms self-exclusion and validates installation integrity

## Directory Structure

After installation, your repo will have:

```
<your-repo>/
├── .claude/
│   └── commands/           # Collab command files (auto-discovered)
│       ├── collab.specify.md
│       ├── collab.clarify.md
│       ├── collab.plan.md
│       ├── collab.tasks.md
│       ├── collab.analyze.md
│       ├── collab.implement.md
│       ├── collab.checklist.md
│       ├── collab.constitution.md
│       ├── collab.taskstoissues.md
│       ├── collab.blindqa.md
│       └── collab.cleanup.md
├── .collab/
│   ├── handlers/           # Signal emitters for orchestration
│   │   ├── emit-question-signal.ts
│   │   └── emit-blindqa-signal.ts
│   └── memory/             # Project-specific state
│       └── constitution.md
└── .specify/
    ├── scripts/            # Workflow automation scripts
    │   ├── check-prerequisites.sh
    │   ├── setup-plan.sh
    │   ├── create-new-feature.sh
    │   └── update-agent-context.sh
    └── templates/          # File generation templates
        ├── spec-template.md
        ├── plan-template.md
        ├── tasks-template.md
        └── checklist-template.md
```
