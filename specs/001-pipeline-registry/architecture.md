# Pipeline Registry Architecture

**Ticket:** BRE-357
**Status:** Authoritative reference
**Implementation:** BRE-366 (`src/cli/`)

This document is the authoritative design spec for the collab pipeline registry system. It covers the core/pipeline boundary, manifest schema, registry structure, state/lockfile formats, CLI dependency deduplication, and versioning strategy.

---

## 1. Core vs Pipeline Boundary

### Core (ships in every collab install)

The core install provides the package management CLI and orchestration infrastructure. Nothing domain-specific lives here.

**CLI commands (always available):**
- `collab pipelines` / `collab pipelines browse` — query the registry index
- `collab pipelines install <name>` — install a pipeline or pack and all transitive deps
- `collab pipelines list` — list what is installed
- `collab pipelines update [name]` — check for and apply updates
- `collab pipelines remove <name>` — uninstall a pipeline
- `collab pipeline init` — scaffold a `pipeline.json` for authors
- `collab pipeline validate` — validate a `pipeline.json` against the schema

**Scripts and infrastructure:**
- `.collab/scripts/` — orchestration bash scripts (phase-dispatch, signal-validate, etc.)
- `.claude/skills/PAI/` — DA skill system
- `src/cli/lib/` — registry fetching, dependency resolution, integrity checking, state/lockfile management

**Core does NOT include:**
- Any Claude command files (`.md` prompts) except the core orchestration commands
- Domain-specific workflows (specify, plan, implement, blindqa, etc.)
- Those are distributed as pipeline packages and installed on demand

### Pipeline Packages (installed from registry)

Everything that adds workflow commands lives in pipeline packages:

| Package | Type | Contents |
|---------|------|----------|
| `specify` | pipeline | `commands/collab.specify.md` |
| `plan` | pipeline | `commands/collab.plan.md` |
| `implement` | pipeline | `commands/collab.implement.md` |
| `blindqa` | pipeline | `commands/collab.blindqa.md` |
| `full-workflow` | pack | Bundles specify + plan + implement + blindqa |

**Pipeline packages are the extension point.** New workflows ship as new packages, not as changes to core.

---

## 2. pipeline.json Manifest Schema

Each pipeline or pack ships a `pipeline.json` at its package root. This is the contract between the package author and the installer.

### PipelineManifest (type: "pipeline")

```typescript
interface PipelineManifest {
  name: string;           // Package name, e.g. "specify"
  type: "pipeline";       // Discriminator
  version: string;        // Semver: "1.0.0"
  description: string;    // Human-readable summary
  author?: string;        // Optional author name
  repository?: string;    // Optional source URL
  dependencies?: PipelineDependency[];    // Other pipelines/packs required
  cliDependencies?: CliDependency[];      // External CLI tools required
  commands?: string[];    // Paths relative to package root, e.g. ["commands/collab.specify.md"]
  checksum?: string;      // SHA-256 of the tarball (omit to skip verification)
}
```

### PackManifest (type: "pack")

Extends `PipelineManifest` with one additional required field:

```typescript
interface PackManifest extends PipelineManifest {
  type: "pack";
  pipelines: string[];    // Names of all pipelines bundled in this pack
}
```

A pack groups multiple pipelines for convenient installation. The `pipelines` array must be non-empty. Installing a pack installs all named pipelines (via the dependency resolver).

### PipelineDependency

```typescript
interface PipelineDependency {
  name: string;       // Name of the required pipeline/pack
  version: string;    // Semver range: ">=1.0.0", "^2.3.0", "1.0.0"
}
```

Dependencies are resolved recursively. Circular dependencies are detected and raise `CIRCULAR_DEPENDENCY`. Version conflicts raise `MISSING_DEPENDENCY`.

### CliDependency

```typescript
interface CliDependency {
  name: string;           // CLI tool name: "bun", "jq", "git", "gh", "tmux", "docker", "node"
  version: string;        // Required semver range: ">=1.0.0"
  required: boolean;      // If true, install fails when this CLI is missing/incompatible
  installHint?: string;   // User-facing install instruction
}
```

