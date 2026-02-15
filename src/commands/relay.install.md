---
description: Install relay workflow system into the current repository from GitHub
---

## Goal

Install the relay workflow system into the current repository by cloning from GitHub and copying files into the appropriate directories.

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
cd "$REPO_ROOT"

echo "📁 Installing relay into: $REPO_ROOT"
```

### 2. Clone Relay from GitHub

```bash
# Create temp directory for cloning
TEMP_DIR="/tmp/relay-install-$$"

echo "📦 Cloning relay from GitHub (dev branch)..."

git clone --depth 1 --branch dev https://github.com/BrettHamlin/relay "$TEMP_DIR"

if [ $? -ne 0 ]; then
  echo "❌ ERROR: Failed to clone relay repository"
  exit 1
fi

echo "✅ Clone successful"
```

### 3. Create Directory Structure

```bash
echo "📂 Creating directory structure..."

mkdir -p .claude/commands
mkdir -p .relay/handlers
mkdir -p .relay/memory
mkdir -p .relay/scripts/orchestrator
mkdir -p .specify/scripts
mkdir -p .specify/templates

echo "✅ Directories created"
```

### 4. Copy Relay Files

```bash
echo "📋 Copying relay files..."

# Copy commands to .claude/commands/
echo "  → Commands..."
cp "$TEMP_DIR"/src/commands/*.md .claude/commands/
COMMAND_COUNT=$(ls .claude/commands/relay.*.md 2>/dev/null | wc -l)

# Copy handlers to .relay/handlers/
echo "  → Handlers..."
cp "$TEMP_DIR"/src/handlers/*.ts .relay/handlers/
HANDLER_COUNT=$(ls .relay/handlers/*.ts 2>/dev/null | wc -l)

# Copy orchestrator scripts to .relay/scripts/orchestrator/
echo "  → Orchestrator scripts..."
cp "$TEMP_DIR"/src/scripts/orchestrator/*.sh .relay/scripts/orchestrator/
ORCHESTRATOR_SCRIPT_COUNT=$(ls .relay/scripts/orchestrator/*.sh 2>/dev/null | wc -l)

# Copy scripts to .specify/scripts/
echo "  → Workflow scripts..."
cp -r "$TEMP_DIR"/.specify/scripts/* .specify/scripts/
SCRIPT_COUNT=$(ls .specify/scripts/bash/*.sh 2>/dev/null | wc -l)

# Copy templates to .specify/templates/
echo "  → Templates..."
cp -r "$TEMP_DIR"/.specify/templates/* .specify/templates/
TEMPLATE_COUNT=$(ls .specify/templates/*.md 2>/dev/null | wc -l)

# Copy constitution if it doesn't exist
if [ ! -f .relay/memory/constitution.md ]; then
  echo "  → Constitution (initializing)..."
  cp "$TEMP_DIR"/.relay/memory/constitution.md .relay/memory/
else
  echo "  → Constitution (already exists, skipping)"
fi

echo "✅ Files copied"
```

### 5. Set Permissions

```bash
echo "🔧 Setting permissions..."

# Make handlers executable
chmod +x .relay/handlers/*.ts

# Make orchestrator scripts executable
chmod +x .relay/scripts/orchestrator/*.sh

# Make workflow scripts executable
chmod +x .specify/scripts/bash/*.sh

echo "✅ Permissions set"
```

### 6. Clean Up

```bash
echo "🧹 Cleaning up..."

rm -rf "$TEMP_DIR"

echo "✅ Cleanup complete"
```

### 7. Report Installation Summary

```bash
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Relay installation complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Installation Summary:"
echo "  • Commands:       $COMMAND_COUNT files → .claude/commands/"
echo "  • Handlers:       $HANDLER_COUNT files → .relay/handlers/"
echo "  • Orchestrator:   $ORCHESTRATOR_SCRIPT_COUNT scripts → .relay/scripts/orchestrator/"
echo "  • Workflow:       $SCRIPT_COUNT scripts → .specify/scripts/bash/"
echo "  • Templates:      $TEMPLATE_COUNT files → .specify/templates/"
echo "  • Memory:         .relay/memory/constitution.md"
echo ""
echo "📍 Installed in: $REPO_ROOT"
echo ""
echo "🚀 Available Commands:"
echo "  • /relay.pipeline   - Autonomous full pipeline orchestration"
echo "  • /relay.specify    - Create feature specification"
echo "  • /relay.clarify    - Clarify ambiguities in spec"
echo "  • /relay.plan       - Generate implementation plan"
echo "  • /relay.tasks      - Break plan into tasks"
echo "  • /relay.analyze    - Analyze spec/plan/tasks consistency"
echo "  • /relay.implement  - Execute implementation"
echo "  • /relay.checklist  - Generate quality checklist"
echo "  • /relay.constitution - Manage project principles"
echo "  • /relay.taskstoissues - Convert tasks to GitHub issues"
echo "  • /relay.blindqa    - Blind verification testing"
echo ""
echo "💡 Next Steps:"
echo "  1. Run /relay.pipeline BRE-XXX for fully autonomous workflow"
echo "  2. Or run /relay.specify to create feature spec manually"
echo "  3. Customize .relay/memory/constitution.md for your project"
echo ""
echo "🔄 To update relay, run /relay.install again"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

## Notes

- **Source**: Clones from https://github.com/BrettHamlin/relay (dev branch)
- **Updates**: Re-running `/relay.install` updates all files to the latest version
- **Constitution**: Only initialized on first install, preserved on updates
- **Discovery**: Commands in `.claude/commands/` are automatically discovered by Claude Code

## Directory Structure

After installation, your repo will have:

```
<your-repo>/
├── .claude/
│   └── commands/           # Relay command files (auto-discovered)
│       ├── relay.specify.md
│       ├── relay.clarify.md
│       ├── relay.plan.md
│       ├── relay.tasks.md
│       ├── relay.analyze.md
│       ├── relay.implement.md
│       ├── relay.checklist.md
│       ├── relay.constitution.md
│       ├── relay.taskstoissues.md
│       └── relay.blindqa.md
├── .relay/
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
