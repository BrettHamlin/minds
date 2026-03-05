#!/usr/bin/env bun

/**
 * orchestrator-init.ts - Initialize pipeline run for a ticket
 *
 * Performs all setup steps needed to start a new pipeline agent:
 *   Step 1: Resolve repo, worktree, and variant paths
 *   Step 2: Variant config override (pipeline-variants/{variant}.json)
 *   Step 3: Schema validation of pipeline config
 *   Step 4: Coordination cycle detection
 *   Step 5: Set up symlinks (.claude/ and .collab/)
 *   Step 6: Spawn agent pane
 *   Step 7: Create registry atomically
 *
 * Implements rollback: if a step fails, all completed steps are undone.
 *
 * Usage:
 *   bun commands/orchestrator-init.ts <TICKET_ID>
 *   (Reads $TMUX_PANE for orchestrator pane ID)
 *
 * Output (stdout):
 *   AGENT_PANE=<pane_id>
 *   NONCE=<nonce>
 *   REGISTRY=<registry_path>
 *
 * Exit codes:
 *   0 = success
 *   1 = usage/schema error
 *   2 = coordination validation error
 *   3 = file error (paths missing, write failure)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync, spawn } from "child_process";
import { buildAdjacency, detectCycles, buildDependencyHolds, detectImplicitDependencies, type DependencyHold } from "./coordination-check";
import {
  getRepoRoot,
  readJsonFile,
  writeJsonAtomic,
  getRegistryPath,
  readFeatureMetadata,
  validateTicketIdArg,
  TmuxClient,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";
import type { CompiledPipeline } from "../../../lib/pipeline";
import { resolveTransportPath } from "../../../lib/resolve-transport";
import { resolveRepoPath } from "../../../lib/pipeline/repo-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitResult {
  agentPane: string;
  nonce: string;
  registryPath: string;
  repoPath?: string;
}

export interface InitContext {
  ticketId: string;
  orchestratorPane: string;
  repoRoot: string;
  registryDir: string;
  groupsDir: string;
  configPath: string;
  schemaPath: string;
  /** Pipeline variant passed via --pipeline CLI flag; takes precedence over metadata */
  pipelineVariant?: string;
}

// Tracks what was done so we can rollback
interface RollbackState {
  agentPaneCreated?: string;
  claudeSymlinkCreated?: string;
  collabSymlinkCreated?: string;
  specifySymlinkCreated?: string;
  registryCreated?: string;
  busServerPid?: number;
  bridgePid?: number;
  commandBridgePid?: number;
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to a transport script file.
 * Checks installed location (.collab/transport/) first (for production use
 * after `collab.install.ts` is run), falls back to development location
 * (transport/ at repo root, used during collab development).
 */
export function resolveTransportFile(repoRoot: string, filename: string): string {
  const installed = path.join(repoRoot, ".collab", "transport", filename);
  if (fs.existsSync(installed)) return installed;
  return path.join(repoRoot, "transport", filename);
}

/**
 * Reads the transport from the resolved pipeline config file.
 * COLLAB_TRANSPORT env var acts as an override/fallback for testing.
 */
export function resolveTransportFromConfig(configPath: string): "tmux" | "bus" {
  const envOverride = process.env.COLLAB_TRANSPORT;
  if (envOverride === "bus") return "bus";
  if (envOverride === "tmux") return "tmux";

  const config = readJsonFile(configPath) as Record<string, unknown> | null;
  const configTransport = config?.transport as string | undefined;
  if (configTransport === "bus") return "bus";
  return "tmux";
}

/**
 * Injects COLLAB_TRANSPORT and BUS_URL env vars into a spawn command string,
 * positioned immediately before the `claude` invocation.
 */
export function injectBusEnv(spawnCmd: string, busUrl: string): string {
  return spawnCmd.replace(
    "claude --dangerously-skip-permissions",
    `COLLAB_TRANSPORT=bus BUS_URL=${busUrl} claude --dangerously-skip-permissions`
  );
}

/**
 * Starts bus-server.ts as a detached background process.
 * Resolves with { pid, url } once BUS_READY is printed to stdout.
 * Also writes the port to .collab/bus-port (done by bus-server.ts itself).
 */
export function startBusServer(repoRoot: string): Promise<{ pid: number; url: string }> {
  const serverPath = resolveTransportFile(repoRoot, "bus-server.ts");
  if (!fs.existsSync(serverPath)) {
    return Promise.reject(
      new OrchestratorError("FILE_NOT_FOUND", `Bus server not found: ${serverPath}`)
    );
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("bun", [serverPath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "inherit"],
      detached: true,
    });

    proc.unref();

    const timeout = setTimeout(() => {
      try { process.kill(proc.pid!, "SIGTERM"); } catch { /* ignore */ }
      reject(new OrchestratorError("RUNTIME", "Bus server startup timeout (5s)"));
    }, 5000);

    proc.stdout!.on("data", (data: Buffer) => {
      const match = data.toString().match(/BUS_READY port=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        const port = parseInt(match[1], 10);
        resolve({ pid: proc.pid!, url: `http://localhost:${port}` });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new OrchestratorError("RUNTIME", `Bus server spawn error: ${err.message}`));
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new OrchestratorError("RUNTIME", `Bus server exited unexpectedly (code ${code})`));
    });
  });
}

