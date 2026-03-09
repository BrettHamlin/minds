# Fission Mind — Design Specification

## Overview

Fission is a Mind that analyzes a target codebase's dependency graph, identifies natural domain boundaries, and scaffolds domain-specific Minds to own each section — achieving near-100% file coverage.

**One-time operation.** Run once per codebase after `minds init`. Not continuous.

## Key Concepts

### Foundation Mind

Hub files (high fan-in: config, utils, types, runtime globals) that are imported by many domains but don't belong to any single one. Fission extracts these into a dedicated **Foundation Mind** that:
- Owns all cross-cutting hub files
- Exposes shared interfaces that domain Minds consume
- Is the only Mind that other Minds are allowed to depend on universally

### Domain Minds

Each cluster of tightly-coupled files becomes a Domain Mind with:
- Clear file ownership (`owns_files`)
- Named responsibilities (`domain`)
- Declared dependencies on Foundation Mind and optionally on other Domain Minds via contracts (`consumes`/`exposes`)

### Non-overlapping boundaries

Every source file in the target codebase is assigned to exactly one Mind. No file belongs to two Minds. Test files are assigned to the Mind that owns their corresponding source files.

## Pipeline

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────┐
│  1. Extract  │───▶│  2. Detect   │───▶│  3. Cluster │───▶│  4. Name     │───▶│ 5. Scaffold│
│  Import Graph│    │  Hubs        │    │  (Leiden)   │    │  (LLM)       │    │  Minds     │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘    └──────────┘
   DETERMINISTIC      DETERMINISTIC      DETERMINISTIC      LLM JUDGMENT      DETERMINISTIC
```

### Stage 1: Extract Import Graph

**Input:** Target directory path, language identifier
**Output:** `{ nodes: string[], edges: { from: string, to: string, weight: number }[] }`

Per-language extractors parse import/require/include statements and resolve them to file paths.

**Supported languages (initial):**
- TypeScript/JavaScript — `import`/`require`/`export` statements, tsconfig path aliases, `.js` extension resolution, barrel `index.ts` re-exports

**Future:**
- Go — `import` statements, module paths
- Python — `import`/`from...import`, package `__init__.py`
- Swift — `import` statements, SPM module boundaries
- Rust — `use`/`mod` statements, crate structure

**Architecture:** Each extractor implements `Extractor` interface:
```typescript
interface Extractor {
  language: string;
  extensions: string[];  // e.g. ['.ts', '.tsx', '.js', '.jsx']
  extract(rootDir: string): Promise<DependencyGraph>;
}

interface DependencyGraph {
  nodes: string[];           // relative file paths
  edges: GraphEdge[];        // directed edges (importer → imported)
}

interface GraphEdge {
  from: string;
  to: string;
  weight: number;  // number of symbols imported (1 if unknown)
}
```

**Exclusions:** `node_modules/`, `dist/`, `build/`, `.git/`, vendored directories, generated files (detected by `@generated` markers).

### Stage 2: Detect Hubs → Foundation Mind

**Input:** `DependencyGraph`
**Output:** `{ foundation: FoundationMind, remaining: DependencyGraph }`

Algorithm:
1. Compute fan-in for every node
2. Compute 95th percentile threshold (configurable via `--hub-threshold`)
3. Extract nodes with fan-in > threshold into Foundation Mind
4. Remove Foundation nodes and their edges from the graph
5. Return remaining graph for clustering

```typescript
interface FoundationMind {
  files: string[];
  metrics: { file: string, fanIn: number, fanOut: number }[];
}
```

**Edge case:** If a hub file logically belongs to a domain (e.g., `agents/types.ts` is heavily imported but clearly belongs to agents), the LLM layer in Stage 4 can recommend reassignment.

### Stage 3: Cluster (Leiden Algorithm)

**Input:** Hub-filtered `DependencyGraph`
**Output:** `ClusterAssignment[]`

Implements the Leiden community detection algorithm:
1. Start with each node in its own community
2. Move nodes to neighboring communities to maximize modularity
3. Refine communities to ensure well-connectedness (Leiden's key improvement over Louvain)
4. Aggregate the graph and repeat

```typescript
interface ClusterAssignment {
  clusterId: number;
  files: string[];
  internalEdges: number;   // edges within this cluster
  externalEdges: number;   // edges to other clusters
  cohesion: number;        // internalEdges / totalEdges for this cluster
}
```

**Resolution parameter:** Controls cluster granularity. Lower = fewer larger clusters, higher = more smaller clusters. Default: 1.0. Exposed via `--resolution` CLI flag.

**Modularity score:** Computed and reported. Q > 0.3 indicates meaningful community structure. Q > 0.5 indicates strong structure.

### Stage 4: Name and Validate (LLM)

**Input:** Cluster assignments with file lists
**Output:** `ProposedMindMap`

The only non-deterministic stage. Uses LLM inference to:
1. **Name each cluster** — short, lowercase, hyphenated Mind name (e.g., `auth`, `messaging`, `data-access`)
2. **Describe responsibilities** — 1-2 sentence domain description for MIND.md
3. **Generate keywords** — for intent routing
4. **Identify contracts** — which Minds expose/consume from which others
5. **Flag issues:**
   - Files that appear misplaced (belong to a different cluster based on semantics)
   - Clusters that are too large and should be split (>500 files)
   - Clusters that are too small and could merge (<5 files)
   - Hub files that might belong to a domain rather than Foundation

```typescript
interface ProposedMindMap {
  foundation: {
    name: "foundation";
    files: string[];
    domain: string;
    exposes: string[];
  };
  minds: ProposedMind[];
  recommendations: Recommendation[];
  couplingMatrix: { from: string, to: string, edges: number }[];
}

