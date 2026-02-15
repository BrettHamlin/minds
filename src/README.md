# Relay Orchestrator Components

This directory contains Relay-specific orchestration adapters that integrate with the pipeline-orchestrator system.

## Structure

```
src/
├── commands/           # Orchestrated command files
│   ├── relay.clarify.md     # Spec clarification with signal emission
│   └── relay.blindqa.md     # Blind verification with retry loop
└── handlers/           # Signal emission utilities
    ├── emit-question-signal.ts   # CLARIFY_QUESTION signal emitter
    └── emit-blindqa-signal.ts    # BlindQA lifecycle signal emitter
```

## Installation

Run the installation script to create symlinks from this repo to `~/.claude/`:

```bash
./scripts/install.sh
```

This creates:
- `~/.claude/commands/relay.clarify.md` → `src/commands/relay.clarify.md`
- `~/.claude/commands/relay.blindqa.md` → `src/commands/relay.blindqa.md`
- `~/.claude/hooks/handlers/emit-question-signal.ts` → `src/handlers/emit-question-signal.ts`
- `~/.claude/hooks/handlers/emit-blindqa-signal.ts` → `src/handlers/emit-blindqa-signal.ts`

## Architecture

These components follow the **Adapter Pattern** for orchestrator integration:

```
Domain Logic (Skill) → Orchestration Adapter (Command) → Signal Emitter (Handler)
Example: BlindQA skill → relay.blindqa command → emit-blindqa-signal.ts
```

### Commands

**relay.clarify.md**
- Purpose: Orchestrator-compatible spec clarification
- Max Questions: 3 (vs 5 in standard clarify workflow)
- Signal Flow: emit-question-signal.ts → AskUserQuestion → integrate answer → repeat

**relay.blindqa.md**
- Purpose: Blind verification with retry loop (max 3 attempts)
- Signal Flow: emit-blindqa-signal.ts start → invoke BlindQA skill → evaluate → retry or complete

### Signal Emitters

**emit-question-signal.ts**
- Signals: `CLARIFY_QUESTION`, `CLARIFY_COMPLETE`
- Called: BEFORE AskUserQuestion for deterministic timing
- Registry: Reads ticket_id and nonce from pipeline registry

**emit-blindqa-signal.ts**
- Signals: `BLINDQA_WAITING`, `BLINDQA_COMPLETE`, `BLINDQA_FAILED`, `BLINDQA_ERROR`
- Called: At phase start/end for lifecycle management
- Registry: Updates current_step and emits to orchestrator pane

## Shared Infrastructure

Both signal emitters depend on `pipeline-signal.ts` (from pipeline-orchestrator):
- Installed at: `~/.claude/hooks/handlers/pipeline-signal.ts`
- Provides: `mapResponseState()`, `buildSignalMessage()`, `resolveRegistry()`, `truncateDetail()`

## Registry Architecture

Pipeline registry files live at:
```
~/.claude/MEMORY/STATE/pipeline-registry/{ticket_id}.json
```

Format:
```json
{
  "ticket_id": "BRE-191",
  "nonce": "abc123",
  "current_step": "clarify",
  "orchestrator_pane_id": "%0.0",
  "agent_pane_id": "%0.1"
}
```

## Design Decision: Deterministic Signal Emission

**Problem**: Hook-based signal emission was unreliable (race conditions, missed signals, unpredictable timing)

**Solution**: Explicit Bash calls at precise workflow moments

**Benefits**:
- ✅ Explicit control over signal timing
- ✅ Deterministic (same code path = same signals)
- ✅ Verifiable (signals visible in command file)
- ✅ No race conditions
- ✅ Skills remain clean and reusable

## Related Projects

- **pipeline-orchestrator**: `/Users/atlas/Code/projects/pipeline-orchestrator/` - Orchestration coordination framework
- **PAI**: `~/.claude/` - Core system infrastructure

## Version Control

Source of truth for these files is THIS repository. The symlink pattern allows:
- ✅ Version control and collaboration
- ✅ Installation script automation
- ✅ Claude Code command discovery (requires `~/.claude/` location)
- ✅ Clean separation between PAI core and Relay-specific tooling
