---
name: Fission
description: Codebase partitioning and Mind scaffolding. USE WHEN fission, partition codebase, create minds from codebase, analyze codebase structure, split codebase into minds, domain discovery, map codebase.
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/skills/PAI/USER/SKILLCUSTOMIZATIONS/Fission/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

## Fission

Fission analyzes a target codebase's dependency graph, identifies natural domain boundaries, and scaffolds domain-specific Minds -- achieving near-100% file coverage.

**One-time operation.** Run once per codebase after `minds init`.

## Key Concepts

- **Foundation Mind** -- Hub files (config, utils, types) that are imported across many domains. Gets its own Mind.
- **Domain Minds** -- Clusters of tightly-coupled files, each becoming a Mind with clear file ownership and responsibilities.
- **Non-overlapping boundaries** -- Every file belongs to exactly one Mind.

## Pipeline

1. **Extract** (deterministic) -- Parse imports, build dependency graph
2. **Detect Hubs** (deterministic) -- Identify cross-cutting files -> Foundation Mind
3. **Cluster** (deterministic) -- Leiden community detection algorithm
4. **Name** (LLM) -- Name clusters, describe responsibilities, identify contracts
5. **Scaffold** (deterministic) -- Create Mind directories via @instantiate

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "analyze codebase", "partition", "fission", "map codebase" | `Workflows/Analyze.md` |
| "scaffold minds", "create minds from analysis" | `Workflows/Scaffold.md` |

## Quick Reference

- **Engine location:** `minds/fission/` (pipeline, extractors, analysis, naming)
- **CLI:** `bun minds/cli/bin/minds.ts fission [target-dir] [options]`
- **Core files:** `lib/pipeline.ts` (orchestrator), `extractors/typescript.ts` (import graph), `analysis/leiden.ts` (clustering), `lib/scaffold-minds.ts` (scaffolding)
- **Design doc:** `minds/fission/DESIGN.md`