interface ProposedMind {
  name: string;
  domain: string;
  keywords: string[];
  files: string[];
  owns_files: string[];  // glob patterns for MindDescription
  exposes: string[];
  consumes: string[];
  fileCount: number;
  cohesion: number;
}

interface Recommendation {
  type: "split" | "merge" | "reassign" | "review";
  target: string;       // Mind name or file path
  reason: string;
  suggestion: string;
}
```

### Stage 5: Scaffold Minds

**Input:** Approved `ProposedMindMap`
**Output:** Scaffolded Mind directories via `@instantiate`

For each Mind in the approved map:
1. Call `scaffoldMind(name, domain)` from `minds/instantiate/lib/scaffold.ts`
2. Populate `owns_files` with the file patterns from the map
3. Populate `exposes`/`consumes` contracts
4. Generate MIND.md with domain-specific content (key files, conventions, anti-patterns)

The Foundation Mind gets additional content in its MIND.md:
- List of all hub files it owns
- Warning that changes to Foundation files affect all domain Minds
- Review focus on backward compatibility

## CLI Interface

```bash
# Run Fission analysis on target codebase
minds fission [target-dir] [options]

Options:
  --language <lang>       Language to analyze (default: auto-detect)
  --hub-threshold <n>     Fan-in percentile for hub detection (default: 95)
  --resolution <n>        Leiden resolution parameter (default: 1.0)
  --output <path>         Write proposed map JSON to file
  --dry-run               Show proposed map without scaffolding
  --yes                   Skip approval prompt
```

**Default flow:**
1. Analyze target directory (or cwd if not specified)
2. Display proposed Mind map in terminal:
   - Foundation Mind: file count, top hub files
   - Each Domain Mind: name, file count, responsibilities, key files
   - Coupling matrix between Minds
   - Recommendations
3. Prompt for approval: "Scaffold N Minds? [y/N]"
4. On approval: scaffold all Minds

## File Layout

```
minds/fission/
  DESIGN.md            # This file
  MIND.md              # Mind profile
  server.ts            # Mind server entry point
  lib/
    pipeline.ts        # Orchestrates the full pipeline
    types.ts           # Shared types (DependencyGraph, ClusterAssignment, etc.)
  extractors/
    typescript.ts      # TS/JS import graph extractor
    extractor.ts       # Extractor interface
  analysis/
    hubs.ts            # Hub detection and Foundation extraction
    leiden.ts          # Leiden clustering algorithm
    metrics.ts         # Graph metrics (modularity, cohesion, coupling)
  naming/
    naming.ts          # LLM naming and validation
    prompts.ts         # Prompt templates for LLM
```

## Integration Points

- **`@instantiate` Mind** — Fission calls `scaffoldMind()` to create each Mind
- **`minds init` CLI** — Fission is available as a post-init command
- **`minds.json`** — All scaffolded Minds are registered here
- **`MIND.md`** — Each scaffolded Mind gets a domain-specific MIND.md

## PoC Validation (OpenClaw)

The approach was validated against OpenClaw (8,071 files, TypeScript):
- **Import extraction:** 20,199 edges from 5,552 files
- **Hub detection:** `config.ts` (1,146 fan-in), `runtime.ts` (343), `utils.ts` (228) correctly identified
- **Clustering:** Greedy algorithm found 4 sensible super-modules from 53 directories (Q improved from 0.4329 to 0.4920)
- **Extension boundary:** Correctly identified as one-directional (484 edges in vs 38 out)
- **Key learning:** Hub filtering is critical — `config.ts` alone contributes 1,146 cross-boundary edges that distort clustering

## Open Questions

1. **Auto-detection:** How to detect the primary language of a codebase? Count file extensions? Read package.json/go.mod/Cargo.toml?
2. **Multi-language repos:** Should Fission merge graphs from multiple extractors, or partition by language first?
3. **Monorepo handling:** Should top-level packages/workspaces be treated as pre-defined boundaries?
4. **Mind size limits:** What's the ideal file count per Mind? Too large = too much responsibility. Too small = too many Minds with thin contracts.