Known CLIs with automatic version detection: `bun`, `node`, `jq`, `git`, `gh`, `tmux`, `docker`. Unknown CLIs fall back to a generic `--version` / `-version` / `version` probe. If the version string cannot be extracted, status is `unknown-version` (non-blocking even when `required: true`).

### Field semantics

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Must be a lowercase identifier matching the registry entry name |
| `type` | Yes | `"pipeline"` or `"pack"` — determines validation rules |
| `version` | Yes | Must be valid semver (e.g. `"1.0.0"`) |
| `description` | Yes | Non-empty string |
| `author` | No | Free-form attribution |
| `repository` | No | Source URL for author tooling / auditing |
| `dependencies` | No | Default: `[]`. Resolved transitively by installer |
| `cliDependencies` | No | Default: `[]`. Checked before any tarballs are downloaded |
| `commands` | No | Default: `[]`. Paths relative to package root. Copied to `.claude/commands/` on install |
| `checksum` | No | SHA-256 hex of the tarball. When present, installer verifies integrity before extracting. When absent, skip verification (development / testing use) |
| `pipelines` | Pack only | Required and non-empty for `type: "pack"`. Absent on plain pipelines |

### Example: pipeline

```json
{
  "name": "specify",
  "type": "pipeline",
  "version": "1.2.0",
  "description": "AI-powered specification creation workflow",
  "author": "Collab Team",
  "repository": "https://github.com/BrettHamlin/collab-pipelines-official",
  "dependencies": [],
  "cliDependencies": [
    {
      "name": "bun",
      "version": ">=1.0.0",
      "required": true,
      "installHint": "curl -fsSL https://bun.sh/install | bash"
    }
  ],
  "commands": ["commands/collab.specify.md"],
  "checksum": "sha256:abc123..."
}
```

### Example: pack

```json
{
  "name": "full-workflow",
  "type": "pack",
  "version": "2.0.0",
  "description": "Full collab workflow: specify + plan + implement + blindqa",
  "pipelines": ["specify", "plan", "implement", "blindqa"],
  "dependencies": [
    { "name": "specify", "version": ">=1.2.0" },
    { "name": "plan", "version": ">=1.1.0" },
    { "name": "implement", "version": ">=1.0.0" },
    { "name": "blindqa", "version": ">=1.0.0" }
  ],
  "cliDependencies": [],
  "commands": []
}
```

---

## 3. Registry Repository Folder Structure

The official registry lives at `github.com/BrettHamlin/collab-pipelines-official`. Each release publishes `registry.json` and per-pipeline tarballs as GitHub Release assets.

### Repository layout

```
collab-pipelines-official/
├── registry.json                     # Index (published as Release asset)
├── pipelines/
│   ├── specify/
│   │   ├── pipeline.json             # Manifest source
│   │   ├── commands/
│   │   │   └── collab.specify.md     # Claude command file
│   │   └── CHANGELOG.md
│   ├── plan/
│   │   ├── pipeline.json
│   │   ├── commands/
│   │   │   └── collab.plan.md
│   │   └── CHANGELOG.md
│   ├── implement/
│   │   └── ...
│   └── blindqa/
│       └── ...
└── packs/
    └── full-workflow/
        ├── pipeline.json             # type: "pack"
        └── CHANGELOG.md
```

### Tarball structure

Each pipeline is released as a versioned tarball:

```
specify-1.2.0.tar.gz
└── specify-1.2.0/                    # Top-level directory
    ├── pipeline.json
    └── commands/
        └── collab.specify.md
```

The top-level directory is always `{name}-{version}/`. The installer always extracts with `--strip-components=1`, so files land directly in the pipeline's install directory (`.collab/pipelines/{name}/`).

### Release asset URLs

```
# Registry index
https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/registry.json

# Per-pipeline manifest
https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/pipelines/specify/pipeline.json

# Tarball
https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/pipelines/specify/specify-1.2.0.tar.gz
```

Using `releases/latest/download/` (not `raw.githubusercontent.com`) ensures URLs reference a pinned, versioned release rather than mutable git content.

---

## 4. registry.json Index Format

The registry index is the entry point for the installer and browser. It describes all available packages but does not embed manifest details.

### RegistryIndex

