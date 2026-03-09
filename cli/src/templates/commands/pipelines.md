---
description: Browse and install collab workflow pipelines from the official registry.
---

## User Input

```text
$ARGUMENTS
```

## Execution

Parse `$ARGUMENTS` to determine the subcommand:
- No arguments → **browse mode**
- `install <name...>` → install named pipelines
- `list` → list installed pipelines
- `update [name...] [--yes]` → check/apply updates
- `remove <name...>` → uninstall pipelines

### Step 1: Locate CLI binary

```bash
git rev-parse --show-toplevel
```

Set `COLLAB_BIN` to `<repo-root>/.collab/bin/collab`.

Check that `COLLAB_BIN` exists on disk. If it does **not** exist:
```
Error: collab CLI not found at .collab/bin/collab
Run /collab.install first to install the collab runtime.
```
Stop — do not proceed further.

### Step 2: Route to subcommand

#### No arguments — Browse mode

Run:
```bash
"$COLLAB_BIN" pipelines --json
```

Parse the JSON output. It has shape:
```json
{ "packs": [{ "name": "...", "latestVersion": "...", "description": "..." }],
  "pipelines": [{ "name": "...", "latestVersion": "...", "description": "..." }] }
```

Build options for AskUserQuestion. Each option has:
- `label`: `<name>  v<latestVersion>` (pack entries prefixed with `[pack] `)
- `description`: the registry description

Present a multiSelect question:

```
{
  questions: [{
    question: "Select pipelines to install (multiSelect):",
    header: "Registry",
    multiSelect: true,
    options: <built from packs + pipelines above>
  }]
}
```

For each selection, run:
```bash
"$COLLAB_BIN" pipelines install <name>
```

Report each install result. If all succeed:
```
✓ Installed: <name1>, <name2>, ...
New commands are available in .claude/commands/.
```

#### `install <name...>`

```bash
"$COLLAB_BIN" pipelines install <name1> [<name2> ...]
```

Report output. On success: `✓ <name> installed.`

#### `list`

```bash
"$COLLAB_BIN" pipelines list
```

Print the output directly.

#### `update [name...] [--yes]`

```bash
"$COLLAB_BIN" pipelines update [<name...>] [--yes]
```

Print the output directly.

#### `remove <name...>`

```bash
"$COLLAB_BIN" pipelines remove <name1> [<name2> ...]
```

Report output. On success: `✓ <name> removed.`

### Step 3: Surface errors

If the CLI exits non-zero, display:
```
Error: collab CLI exited with code <N>
<stderr output>
```

If the CLI is unreachable or stdout cannot be parsed, display the raw output and the error message clearly.
