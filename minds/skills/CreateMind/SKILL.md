---
name: CreateMind
description: Scaffold new Minds into the Minds infrastructure. USE WHEN create mind, new mind, scaffold mind, add mind, add a new mind to the system. Deterministic scaffolding with LLM-assisted domain profiling.
---

# CreateMind

Scaffolds a new Mind into the Minds infrastructure. Creates directory structure, MIND.md, server.ts, provisions memory, and registers in minds.json.

## Customization

**Before executing, check for user customizations at:**
`~/.claude/skills/PAI/USER/SKILLCUSTOMIZATIONS/CreateMind/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Scaffold** | "create mind", "new mind", "scaffold mind" | `Workflows/Scaffold.md` |

## Examples

**Example 1: Create a new domain Mind**
```
User: "Create a mind for API routes and middleware"
-> Invokes Scaffold workflow
-> Creates {MINDS_DIR}/api/ with MIND.md, server.ts, lib/
-> LLM fills in conventions, anti-patterns, review focus
-> Provisions memory via Memory Mind CLI
-> Regenerates minds.json
```

**Example 2: Create a Mind from a Linear ticket**
```
User: "/CreateMind linear ticket BRE-451"
-> Reads ticket for domain description
-> Invokes Scaffold workflow with ticket context
-> Scaffolds full Mind structure
```

**Example 3: Create a verification Mind**
```
User: "Create a mind for iOS verification"
-> Invokes Scaffold workflow
-> Creates {MINDS_DIR}/ios_verify/ with domain-specific profile
-> Sets owns_files to relevant test/verify paths
-> Provisions memory, registers in minds.json
```

## Quick Reference

**Minds location:** `{MINDS_DIR}/{name}/` (`.minds/` in installed repos, `minds/` in dev repo)
**Registry:** `.minds/minds.json`
**Memory provisioning:** `bun {MINDS_DIR}/memory/lib/provision-cli.ts --mind {name}`
**Registry generation:** `bun {MINDS_DIR}/generate-registry.ts`