```typescript
interface RegistryIndex {
  version: string;       // Registry schema version, currently "1"
  updatedAt: string;     // ISO-8601 timestamp of last publish
  packs: RegistryEntry[];
  pipelines: RegistryEntry[];
}
```

### RegistryEntry

```typescript
interface RegistryEntry {
  name: string;           // Package name
  description: string;    // Short description for browse display
  latestVersion: string;  // Latest available semver version
  manifestUrl: string;    // Full URL to fetch pipeline.json for this package
  tarballUrl: string;     // Full URL to fetch the tarball
}
```

Both `packs` and `pipelines` arrays are present even when empty. The installer calls `findEntry(registry, name)` which searches both arrays — packs and pipelines are installed by the same flow.

### Example registry.json

```json
{
  "version": "1",
  "updatedAt": "2026-03-01T00:00:00.000Z",
  "packs": [
    {
      "name": "full-workflow",
      "description": "Full collab workflow: specify + plan + implement + blindqa",
      "latestVersion": "2.0.0",
      "manifestUrl": "https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/packs/full-workflow/pipeline.json",
      "tarballUrl": "https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/packs/full-workflow/full-workflow-2.0.0.tar.gz"
    }
  ],
  "pipelines": [
    {
      "name": "specify",
      "description": "AI-powered specification creation workflow",
      "latestVersion": "1.2.0",
      "manifestUrl": "https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/pipelines/specify/pipeline.json",
      "tarballUrl": "https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/pipelines/specify/specify-1.2.0.tar.gz"
    },
    {
      "name": "plan",
      "description": "AI-powered implementation planning workflow",
      "latestVersion": "1.1.0",
      "manifestUrl": "https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/pipelines/plan/pipeline.json",
      "tarballUrl": "https://github.com/BrettHamlin/collab-pipelines-official/releases/latest/download/pipelines/plan/plan-1.1.0.tar.gz"
    }
  ]
}
```

### Validation rules (enforced by `parseRegistryIndex`)

- Root must be a JSON object (not array or null)
- `version` field must be a string (currently "1")
- `pipelines` and `packs` must be arrays
- Every entry must have: `name`, `description`, `latestVersion`, `manifestUrl`, `tarballUrl` — all strings
- Missing or malformed entries throw `REGISTRY_INVALID`

---

## 5. CLI Dependency Deduplication Strategy

When multiple pipelines in a dependency tree all require the same external CLI tool (e.g., `bun`), the installer deduplicates before running the check, then records the result in state.

### Deduplication at check time

`collectCliDeps(resolved)` in `resolver.ts` iterates all resolved manifests and builds a `Map<name, dep>`:

1. First occurrence of a CLI name is stored as-is (version range from that manifest)
2. Subsequent occurrences with the same name: if any pipeline marks it `required: true`, the merged entry is `required: true`
3. Version range: first-wins (the version range from the first manifest that listed the CLI)

This means if `specify` requires `bun >= 1.0.0` and `plan` requires `bun >= 1.1.0`, the resolved check uses `>= 1.0.0` (first-wins). Authors should coordinate ranges via the registry, not rely on resolution order.

`checkAllClis(deps)` in `cli-resolver.ts` runs the same deduplication before executing the system checks:

```
deps from collectCliDeps
    → deduplicateDeps (merge required flags, first-wins version range)
    → checkCli for each unique CLI (execSync to probe version)
    → results[]
```

`getBlockingClis(results)` filters to entries where `required: true` AND `status` is `"missing"` or `"too-old"`. If any blocking CLIs remain, install exits 1.

### State tracking for installed CLIs

`installed-pipelines.json` records which pipelines required each CLI:

```json
{
  "clis": {
    "bun": {
      "name": "bun",
      "version": "1.2.3",
      "installedAt": "2026-03-01T00:00:00.000Z",
      "requiredBy": ["specify", "plan"]
    }
  }
}
```

`addCli(state, cli)` merges `requiredBy` arrays using set union — if `specify` and `plan` both required `bun`, both names appear in the `requiredBy` array. `removePipelineFromClis(state, pipelineName)` removes the pipeline from all CLI `requiredBy` lists on uninstall.