/**
 * Kills the bus server process and removes .collab/bus-port.
 */
export function teardownBusServer(pid: number, portFile?: string): void {
  try {
    process.kill(pid, "SIGTERM");
    console.error(`Killed bus server (pid ${pid})`);
  } catch {
    // Already dead — ignore
  }

  if (portFile && fs.existsSync(portFile)) {
    try {
      fs.unlinkSync(portFile);
      console.error(`Removed bus port file: ${portFile}`);
    } catch (err) {
      console.error(`Failed to remove bus port file: ${err}`);
    }
  }
}

/**
 * Starts the bus-signal-bridge daemon as a detached background process.
 * The bridge subscribes to the bus SSE stream and delivers signals to the
 * orchestrator pane via tmux send-keys (last-mile delivery).
 */
export function startBusSignalBridge(
  repoRoot: string,
  busUrl: string,
  channel: string,
  orchestratorPane: string
): { pid: number } {
  const bridgePath = resolveTransportFile(repoRoot, "bus-signal-bridge.ts");
  const proc = spawn("bun", [bridgePath, busUrl, channel, orchestratorPane], {
    cwd: repoRoot,
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  console.error(`Bus signal bridge started: pid=${proc.pid} channel=${channel}`);
  return { pid: proc.pid! };
}

/**
 * Starts the status daemon as a detached background process.
 * Best-effort: failure to start should NOT fail pipeline init.
 * Returns { pid } on success, or null on failure.
 */
export function startStatusDaemon(repoRoot: string): Promise<{ pid: number } | null> {
  const daemonPath = resolveTransportFile(repoRoot, "status-daemon.ts");
  if (!fs.existsSync(daemonPath)) {
    console.error("[StatusDaemon] Script not found, skipping: " + daemonPath);
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const proc = spawn("bun", [daemonPath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "inherit"],
      detached: true,
    });

    proc.unref();

    const timeout = setTimeout(() => {
      console.error("[StatusDaemon] Startup timeout (5s), continuing without status daemon");
      resolve(null);
    }, 5000);

    proc.stdout!.on("data", (data: Buffer) => {
      const output = data.toString();
      const readyMatch = output.match(/STATUS_DAEMON_READY port=(\d+)/);
      const existingMatch = output.match(/STATUS_DAEMON_EXISTING port=(\d+)/);
      if (readyMatch || existingMatch) {
        clearTimeout(timeout);
        resolve({ pid: proc.pid! });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      console.error(`[StatusDaemon] Spawn error: ${err.message}, continuing without status daemon`);
      resolve(null);
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        // Exited cleanly (STATUS_DAEMON_EXISTING case)
        resolve(null);
      } else {
        console.error(`[StatusDaemon] Exited with code ${code}, continuing without status daemon`);
        resolve(null);
      }
    });
  });
}

