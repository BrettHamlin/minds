# Analyze Workflow

## Trigger

User wants to analyze a codebase and identify domain boundaries for Mind creation.

## Steps

### 1. Identify Target

- Determine the target codebase directory from the user's request
- If not specified, ask which directory to analyze
- Verify the directory exists and contains source files

### 2. Run the Pipeline

Execute the Fission pipeline via CLI:

```bash
bun minds/cli/bin/minds.ts fission <target-dir> --dry-run --offline
```

This runs:
- Import graph extraction (finds all imports/requires)
- Hub detection (identifies cross-cutting files at >95th percentile fan-in)
- Leiden clustering (community detection on the dependency graph)
- Offline naming (directory-based, deterministic)

### 3. Review Results

Present the pipeline output to the user showing:
- **Foundation Mind**: hub files and their fan-in metrics
- **Domain Minds**: each cluster with file count, cohesion score, and primary directories
- **Coupling matrix**: dependencies between proposed Minds
- **Recommendations**: any suggested splits, merges, or reassignments

### 4. LLM Naming Enhancement

For each cluster, provide better names than the offline defaults:
- Analyze the file paths and directory names in each cluster
- Propose a meaningful Mind name (lowercase, hyphenated, 2-20 chars)
- Write a 1-2 sentence domain description
- Identify what the Mind exposes and consumes (its contracts)

Present the enhanced proposed map to the user in a clear table format.

### 5. User Approval

Ask the user to review and approve the proposed Mind map. They may want to:
- Rename Minds
- Move files between Minds
- Split large clusters
- Merge small clusters
- Adjust the Foundation Mind contents

Iterate until the user approves.

### 6. Scaffold (on approval)

Once approved, scaffold all Minds:

```bash
bun minds/cli/bin/minds.ts fission <target-dir> --yes --offline
```

Or call the scaffolding programmatically for each approved Mind using the `@instantiate` Mind's `scaffoldMind()` function.

### 7. Report Results

Show what was created:
- List of all scaffolded Minds with their directories
- Foundation Mind with its hub files
- Remind user to review each Mind's MIND.md and customize

## CLI Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--language <lang>` | Language to analyze | auto-detect |
| `--hub-threshold <n>` | Fan-in percentile for hubs | 95 |
| `--resolution <n>` | Leiden resolution (lower = fewer larger clusters) | adaptive |
| `--min-cluster-size <n>` | Minimum files per cluster | adaptive |
| `--dry-run` | Show results without scaffolding | false |
| `--offline` | Deterministic naming only | false |
| `--output <path>` | Write JSON results to file | none |
