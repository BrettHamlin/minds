---
description: Analyze a codebase, discover domain boundaries, name Minds, and scaffold the registry. Runs Fission inside Claude Code so naming uses your intelligence directly — no SDK needed.
---

> **IMPORTANT:** Execute these steps directly and sequentially. Do NOT wrap this workflow in PAI Algorithm phases, ISC criteria, capability selection, or any other meta-framework. Follow the numbered steps exactly as written.

## Path Detection

Determine the Minds source directory before running any commands. In the dev repo (has `minds/cli/`), use `minds/`. In installed repos, use `.minds/`.

```bash
if [ -d "minds/cli" ]; then MINDS_DIR="minds"; else MINDS_DIR=".minds"; fi
```

## User Input

```text
$ARGUMENTS
```

If the user provided a target directory, use it. Otherwise use the current working directory (`.`).

## Step 1: Run the Fission pipeline

Run the deterministic analysis pipeline. This extracts the dependency graph, detects hub files, clusters with Leiden, and outputs structured JSON. All the heavy lifting is deterministic code — no LLM needed for this step.

```bash
bun ${MINDS_DIR}/fission/run-pipeline.ts [TARGET_DIR]
```

Save the JSON output. If the pipeline fails or finds no source files, report the error and stop.

## Step 2: Name the clusters

Read the pipeline output. For each cluster, you will see:
- `clusterId` — numeric ID
- `filenames` — representative file basenames
- `directories` — distribution of files across directories (dir → count)
- `fileCount` — total files in cluster
- `cohesion` — internal coupling score
- `externalEdges` — edges to files outside the cluster

**For each cluster, determine:**

1. **name** — A lowercase, hyphenated identifier (2-20 chars). Derive from what the code *does*, not where it lives. Examples: `auth`, `data-access`, `billing`, `api-gateway`.

2. **domain** — 1-2 sentence description of responsibilities. Be specific about what this cluster manages.

3. **keywords** — 3-8 keywords for intent routing (what questions/tasks this Mind handles).

4. **exposes** — Capabilities this Mind provides to others (e.g., "user authentication", "payment processing").

5. **consumes** — Capabilities this Mind needs from others (e.g., "database access", "configuration").

### Naming rules
- Look at directory names and filenames to understand the domain
- Avoid generic names like `utils`, `helpers`, `core` — find the *purpose*
- If a cluster spans multiple directories, find the unifying theme
- Names must be unique across all clusters
- Foundation files (high fan-in shared code) are handled separately — don't name those

### Output your naming as JSON

Write the naming results to a temporary file:

```bash
cat > /tmp/fission-naming.json << 'NAMING_EOF'
[
  {
    "clusterId": 0,
    "name": "your-name",
    "domain": "Your domain description.",
    "keywords": ["keyword1", "keyword2"],
    "exposes": ["capability1"],
    "consumes": ["capability2"]
  }
]
NAMING_EOF
```

## Step 3: Review recommendations

Look at the pipeline output for potential issues:

- **Clusters with >500 files** — too large, recommend splitting (run with higher resolution)
- **Clusters with <5 files** — too small, recommend merging with a related Mind
- **High coupling between two clusters (>50 edges)** — they may belong together

Report any recommendations to the user.

## Step 4: Scaffold the Minds

Run the scaffolding script with both the pipeline output and your naming:

```bash
bun ${MINDS_DIR}/fission/scaffold-from-naming.ts /tmp/fission-naming.json [TARGET_DIR]
```

This will:
- Create a Mind directory for each named cluster (with MIND.md and server.ts)
- Create the foundation Mind for hub files
- Generate/update `minds.json` registry
- Report what was created

## Step 5: Report

Output a summary:
- Total files analyzed
- Number of Minds created (list each with name, file count, domain)
- Foundation files identified
- Coupling between Minds (top 5 pairs)
- Any recommendations (splits, merges)
- Path to the generated `minds.json`

The user can now run `/minds.tasks TICKET-ID` to generate tasks scoped to these Minds.