**No orphan removal yet:** The current implementation does not automatically remove a CLI record when its `requiredBy` list becomes empty. This is intentional — CLI tools are installed by the user, not by collab. Collab only tracks them for reporting, not lifecycle management.

---

## 6. Versioning and Update Strategy

### Version pinning

Installations are version-pinned via the lockfile. After `collab pipelines install specify`, the lockfile records:

```json
{
  "lockfileVersion": 1,
  "generatedAt": "2026-03-01T00:00:00.000Z",
  "pipelines": {
    "specify": {
      "name": "specify",
      "resolvedVersion": "1.2.0",
      "tarballUrl": "https://.../specify-1.2.0.tar.gz",
      "checksum": "sha256:abc123...",
      "dependencies": []
    }
  }
}
```

The lockfile (`pipeline-lock.json` by default) records:
- Exact resolved version (not a range)
- Exact tarball URL (contains version in path)
- SHA-256 checksum of the downloaded tarball
- Resolved dependency names (also present in lockfile)

Re-running `install` without `--force` skips already-installed pipelines (checked via `isPipelineInstalled(state, name)`). To reinstall at the same version, use `--force`.

### Lockfile schema

```typescript
interface Lockfile {
  lockfileVersion: 1;
  generatedAt: string;         // ISO-8601 when lockfile was written
  pipelines: Record<string, LockfilePipeline>;
}

interface LockfilePipeline {
  name: string;
  resolvedVersion: string;     // Exact version installed
  tarballUrl: string;          // Exact URL used to download
  checksum: string;            // SHA-256 of the downloaded tarball
  dependencies: string[];      // Resolved dep names (keys in this lockfile)
}
```

### State schema

```typescript
interface InstalledState {
  version: "1";
  installedAt: string;
  pipelines: Record<string, InstalledPipeline>;
  clis: Record<string, InstalledCli>;
}

interface InstalledPipeline {
  name: string;
  version: string;
  installedAt: string;
  requiredBy: string[];   // ["direct"] for explicit installs, pipeline names for transitive deps
  checksum: string;
}
```

### Update flow

`collab pipelines update [name]` compares installed versions against `latestVersion` in the registry:

1. Fetch `registry.json`
2. Read `installed-pipelines.json`
3. For each installed pipeline (or named subset), compare `installed.version` vs `registry.latestVersion`
4. Print a diff table of available updates
5. Without `--yes`: print instructions and exit 0 (dry-run mode)
6. With `--yes`: call `install(outdatedNames, { force: true, ... })` to re-install at latest

Force-install is used for updates because the pipeline is already present on disk. The installer skips the `isPipelineInstalled` guard when `force: true`.

### Checksum integrity

The installer always computes a SHA-256 checksum of the downloaded tarball bytes (`computeChecksum(tarballData)` via `lib/integrity.ts`) and writes it to both the state file and lockfile. If the manifest specifies a `checksum` field, the download is verified against it before extraction (`verifyChecksum(tarballData, manifest.checksum, name)`). Mismatches raise `CHECKSUM_MISMATCH` and abort the install.

### Atomic writes

All state and lockfile writes use a write-to-tmp-then-rename pattern to prevent partial writes on crash:

```
writeFileSync(path + ".tmp", json)
renameSync(path + ".tmp", path)
```

Both `writeState` and `writeLockfile` follow this pattern. Directory creation (`mkdirSync(dir, { recursive: true })`) runs before every atomic write.

---

## Implementation Reference

| Concern | Implementation |
|---------|---------------|
| Type definitions | `src/cli/types/index.ts` |
| Registry fetch + parse | `src/cli/lib/registry.ts` |
| Dependency resolution | `src/cli/lib/resolver.ts` |
| CLI dep detection | `src/cli/lib/cli-resolver.ts` |
| Tarball integrity | `src/cli/lib/integrity.ts` |
| State management | `src/cli/lib/state.ts` |
| Lockfile management | `src/cli/lib/lockfile.ts` |
| Install orchestration | `src/cli/commands/pipelines/install.ts` |
| CLI entry point | `src/cli/index.ts` |
| E2E tests | `tests/e2e/cli.test.ts` |
