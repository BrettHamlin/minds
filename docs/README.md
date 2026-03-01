# Collab Documentation

## Documentation Levels

This documentation uses **progressive disclosure** — four layers of increasing detail so you find the right depth quickly.

### Level 1 — Architecture Overview

**File**: `L1-architecture.md`
**Audience**: New contributors, AI agents needing system context, anyone asking "what does collab do?"
**Covers**: System purpose, three-layer architecture, 7-phase pipeline overview, component inventory, technology stack
**When to use**: First contact with the codebase. Answers "what" and "why" questions.

### Level 2 — Subsystem Detail

**Files**: `L2-orchestrator-state-machine.md`, `L2-install-system.md`, `L2-subsystems.md`
**Audience**: Developers working on a specific subsystem, AI agents debugging a specific flow
**Covers**: How each subsystem works internally, inputs/outputs, state transitions, relationships between components
**When to use**: You know which subsystem you need; you want to understand how it works. Answers "how" questions.

### Level 3 — Implementation Reference

**File**: `L3-script-reference.md`
**Audience**: Developers modifying scripts, AI agents needing exact parameter signatures
**Covers**: Every script, handler, and config file with: purpose, arguments, exit codes, side effects, dependencies
**When to use**: You need exact details about a specific file. Answers "what exactly does X do?" questions.

### File Index

**File**: `file-index.md`
**Audience**: AI agents performing codebase searches, developers finding where something lives
**Covers**: Every file in the codebase indexed by path, responsibility, subsystem, and searchable tags
**When to use**: You need to find a file by what it does rather than where it is. Answers "where is X?" questions.

### Issues & Recommendations

**File**: `issues-and-recommendations.md`
**Audience**: Project maintainers, sprint planning
**Covers**: Identified architectural issues, gaps, inconsistencies, dead code, and specific remediation suggestions
**When to use**: Planning improvements or understanding known limitations.

## Navigation Guide

| Question | Go To |
|----------|-------|
| What is collab? | L1-architecture.md |
| How does the pipeline work? | L2-orchestrator-state-machine.md |
| How does install work? | L2-install-system.md |
| What does script X do? | L3-script-reference.md |
| Where is file Y? | file-index.md |
| What's broken? | issues-and-recommendations.md |

## Freshness

All documentation reflects the **current state** of the codebase as of the date in each file's header. Historical states are not documented — use `git log` for archaeology. See Constitution Principle V (Current State Authority).
