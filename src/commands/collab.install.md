---
description: Install collab workflow system into the current repository from GitHub
---

## Goal

Install the collab workflow system into the current repository by cloning from GitHub and copying files into the appropriate directories.

**Architecture:** This command delegates to `collab.install.sh` for fast, deterministic execution. The shell script handles all file operations without AI interpretation.

## Prerequisites

- Must be run from within a git repository
- Internet connection to clone from GitHub
- Git installed and configured

## Installation

Execute the install script:

```bash
# Clone collab repo to get the install script
TEMP_DIR="/tmp/collab-install-$$"
git clone --depth 1 --branch dev https://github.com/BrettHamlin/collab "$TEMP_DIR"

if [ $? -ne 0 ]; then
  echo "❌ ERROR: Failed to clone collab repository"
  exit 1
fi

# Execute the install script
bash "$TEMP_DIR/src/commands/collab.install.sh"

# Clean up temp directory
rm -rf "$TEMP_DIR" 2>/dev/null
```

That's it! The shell script handles all the heavy lifting deterministically.

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

- **Fast**: Shell script is deterministic, no AI interpretation overhead
- **Discoverable**: `/collab.install` command shows up in Claude Code command list
- **Simple**: Just delegates to the shell script that does the real work
- **Maintainable**: All install logic in one place (collab.install.sh)