/**
 * Starts the bus-command-bridge daemon as a detached background process.
 * The bridge subscribes to the bus SSE stream and delivers commands to the
 * agent pane via tmux send-keys (last-mile delivery).
 * Started after the agent pane is spawned (requires agentPane ID).
 */
export function startBusCommandBridge(
  repoRoot: string,
  busUrl: string,
  channel: string,
  agentPane: string
): { pid: number } {
  const bridgePath = resolveTransportFile(repoRoot, "bus-command-bridge.ts");
  const proc = spawn("bun", [bridgePath, busUrl, channel, agentPane], {
    cwd: repoRoot,
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  console.error(`Bus command bridge started: pid=${proc.pid} channel=${channel} pane=${agentPane}`);
  return { pid: proc.pid! };
}

// ---------------------------------------------------------------------------
// Step 1: Schema validation
// ---------------------------------------------------------------------------

export function validateSchema(ctx: InitContext): void {
  if (!fs.existsSync(ctx.schemaPath)) {
    throw new OrchestratorError(
      "FILE_NOT_FOUND",
      `Schema file not found: ${ctx.schemaPath}. Run 'cp src/config/pipeline.v3.schema.json .collab/config/' to deploy it.`
    );
  }

  if (!fs.existsSync(ctx.configPath)) {
    throw new OrchestratorError(
      "FILE_NOT_FOUND",
      `Pipeline config not found: ${ctx.configPath}`
    );
  }

  const ajvBin = path.join(ctx.repoRoot, "node_modules/.bin/ajv");
  if (!fs.existsSync(ajvBin)) {
    console.error("Schema validation skipped: ajv CLI not available");
    return;
  }

  console.error("Validating pipeline.json against v3 schema...");

  try {
    execSync(
      `"${ajvBin}" validate --spec=draft2020 --strict=false -s "${ctx.schemaPath}" -d "${ctx.configPath}" --errors=json --all-errors`,
      { stdio: "pipe" }
    );
  } catch (err: any) {
    const output = err.stdout?.toString() || err.stderr?.toString() || String(err);
    throw new OrchestratorError(
      "VALIDATION",
      `pipeline.json failed schema validation:\n${output}`
    );
  }

  console.error("Schema validation passed.");
}

// ---------------------------------------------------------------------------
// Step 2: Coordination check + dependency hold detection
// ---------------------------------------------------------------------------

export function runCoordinationCheck(ctx: InitContext): void {
  // Collect existing session ticket IDs
  const sessionTickets: string[] = [];
  if (fs.existsSync(ctx.registryDir)) {
    for (const file of fs.readdirSync(ctx.registryDir)) {
      if (!file.endsWith(".json")) continue;
      const reg = readJsonFile(path.join(ctx.registryDir, file));
      if (reg?.ticket_id) sessionTickets.push(reg.ticket_id as string);
    }
  }
  sessionTickets.push(ctx.ticketId);

  console.error(`Running coordination check for ${sessionTickets.length} tickets...`);

  const specsDir = path.join(ctx.repoRoot, "specs");
  const { adjacency, errors } = buildAdjacency(sessionTickets, specsDir);

  if (errors.length > 0) {
    throw new OrchestratorError(
      "VALIDATION",
      `Coordination errors:\n${errors.join("\n")}`
    );
  }

  const cycles = detectCycles(adjacency);
  if (cycles.length > 0) {
    const cycleList = cycles.map((c: { path: string[] }) => c.path.join(" → ")).join("\n");
    throw new OrchestratorError(
      "VALIDATION",
      `Circular dependencies detected:\n${cycleList}`
    );
  }
}

/**
 * Find the dependency hold for a specific ticket from the current session.
 * Returns the hold record if the ticket has a Linear blockedBy dependency or
 * an implicit variant dependency, or null if the ticket has no dependencies.
 *
 * @param implicitBlockedBy - Optional ticket IDs inferred from variant relationships
 *   (e.g., verification blocked by backend). These are merged with any explicit
 *   blockedBy entries from metadata.json. Duplicates are skipped.
 */
export function findDependencyHold(
  ticketId: string,
  sessionTickets: string[],
  specsDir: string,
  implicitBlockedBy?: string[]
): DependencyHold | null {
  const holds = buildDependencyHolds(sessionTickets, specsDir);

  // Inject implicit holds (variant-inferred deps not present in metadata.json).
  if (implicitBlockedBy && implicitBlockedBy.length > 0) {
    const pipelineSet = new Set(sessionTickets);
    for (const blocker of implicitBlockedBy) {
      // Skip if already covered by an explicit hold for this ticket+blocker pair.
      if (holds.some((h) => h.held_ticket === ticketId && h.blocked_by === blocker)) continue;
      holds.push({
        held_ticket: ticketId,
        blocked_by: blocker,
        release_when: "done",
        reason: "implicit variant dependency",
        external: !pipelineSet.has(blocker),
      });
    }
  }

  return holds.find((h) => h.held_ticket === ticketId) ?? null;
}

// ---------------------------------------------------------------------------
// Step 3: Resolve paths
// ---------------------------------------------------------------------------

export interface PathResolution {
  repoRoot: string;
  worktreePath: string | null;
  spawnCmd: string;
  repoId?: string;
  repoPath?: string;
  pipelineVariant?: string;
}

export function resolvePaths(ctx: InitContext): PathResolution {
  // Find main repo root (handles worktree case)
  let repoRoot: string;
  try {
    const superRoot = execSync("git rev-parse --show-superproject-working-tree", {
      encoding: "utf-8",
      cwd: ctx.repoRoot,
    }).trim();
    repoRoot = superRoot || ctx.repoRoot;
  } catch {
    repoRoot = ctx.repoRoot;
  }

  // Read metadata.json for this ticket via shared utility
  let worktreePath: string | null = null;
  let metadataRepoId: string | undefined;
  let pipelineVariant: string | undefined;
  const specsDir = path.join(repoRoot, "specs");

  const featureMetadata = readFeatureMetadata(specsDir, ctx.ticketId);
  if (featureMetadata) {
    const wt = featureMetadata.worktree_path;
    if (typeof wt === "string" && wt) {
      if (!fs.existsSync(wt)) {
        throw new OrchestratorError(
          "FILE_NOT_FOUND",
          `Worktree path does not exist: ${wt}`
        );
      }
      worktreePath = wt;
      console.error(`Using worktree: ${worktreePath}`);
    }

    metadataRepoId = featureMetadata.repo_id;
    pipelineVariant = featureMetadata.pipeline_variant;
  }

  // Multi-repo: resolve repo path from ~/.collab/repos.json
  let repoId: string | undefined;
  let repoPath: string | undefined;

  if (metadataRepoId) {
    const resolved = resolveRepoPath(metadataRepoId);
    if (resolved) {
      repoId = metadataRepoId;
      repoPath = resolved;
      console.error(`Multi-repo: using repo '${repoId}' at ${repoPath}`);
    } else {
      console.error(`Multi-repo: repo '${metadataRepoId}' not registered. Run: collab repo add ${metadataRepoId} /path/to/repo`);
    }
  }

  // Build spawn command: worktree takes precedence (has symlinked .collab/ with registry).
  // Fall back to repoPath only when no worktree was created.
  const spawnTarget = worktreePath ?? repoPath;
  const spawnCmd = spawnTarget
    ? `cd '${spawnTarget}' && claude --dangerously-skip-permissions`
    : "claude --dangerously-skip-permissions";

  if (!spawnTarget) {
    console.error("No worktree or multi-repo path found, using current directory");
  }

  return { repoRoot, worktreePath, spawnCmd, repoId, repoPath, pipelineVariant };
}

// ---------------------------------------------------------------------------
// Step 4: Symlinks
// ---------------------------------------------------------------------------

export function setupSymlinks(
  worktreePath: string | null,
  repoRoot: string,
  rb: RollbackState
): void {
  if (!worktreePath) return;

  for (const dir of [".claude", ".collab", ".specify"] as const) {
    const src = path.join(repoRoot, dir);
    const dest = path.join(worktreePath, dir);

    if (!fs.existsSync(src)) continue;

    // Remove non-symlink directory if present
    if (fs.existsSync(dest) && !fs.lstatSync(dest).isSymbolicLink()) {
      fs.rmSync(dest, { recursive: true });
      console.error(`Removed non-symlink ${dir}/ directory in worktree`);
    }

    if (!fs.existsSync(dest)) {
      fs.symlinkSync(src, dest);
      if (dir === ".claude") rb.claudeSymlinkCreated = dest;
      else if (dir === ".collab") rb.collabSymlinkCreated = dest;
      else rb.specifySymlinkCreated = dest;
      console.error(`Created ${dir}/ symlink in worktree`);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 5: Spawn agent pane
// ---------------------------------------------------------------------------

export function spawnAgentPane(
  splitTarget: string,
  spawnCmd: string,
  ticketId: string,
  rb: RollbackState,
  horizontal = true,
  percentage = 70
): string {
  const tmux = new TmuxClient();
  const agentPane = tmux.splitPane(splitTarget, spawnCmd, percentage, horizontal);

  if (!agentPane) {
    throw new OrchestratorError(
      "TMUX",
      `Failed to split pane from ${splitTarget}`
    );
  }

  rb.agentPaneCreated = agentPane;

  // Set pane title and ensure border-status is on so the title is visible
  tmux.run("select-pane", "-t", agentPane, "-T", ticketId);
  tmux.run("set-option", "-t", agentPane, "pane-border-status", "top");
  tmux.run("set-option", "-t", agentPane, "pane-border-format", "#{pane_title}");

  return agentPane;
}

// ---------------------------------------------------------------------------
// Step 6: Create registry
// ---------------------------------------------------------------------------

export interface HoldInfo {
  held_by: string;
  hold_release_when: string;
  hold_reason: string;
  /** True when the blocker is not part of the current pipeline run (needs manual release). */
  hold_external: boolean;
}

export function createRegistry(
  ctx: InitContext,
  agentPane: string,
  rb: RollbackState,
  repoId?: string,
  repoPath?: string,
  pipelineVariant?: string,
  transport?: string,
  busServerPid?: number,
  busUrl?: string,
  bridgePid?: number,
  commandBridgePid?: number,
  holdInfo?: HoldInfo
): { nonce: string; registryPath: string } {
  const nonce = crypto.randomBytes(4).toString("hex").substring(0, 8);

  // Get first phase from pipeline.json
  const pipeline = readJsonFile(ctx.configPath) as CompiledPipeline | null;
  const firstPhase = pipeline?.phases ? Object.keys(pipeline.phases)[0] : "clarify";

  const registryPath = getRegistryPath(ctx.registryDir, ctx.ticketId);
  const registry: Record<string, unknown> = {
    orchestrator_pane_id: ctx.orchestratorPane,
    agent_pane_id: agentPane,
    ticket_id: ctx.ticketId,
    nonce,
    current_step: firstPhase,
    color_index: 1,
    phase_history: [],
    started_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };

  if (repoId) registry.repo_id = repoId;
  if (repoPath) registry.repo_path = repoPath;
  if (pipelineVariant) registry.pipeline_variant = pipelineVariant;
  if (transport) registry.transport = transport;
  if (busServerPid !== undefined) registry.bus_server_pid = busServerPid;
  if (busUrl) registry.bus_url = busUrl;
  if (bridgePid !== undefined) registry.bridge_pid = bridgePid;
  if (commandBridgePid !== undefined) registry.command_bridge_pid = commandBridgePid;
  if (holdInfo) {
    registry.held_by = holdInfo.held_by;
    registry.hold_release_when = holdInfo.hold_release_when;
    registry.hold_reason = holdInfo.hold_reason;
    if (holdInfo.hold_external) registry.hold_external = true;
  }

  writeJsonAtomic(registryPath, registry);
  rb.registryCreated = registryPath;

  return { nonce, registryPath };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

function rollback(rb: RollbackState, repoRoot?: string): void {
  console.error("Rolling back partial initialization...");

  if (rb.commandBridgePid !== undefined) {
    try { process.kill(rb.commandBridgePid, "SIGTERM"); } catch { /* already dead */ }
    console.error(`Killed command bridge (pid ${rb.commandBridgePid})`);
  }

  if (rb.bridgePid !== undefined) {
    try { process.kill(rb.bridgePid, "SIGTERM"); } catch { /* already dead */ }
    console.error(`Killed signal bridge (pid ${rb.bridgePid})`);
  }

  if (rb.busServerPid !== undefined) {
    const portFile = repoRoot ? path.join(repoRoot, ".collab", "bus-port") : undefined;
    teardownBusServer(rb.busServerPid, portFile);
  }

  if (rb.registryCreated && fs.existsSync(rb.registryCreated)) {
    try {
      fs.unlinkSync(rb.registryCreated);
      console.error(`Removed registry: ${rb.registryCreated}`);
    } catch (err) {
      console.error(`Failed to remove registry: ${err}`);
    }
  }

  if (rb.agentPaneCreated) {
    try {
      execSync(`tmux kill-pane -t "${rb.agentPaneCreated}"`, { stdio: "pipe" });
      console.error(`Killed agent pane: ${rb.agentPaneCreated}`);
    } catch {
      // Pane may already be gone
    }
  }

  for (const symlinkPath of [rb.claudeSymlinkCreated, rb.collabSymlinkCreated, rb.specifySymlinkCreated]) {
    if (symlinkPath && fs.existsSync(symlinkPath)) {
      try {
        fs.unlinkSync(symlinkPath);
        console.error(`Removed symlink: ${symlinkPath}`);
      } catch (err) {
        console.error(`Failed to remove symlink: ${err}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main init sequence
// ---------------------------------------------------------------------------

export async function initPipeline(ctx: InitContext): Promise<InitResult> {
  const rb: RollbackState = {};

  try {
    // Step 1: Resolve paths (determines variant before validation)
    const resolved = resolvePaths(ctx);
    const { repoRoot, worktreePath, spawnCmd: baseSpawnCmd, repoId, repoPath } = resolved;
    // CLI --pipeline flag takes precedence over metadata
    const pipelineVariant = ctx.pipelineVariant ?? resolved.pipelineVariant;

    // Step 2: Variant config override
    if (pipelineVariant) {
      const variantPath = path.join(ctx.repoRoot, ".collab", "config", "pipeline-variants", `${pipelineVariant}.json`);
      if (fs.existsSync(variantPath)) {
        ctx.configPath = variantPath;
        console.error(`Using pipeline variant '${pipelineVariant}': ${variantPath}`);
      } else {
        console.error(`Warning: pipeline variant '${pipelineVariant}' not found at ${variantPath}, using default pipeline.json`);
      }
    }

    // Step 3: Schema validation
    validateSchema(ctx);

    // Step 2.5: Resolve transport and start bus lifecycle if needed
    const transportType = resolveTransportFromConfig(ctx.configPath);
    let busTransport: { start: Function; getLifecycleInfo: Function; injectAgentEnv: Function; startCommandBridge: Function } | undefined;

    if (transportType === "bus") {
      console.error("Transport: bus — starting bus server and signal bridge...");
      const { BusTransport } = await import(resolveTransportPath("BusTransport.ts"));
      busTransport = new BusTransport("");
      await busTransport.start(ctx.repoRoot, ctx.orchestratorPane, ctx.ticketId);
      const info = busTransport.getLifecycleInfo();
      console.error(`Bus server started: pid=${info.busServerPid} url=${info.busUrl}`);
      if (info.busServerPid !== undefined) rb.busServerPid = info.busServerPid;
      if (info.bridgePid !== undefined) rb.bridgePid = info.bridgePid;
    } else {
      console.error("Transport: tmux");
    }

    // Start status daemon (best-effort, non-blocking for pipeline)
    if (transportType === "bus") {
      const statusDaemonResult = await startStatusDaemon(ctx.repoRoot);
      if (statusDaemonResult) {
        console.error(`Status daemon started: pid=${statusDaemonResult.pid}`);
      }
    }

    // Build final spawn command, injecting bus env vars if needed
    const spawnCmd = busTransport
      ? busTransport.injectAgentEnv(baseSpawnCmd)
      : baseSpawnCmd;

    // Step 4: Coordination check
    runCoordinationCheck(ctx);

    // Step 4.5: Dependency hold detection (Linear blockedBy + implicit variant deps)
    const specsDir = path.join(repoRoot, "specs");
    const sessionTickets: string[] = [];
    if (fs.existsSync(ctx.registryDir)) {
      for (const file of fs.readdirSync(ctx.registryDir)) {
        if (!file.endsWith(".json")) continue;
        const reg = readJsonFile(path.join(ctx.registryDir, file));
        if (reg?.ticket_id) sessionTickets.push(reg.ticket_id as string);
      }
    }
    sessionTickets.push(ctx.ticketId);

    // Auto-detect implicit blockers from variant relationships (e.g., verification blocked by backend).
    const implicitBlockers = detectImplicitDependencies(
      ctx.ticketId,
      pipelineVariant,
      ctx.registryDir,
      specsDir
    );
    if (implicitBlockers.length > 0) {
      console.error(
        `Implicit variant dependency: ${ctx.ticketId} (${pipelineVariant ?? "no variant"}) ` +
        `blocked by backend ticket(s): ${implicitBlockers.join(", ")}`
      );
    } else if (pipelineVariant && pipelineVariant !== "backend") {
      console.error(
        `Warning: ${ctx.ticketId} is a '${pipelineVariant}' variant but no backend ticket found ` +
        `in registry or specs/ — no implicit hold applied`
      );
    }

    const depHold = findDependencyHold(ctx.ticketId, sessionTickets, specsDir, implicitBlockers);
    if (depHold) {
      const blockerType = depHold.external ? "external" : "internal";
      console.error(
        `Dependency hold: ${ctx.ticketId} is blocked by ${depHold.blocked_by} ` +
        `(${blockerType}, release_when=${depHold.release_when})`
      );
    }

    // Step 5: Symlinks
    setupSymlinks(worktreePath, repoRoot, rb);

    // Step 6: Spawn agent pane
    // Layout: first agent splits orchestrator pane horizontally (side-by-side).
    // Subsequent agents split the previous agent pane vertically (stacked on right).
    let splitTarget = ctx.orchestratorPane;
    let horizontal = true;
    const existingFiles = fs.existsSync(ctx.registryDir)
      ? fs.readdirSync(ctx.registryDir).filter((f) => f.endsWith(".json"))
      : [];
    if (existingFiles.length > 0) {
      const sorted = existingFiles
        .map((f) => ({ f, mtime: fs.statSync(path.join(ctx.registryDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      const lastReg = readJsonFile(path.join(ctx.registryDir, sorted[0].f));
      if (lastReg?.agent_pane_id) {
        splitTarget = lastReg.agent_pane_id as string;
        horizontal = false;
      }
    }
    const splitPct = horizontal ? 70 : 50;
    const agentPane = spawnAgentPane(splitTarget, spawnCmd, ctx.ticketId, rb, horizontal, splitPct);

    // Start command bridge after agent pane is known (requires agentPane ID for last-mile delivery)
    if (busTransport) {
      busTransport.startCommandBridge(ctx.repoRoot, agentPane, ctx.ticketId);
      const info = busTransport.getLifecycleInfo();
      if (info.commandBridgePid !== undefined) rb.commandBridgePid = info.commandBridgePid;
    }

    // Step 7: Create registry
    const lifecycleInfo = busTransport?.getLifecycleInfo();
    const holdInfo: HoldInfo | undefined = depHold
      ? {
          held_by: depHold.blocked_by,
          hold_release_when: depHold.release_when,
          hold_reason: depHold.reason,
          hold_external: depHold.external,
        }
      : undefined;
    const { nonce, registryPath } = createRegistry(
      ctx, agentPane, rb, repoId, repoPath, pipelineVariant,
      transportType, lifecycleInfo?.busServerPid, lifecycleInfo?.busUrl,
      lifecycleInfo?.bridgePid, lifecycleInfo?.commandBridgePid, holdInfo
    );

    return { agentPane, nonce, registryPath, repoPath };
  } catch (err) {
    // Any step failure triggers rollback of completed steps
    rollback(rb, ctx.repoRoot);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "orchestrator-init.ts");

  if (args.length < 1) {
    console.error("Usage: orchestrator-init.ts <TICKET_ID>");
    process.exit(1);
  }

  const ticketId = args[0];
  const pipelineIdx = args.indexOf("--pipeline");
  const cliVariant = pipelineIdx !== -1 && args[pipelineIdx + 1] ? args[pipelineIdx + 1] : undefined;
  const orchestratorPane = process.env.TMUX_PANE || "";

  if (!orchestratorPane) {
    console.error("Error: TMUX_PANE environment variable is required");
    process.exit(1);
  }

  try {
    const repoRoot = getRepoRoot();
    const ctx: InitContext = {
      ticketId,
      orchestratorPane,
      repoRoot,
      registryDir: `${repoRoot}/.collab/state/pipeline-registry`,
      groupsDir: `${repoRoot}/.collab/state/pipeline-groups`,
      configPath: `${repoRoot}/.collab/config/pipeline.json`,
      schemaPath: `${repoRoot}/.collab/config/pipeline.compiled.schema.json`,
      pipelineVariant: cliVariant,
    };

    fs.mkdirSync(ctx.registryDir, { recursive: true });
    fs.mkdirSync(ctx.groupsDir, { recursive: true });

    // Idempotency guard: if a registry already exists for this ticket, reuse it
    // instead of creating a duplicate pane. This prevents ghost panes when the
    // orchestrator retries a call it thought failed (e.g., stdout not captured).
    const existingRegistry = getRegistryPath(ctx.registryDir, ticketId);
    if (fs.existsSync(existingRegistry)) {
      const existing = readJsonFile(existingRegistry);
      if (existing?.agent_pane_id && existing?.nonce) {
        console.error(`Registry already exists for ${ticketId}, reusing existing pane ${existing.agent_pane_id}`);
        console.log(`AGENT_PANE=${existing.agent_pane_id}`);
        console.log(`NONCE=${existing.nonce}`);
        console.log(`REGISTRY=${existingRegistry}`);
        if (existing.repo_path) console.log(`SOURCE_REPO=${existing.repo_path}`);
        process.exit(0);
      }
    }

    const result = await initPipeline(ctx);

    // Output for orchestrator to capture
    console.log(`AGENT_PANE=${result.agentPane}`);
    console.log(`NONCE=${result.nonce}`);
    console.log(`REGISTRY=${result.registryPath}`);
    if (result.repoPath) {
      console.log(`SOURCE_REPO=${result.repoPath}`);
    }
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main().then(() => process.exit(0));
}
