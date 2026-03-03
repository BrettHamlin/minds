---
description: Install collab workflow system into the current repository from GitHub
---

## Goal

Install the collab workflow system into the current repository by cloning from GitHub and copying files into the appropriate directories.

**Architecture:** This command uses the detailed installation steps below. All file operations are deterministic with no AI interpretation overhead.

## Prerequisites

- Must be run from within a git repository
- Internet connection to clone from GitHub
- Git installed and configured

## Installation

Execute the following bash commands exactly:

```bash
# Clone collab repo
TEMP_DIR="/tmp/collab-install-$$"
git clone --depth 1 --branch dev https://github.com/BrettHamlin/collab "$TEMP_DIR"

if [ $? -ne 0 ]; then
  echo "❌ ERROR: Failed to clone collab repository"
  exit 1
fi

# Run the install script from the cloned repo
bun "$TEMP_DIR/src/commands/collab.install.ts"

# Clean up temp directory
rm -rf "$TEMP_DIR" 2>/dev/null
```

## What Gets Installed

After running `/collab.install`, your repo will have:

```
<your-repo>/
├── .claude/
│   ├── commands/           # Collab commands (auto-discovered)
│   └── skills/             # Local skill copies (SpecCreator, etc.)
├── .collab/
│   ├── handlers/           # Signal emitters
│   ├── scripts/            # Orchestrator scripts
│   └── memory/             # Project state (constitution)
└── .specify/
    ├── scripts/            # Workflow automation
    └── templates/          # File generation templates
```

## Why This Architecture?

- **Fast**: Installation commands are deterministic, no AI interpretation overhead
- **Discoverable**: `/collab.install` command shows up in Claude Code command list
- **Simple**: Step-by-step instructions are clear and easy to follow
- **Maintainable**: All install logic lives in `src/commands/collab.install.ts`
