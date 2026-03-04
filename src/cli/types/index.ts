/**
 * Collab CLI — TypeScript types for pipeline.json, registry.json, state, lock
 * Single source of truth for all JSON schema shapes.
 */

// ─── Pipeline / Pack Manifests ──────────────────────────────────────────────

/** pipeline.json in a single-pipeline package */
export interface PipelineManifest {
  /** Package name (e.g., "specify") */
  name: string;
  /** Discriminator: "pipeline" for single pipeline, "pack" for multi-pipeline bundle */
  type: "pipeline" | "pack";
  /** Semver version string (e.g., "1.0.0") */
  version: string;
  /** Human-readable description */
  description: string;
  author?: string;
  repository?: string;
  /** Other pipelines/packs this depends on */
  dependencies?: PipelineDependency[];
  /** External CLI tools required */
  cliDependencies?: CliDependency[];
  /** List of command file paths included in the package (relative to package root) */
  commands?: string[];
  /** Handler .ts file paths to install to .collab/handlers/ (relative to package root) */
  handlers?: string[];
  /** Executor .ts file paths to install to .collab/scripts/ (relative to package root) */
  executors?: string[];
  /** SHA-256 checksum of the package tarball */
  checksum?: string;
}

/** pipeline.json for a multi-pipeline pack */
export interface PackManifest extends PipelineManifest {
  type: "pack";
  /** Names of all pipelines bundled in this pack */
  pipelines: string[];
}

/** Dependency on another pipeline or pack */
export interface PipelineDependency {
  name: string;
  /** Semver range string (e.g., ">=1.0.0", "^2.3.0") */
  version: string;
}

/** Dependency on an external CLI tool (e.g., jq, git, bun) */
export interface CliDependency {
  name: string;
  /** Semver range the installed version must satisfy */
  version: string;
  /** Hint shown to user when the CLI is missing or too old */
  installHint?: string;
  /** If true, install fails when this CLI is missing/incompatible */
  required: boolean;
}

// ─── Registry ───────────────────────────────────────────────────────────────

/** Root structure of registry.json hosted on GitHub */
export interface RegistryIndex {
  version: string;
  updatedAt: string;
  packs: RegistryEntry[];
  pipelines: RegistryEntry[];
}

/** One entry in the registry index */
export interface RegistryEntry {
  name: string;
  description: string;
  latestVersion: string;
  /** URL to fetch the full pipeline.json manifest */
  manifestUrl: string;
  /** URL to fetch the package tarball */
  tarballUrl: string;
  /** SHA-256 checksum of the extracted pipeline directory contents (optional; absent = skip verify) */
  sha256?: string;
}

// ─── Installed State ────────────────────────────────────────────────────────

/** Root of installed-pipelines.json written to .collab/state/ */
export interface InstalledState {
  version: "1";
  installedAt: string;
  /** Installed pipeline/pack entries, keyed by name */
  pipelines: Record<string, InstalledPipeline>;
  /** Installed CLI tool entries, keyed by CLI name */
  clis: Record<string, InstalledCli>;
}

/** One installed pipeline or pack */
export interface InstalledPipeline {
  name: string;
  version: string;
  installedAt: string;
  /** Which packs/direct installs require this pipeline */
  requiredBy: string[];
  checksum: string;
}

/** One tracked external CLI dep */
export interface InstalledCli {
  name: string;
  version: string;
  installedAt: string;
  /** Which pipelines required this CLI */
  requiredBy: string[];
}

// ─── Lockfile ────────────────────────────────────────────────────────────────

/** Root of pipeline-lock.json — records exact resolved versions for reproducibility */
export interface Lockfile {
  lockfileVersion: 1;
  generatedAt: string;
  /** Registry URL this lockfile was generated from */
  registryUrl?: string;
  /** Installed pack entries, keyed by pack name */
  packs?: Record<string, LockfilePack>;
  /** Resolved pipeline entries, keyed by name */
  pipelines: Record<string, LockfilePipeline>;
}

/** Locked record for one pipeline */
export interface LockfilePipeline {
  name: string;
  resolvedVersion: string;
  tarballUrl: string;
  checksum: string;
  /** Resolved names of direct dependencies (also present in lockfile) */
  dependencies: string[];
}

/** Locked record for one pack */
export interface LockfilePack {
  /** Version of the pack itself */
  version: string;
  /** Map of component pipeline name → pinned version */
  resolved: Record<string, string>;
}

// ─── Resolver ────────────────────────────────────────────────────────────────

/** Result of dependency resolution */
export interface ResolveResult {
  /** Installation order (topologically sorted, deps first) */
  order: string[];
  /** Full graph: name → resolved manifest */
  resolved: Map<string, PipelineManifest>;
}

// ─── CLI Resolver ────────────────────────────────────────────────────────────

export type CliStatus = "satisfied" | "too-old" | "missing" | "unknown-version";

/** Result of checking one CLI dependency */
export interface CliCheckResult {
  name: string;
  status: CliStatus;
  /** Installed version string, if found */
  installedVersion?: string;
  /** Required version range */
  requiredRange: string;
  installHint?: string;
  required: boolean;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Structured error — all public-facing errors use this shape */
export interface CollabError {
  error: string;
  code: string;
  context: Record<string, unknown>;
}

/** Error codes thrown by lib modules */
export type ErrorCode =
  | "NETWORK_ERROR"
  | "REGISTRY_INVALID"
  | "PIPELINE_NOT_FOUND"
  | "CIRCULAR_DEPENDENCY"
  | "MISSING_DEPENDENCY"
  | "CHECKSUM_MISMATCH"
  | "ATOMIC_WRITE_FAILED"
  | "STATE_CORRUPT"
  | "CLI_NOT_FOUND"
  | "CLI_VERSION_TOO_OLD"
  | "SEMVER_PARSE_ERROR"
  | "MANIFEST_INVALID";

export function makeError(
  code: ErrorCode,
  message: string,
  context: Record<string, unknown> = {}
): CollabError {
  return { error: message, code, context };
}

/** Print a CollabError (or unknown error) to stderr in a consistent format. */
export function printError(err: unknown): void {
  if (err && typeof err === "object" && "error" in err) {
    const e = err as { error: string; code: string };
    console.error(`Error [${e.code}]: ${e.error}`);
  } else {
    console.error("Unexpected error:", err);
  }
}
