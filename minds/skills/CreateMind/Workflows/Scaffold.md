# Scaffold Mind Workflow

Create a new Mind in the Minds infrastructure with all required artifacts.

## Voice Notification

```bash
curl -s -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Running the Scaffold workflow in the CreateMind skill to create a new Mind"}' \
  > /dev/null 2>&1 &
```

Running the **Scaffold** workflow in the **CreateMind** skill to create a new Mind...

## Path Detection

Determine the Minds source directory before running any commands. In installed repos everything lives under `.minds/`; in the dev repo it lives under `minds/`.

```bash
if [ -d ".minds" ]; then MINDS_DIR=".minds"; else MINDS_DIR="minds"; fi
```

Use `{MINDS_DIR}` for all script paths below.

## Step 1: Gather Input

Extract from the user's request (or Linear ticket if provided):

- **Mind name** — lowercase, underscores for multi-word (e.g., `api`, `ios_verify`, `rate_limiter`)
- **Domain description** — 1-2 sentences describing what this Mind owns

If either is unclear, use AskUserQuestion to ask.

## Step 2: Validate Name

Check that the name doesn't conflict with an existing Mind:

```bash
ls {MINDS_DIR}/ | grep -w "{name}"
```

If a conflict exists, inform the user and ask for an alternative name.

## Step 3: Create Directory Structure

```bash
mkdir -p {MINDS_DIR}/{name}/lib
```

## Step 4: Scaffold MIND.md (LLM-assisted)

Create `{MINDS_DIR}/{name}/MIND.md` using this exact section structure. The LLM fills in the content based on the domain description and a codebase scan of the files this Mind will own.

**Required sections (in order):**

```markdown
# @{name} Mind Profile

## Domain

[2-3 actionable sentences describing what this Mind owns. What does it DO?]

## Conventions

[Domain-specific conventions. Reference specific functions, files, patterns.
Each convention should be a bullet starting with bold keyword.]

## Key Files

[Table or bullet list of path + description for each key file this Mind owns.
Include files that exist AND files that will be created.]

## Anti-Patterns

[What NOT to do in this domain. Each should be specific and actionable.
Format: "Doing X — instead do Y" or table format.]

## Review Focus

[Checklist items for Mind review. Each should be specific to this domain.
Reference STANDARDS.md items where applicable.
Format: numbered list of specific checks.]
```

**To fill in content:** Scan the codebase for files related to this Mind's domain. Use Grep/Glob to find relevant code patterns, naming conventions, and existing implementations. Use these observations to populate Conventions, Anti-Patterns, and Review Focus with project-specific content — not generic advice.

## Step 5: Scaffold server.ts

Create `{MINDS_DIR}/{name}/server.ts` using this template:

```typescript
/**
 * {Name} Mind — {domain description}.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    // TODO: Add intent handlers as domain logic is built
    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "{name}",
  domain: "{domain description}",
  keywords: [{LLM suggests 8-12 relevant keywords}],
  owns_files: ["{MINDS_DIR}/{name}/"],
  capabilities: [],
  exposes: [],
  consumes: [],
  handle,
});
```

**LLM-assisted fields:**
- `keywords` — Suggest 8-12 terms for fuzzy matching based on the domain
- `owns_files` — Include `{MINDS_DIR}/{name}/` plus any other paths this Mind should own
- `capabilities`, `exposes`, `consumes` — Leave empty initially; they'll be populated as lib code is built

## Step 6: Provision Memory

Run the Memory Mind's provisioning CLI:

```bash
bun {MINDS_DIR}/memory/lib/provision-cli.ts --mind {name}
```

Verify the output shows "created" (not an error).

## Step 7: Regenerate Registry

```bash
bun {MINDS_DIR}/generate-registry.ts
```

Verify `.minds/minds.json` now includes the new Mind entry.

## Step 8: Verify

Run these checks:

1. `{MINDS_DIR}/{name}/MIND.md` exists with all 5 required sections
2. `{MINDS_DIR}/{name}/server.ts` exists and exports via `createMind()`
3. `{MINDS_DIR}/{name}/memory/MEMORY.md` exists (provisioned)
4. `.minds/minds.json` contains an entry with `"name": "{name}"`
5. `{MINDS_DIR}/{name}/lib/` directory exists

## Step 9: Report

Output a summary:

```
Mind @{name} created:
  - {MINDS_DIR}/{name}/MIND.md — domain profile
  - {MINDS_DIR}/{name}/server.ts — MCP server
  - {MINDS_DIR}/{name}/lib/ — domain logic (empty, ready for code)
  - {MINDS_DIR}/{name}/memory/MEMORY.md — memory provisioned
  - .minds/minds.json — registry updated

Next steps:
  - Add domain logic in {MINDS_DIR}/{name}/lib/
  - Update server.ts capabilities/exposes/consumes as code is added
  - Add unit tests alongside lib code
```
