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
import {
  getRepoRoot,
  readJsonFile,
  writeJsonAtomic,
  getRegistryPath,
  TmuxClient,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";
import type { CompiledPipeline } from "../../../lib/pipeline";

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
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

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
  const serverPath = path.join(repoRoot, "transport", "bus-server.ts");
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
  const bridgePath = path.join(repoRoot, "transport", "bus-signal-bridge.ts");
  const proc = spawn("bun", [bridgePath, busUrl, channel, orchestratorPane], {
    cwd: repoRoot,
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  console.error(`Bus signal bridge started: pid=${proc.pid} channel=${channel}`);
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
// Step 2: Coordination check
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

  // Import and run inline (avoids subprocess)
  const { buildAdjacency, detectCycles } = require("./coordination-check");
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

  // Scan for metadata.json matching ticket ID
  let worktreePath: string | null = null;
  let metadataRepoId: string | undefined;
  let pipelineVariant: string | undefined;
  const specsGlob = path.join(repoRoot, "specs");

  if (fs.existsSync(specsGlob)) {
    for (const entry of fs.readdirSync(specsGlob)) {
      const metadataPath = path.join(specsGlob, entry, "metadata.json");
      if (!fs.existsSync(metadataPath)) continue;

      const metadata = readJsonFile(metadataPath);
      if (!metadata || metadata.ticket_id !== ctx.ticketId) continue;

      const wt = metadata.worktree_path as string | undefined;
      if (wt) {
        if (!fs.existsSync(wt)) {
          throw new OrchestratorError(
            "FILE_NOT_FOUND",
            `Worktree path does not exist: ${wt}`
          );
        }
        worktreePath = wt;
        console.error(`Using worktree: ${worktreePath}`);
      }

      metadataRepoId = metadata.repo_id as string | undefined;
      pipelineVariant = metadata.pipeline_variant as string | undefined;
      break;
    }
  }

  // Multi-repo: check for .collab/config/multi-repo.json + metadata repo_id
  let repoId: string | undefined;
  let repoPath: string | undefined;
  const multiRepoConfigPath = path.join(repoRoot, ".collab", "config", "multi-repo.json");

  if (metadataRepoId && fs.existsSync(multiRepoConfigPath)) {
    const multiRepoConfig = readJsonFile(multiRepoConfigPath);
    const repos = multiRepoConfig?.repos as Record<string, { path: string }> | undefined;
    if (repos && repos[metadataRepoId]) {
      repoPath = repos[metadataRepoId].path;
      if (!fs.existsSync(repoPath)) {
        throw new OrchestratorError(
          "FILE_NOT_FOUND",
          `Multi-repo path for '${metadataRepoId}' does not exist: ${repoPath}`
        );
      }
      repoId = metadataRepoId;
      console.error(`Multi-repo: using repo '${repoId}' at ${repoPath}`);
    } else if (repos) {
      throw new OrchestratorError(
        "VALIDATION",
        `repo_id '${metadataRepoId}' not found in multi-repo.json. Available: ${Object.keys(repos).join(", ")}`
      );
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
  bridgePid?: number
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

  writeJsonAtomic(registryPath, registry);
  rb.registryCreated = registryPath;

  return { nonce, registryPath };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

function rollback(rb: RollbackState, repoRoot?: string): void {
  console.error("Rolling back partial initialization...");

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
    const { repoRoot, worktreePath, spawnCmd: baseSpawnCmd, repoId, repoPath, pipelineVariant } = resolvePaths(ctx);

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

    // Step 2.5: Resolve transport and start bus server if needed
    const transport = resolveTransportFromConfig(ctx.configPath);
    let busServerPid: number | undefined;
    let busUrl: string | undefined;

    let bridgePid: number | undefined;

    if (transport === "bus") {
      console.error("Transport: bus — starting bus server and signal bridge...");
      const bus = await startBusServer(ctx.repoRoot);
      busServerPid = bus.pid;
      busUrl = bus.url;
      rb.busServerPid = busServerPid;
      console.error(`Bus server started: pid=${busServerPid} url=${busUrl}`);

      const bridge = startBusSignalBridge(
        ctx.repoRoot,
        busUrl,
        `pipeline-${ctx.ticketId}`,
        ctx.orchestratorPane
      );
      bridgePid = bridge.pid;
      rb.bridgePid = bridgePid;
    } else {
      console.error("Transport: tmux");
    }

    // Build final spawn command, injecting bus env vars if needed
    const spawnCmd = transport === "bus" && busUrl
      ? injectBusEnv(baseSpawnCmd, busUrl)
      : baseSpawnCmd;

    // Step 4: Coordination check
    runCoordinationCheck(ctx);

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

    // Step 7: Create registry
    const { nonce, registryPath } = createRegistry(
      ctx, agentPane, rb, repoId, repoPath, pipelineVariant,
      transport, busServerPid, busUrl, bridgePid
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

  if (args.length < 1) {
    console.error("Usage: orchestrator-init.ts <TICKET_ID>");
    process.exit(1);
  }

  const ticketId = args[0];
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
    };

    fs.mkdirSync(ctx.registryDir, { recursive: true });
    fs.mkdirSync(ctx.groupsDir, { recursive: true });

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
  main();
}
