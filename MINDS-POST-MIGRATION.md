# Minds Post-Migration Task List

Status: All 24 migration tickets complete on `minds/main`. These tasks wire the new architecture into production.

---

## Phase 1: Path References (pre-merge, on minds/main)

### PM-1: Update stale import paths in code that references old locations

Two categories:

**A. Import statements (33 references across 35 files):**
- `tests/` — 29 test files with imports from `src/scripts/orchestrator/`, `src/lib/pipeline/`, `src/scripts/`
- `minds/coordination/` — 4 files still import from `../../src/lib/pipeline` (barrel)
- `minds/transport/TmuxTransport.ts` — hardcoded path to `src/lib/pipeline/tmux-client.ts`
- `minds/transport/status-derive.ts` — comment referencing old path
- `cli/src/commands/repo.ts` — imports from `src/lib/pipeline/repo-registry.ts`

**B. Non-import path references (runtime paths, config, comments):**
- `package.json` — test script references `src/scripts/orchestrator/` (now empty)
- `cli/scripts/bundle-templates.ts` — 3 copy-from paths (`src/scripts/orchestrator`, `src/scripts/`, `src/lib/pipeline`)
- `minds/installer/collab-install.ts` — 3 path constructions referencing `src/handlers`, `src/scripts/orchestrator`, `src/scripts`
- `minds/execution/resolve-feature.ts` — doc comment with old path

**Action:** Update all references to use `minds/` paths. Category B (bundle-templates, installer) needs special care — these construct runtime paths for distribution, not just imports. Run `bun test` after.

### PM-2: Sync template copies with moved originals

`minds/templates/` contains stale copies that are distributed to repos on install:
- `minds/templates/orchestrator/` — 17 files (copies of pre-move orchestrator scripts)
- `minds/templates/scripts/` — 4 files (copies of pre-move src/scripts/)
- `minds/templates/lib-pipeline/` — 16 files (copies of pre-move src/lib/pipeline/)
- `minds/templates/commands/collab.install.ts` — references old paths

These are **distribution templates** (what `collab install` copies to target repos). They need to either:
- (a) Point to the canonical `minds/` locations, OR
- (b) Be updated so the installed copies work standalone in target repos

**Action:** Audit each template dir. Templates that are standalone copies (installed into `.collab/`) may be correct as-is. Templates that import from `src/` need path fixes.

### PM-3: Remove barrel stubs in src/lib/pipeline/

14 files in `src/lib/pipeline/` — 12 are barrel re-exports (e.g., `index.ts` re-exports from `minds/pipeline_core/`), 1 is `utils.ts` (barrel), 1 is `utils.test.ts`. These exist for backward compatibility during migration.

After PM-1 updates all 33 import references + the 29 test files, these barrels become dead code.

**Action:** After PM-1 eliminates all importers, delete the 14 files and the `src/lib/pipeline/` directory. Run `bun test` to confirm nothing still depends on them.

### PM-4: Clean up empty old directories — DONE

All old directories already removed by migration:
- ~~`src/scripts/orchestrator/`~~ — gone
- ~~`src/scripts/`~~ — gone
- ~~`src/handlers/`~~ — gone
- ~~`src/hooks/`~~ — gone
- ~~`src/cli/`~~ — gone
- ~~`transport/`~~ — gone (now `minds/transport/`)

Only `src/lib/pipeline/` remains (14 barrel stubs, handled by PM-3).

---

## Phase 2: MCP Integration (on minds/main, before merge)

### PM-5: Register Router Mind as MCP server

Add Router Mind to Claude Code's MCP config so `mcp__collab__handle` tool is available.

**Action:** Add to project `.claude/settings.json` or `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "collab": {
      "command": "bun",
      "args": ["minds/router/server.ts"],
      "cwd": "/Users/atlas/Code/projects/collab"
    }
  }
}
```

Test: restart Claude Code, verify `mcp__collab__handle` and `mcp__collab__describe` tools appear.

### PM-6: Update docs with new paths

9 markdown files reference old `src/scripts/orchestrator/` paths:
- `MINDS-IMPLEMENTATION-PLAN.md` — historical, can leave as-is
- `DOMAIN-DECOMPOSITION.md` — historical, can leave as-is
- `docs/file-index.md` — needs updating
- `docs/L3-script-reference.md` — needs updating
- `docs/L1-architecture.md` — needs updating
- `docs/L2-orchestrator-state-machine.md` — needs updating
- `docs/e2e-runbooks/knowledge-base.md` — needs updating
- `docs/issues-and-recommendations.md` — needs updating
- `docs/BRE-231-review.md` — historical, can leave as-is

**Action:** Update the 5 active docs. Leave 4 historical docs as-is (they document past decisions).

---

## Phase 3: Validate

### PM-7: E2E pipeline validation

Run a real pipeline to validate the full flow works through the new file layout.

**Action:**
1. Pick a test ticket or create one
2. Run `/collab.run` end-to-end
3. Verify: specify → plan → tasks → implement → blindqa → complete
4. Confirm all scripts execute from `minds/` paths
5. Confirm orchestrator signals work through new file locations

---

## Phase 4: Optional Enhancements

### PM-8: Merge minds/main to dev (when ready)

Not needed immediately. `dev` still works via barrel stubs. Merge when you want `dev` to use the new layout directly.

**Action:** `git checkout dev && git merge minds/main`

### PM-9: Replace CROSS-MIND direct imports with Router escalation

Currently ~88 authorized `// CROSS-MIND` annotations exist where Minds import directly from sibling Minds. The clean architecture would route these through the Router Mind via `handle()` calls.

**Trade-off:** Adds latency (MCP round-trip per call) vs architectural purity. May not be worth it for hot-path calls like `registryPath()`.

**Decision needed:** Which CROSS-MIND imports to convert vs which to keep as authorized exceptions.

### PM-10: cli/src/ consolidation

4 files remain in `cli/src/commands/` (`status.ts`, `init.ts`, `repo.ts`, `update.ts`). These are the npm package entry point's commands. They may belong in `minds/cli/` or may need to stay for the npm package build.

**Action:** Audit whether these can move to `minds/cli/` or need to stay for the npm package.

---

## Summary

| Phase | Tickets | Effort | Status |
|-------|---------|--------|--------|
| 1: Path References | PM-1, PM-2, PM-3 (PM-4 done) | Medium | Needed before E2E or merge |
| 2: MCP Integration | PM-5, PM-6 | Low | PM-5 needed to use Router Mind |
| 3: Validate | PM-7 | Low | Confidence gate |
| 4: Optional | PM-8, PM-9, PM-10 | Medium | Whenever ready |
