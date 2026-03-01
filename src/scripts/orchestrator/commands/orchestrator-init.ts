#!/usr/bin/env bun

/**
 * orchestrator-init.ts - Initialize pipeline run for a ticket
 *
 * Performs all setup steps needed to start a new pipeline agent:
 *   Step 1: Schema validation of pipeline.json
 *   Step 2: Coordination cycle detection
 *   Step 3: Resolve repo and worktree paths
 *   Step 4: Set up symlinks (.claude/ and .collab/)
 *   Step 5: Spawn agent pane
 *   Step 6: Create registry atomically
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
import { execSync } from "child_process";
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
  registryCreated?: string;
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
    throw new OrchestratorError(
      "FILE_NOT_FOUND",
      `ajv CLI not found at ${ajvBin}. Run 'bun install' in ${ctx.repoRoot}.`
    );
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
  const specsGlob = path.join(repoRoot, "specs");

  if (fs.existsSync(specsGlob)) {
    for (const entry of fs.readdirSync(specsGlob)) {
      const metadataPath = path.join(specsGlob, entry, "metadata.json");
      if (!fs.existsSync(metadataPath)) continue;

      const metadata = readJsonFile(metadataPath);
      if (!metadata || metadata.ticket_id !== ctx.ticketId) continue;

      const wt = metadata.worktree_path as string | undefined;
      if (!wt) continue;

      if (!fs.existsSync(wt)) {
        throw new OrchestratorError(
          "FILE_NOT_FOUND",
          `Worktree path does not exist: ${wt}`
        );
      }

      worktreePath = wt;
      console.error(`Using worktree: ${worktreePath}`);
      break;
    }
  }

  const spawnCmd = worktreePath
    ? `cd '${worktreePath}' && claude --dangerously-skip-permissions`
    : "claude --dangerously-skip-permissions";

  if (!worktreePath) {
    console.error("No worktree metadata found, using current directory");
  }

  return { repoRoot, worktreePath, spawnCmd };
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

  for (const dir of [".claude", ".collab"] as const) {
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
      else rb.collabSymlinkCreated = dest;
      console.error(`Created ${dir}/ symlink in worktree`);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 5: Spawn agent pane
// ---------------------------------------------------------------------------

export function spawnAgentPane(
  orchestratorPane: string,
  spawnCmd: string,
  ticketId: string,
  rb: RollbackState
): string {
  const tmux = new TmuxClient();
  const agentPane = tmux.splitPane(orchestratorPane, spawnCmd, 70);

  if (!agentPane) {
    throw new OrchestratorError(
      "TMUX",
      `Failed to split pane from ${orchestratorPane}`
    );
  }

  rb.agentPaneCreated = agentPane;

  // Label pane
  tmux.run("select-pane", "-t", agentPane, "-T", ticketId);

  return agentPane;
}

// ---------------------------------------------------------------------------
// Step 6: Create registry
// ---------------------------------------------------------------------------

export function createRegistry(
  ctx: InitContext,
  agentPane: string,
  rb: RollbackState
): { nonce: string; registryPath: string } {
  const nonce = crypto.randomBytes(4).toString("hex").substring(0, 8);

  // Get first phase from pipeline.json
  const pipeline = readJsonFile(ctx.configPath) as CompiledPipeline | null;
  const firstPhase = pipeline?.phases ? Object.keys(pipeline.phases)[0] : "clarify";

  const registryPath = getRegistryPath(ctx.registryDir, ctx.ticketId);
  const registry = {
    orchestrator_pane_id: ctx.orchestratorPane,
    agent_pane_id: agentPane,
    ticket_id: ctx.ticketId,
    nonce,
    current_step: firstPhase,
    color_index: 1,
    phase_history: [],
    started_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };

  writeJsonAtomic(registryPath, registry);
  rb.registryCreated = registryPath;

  return { nonce, registryPath };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

function rollback(rb: RollbackState): void {
  console.error("Rolling back partial initialization...");

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

  for (const symlinkPath of [rb.claudeSymlinkCreated, rb.collabSymlinkCreated]) {
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
    // Step 1: Schema validation
    validateSchema(ctx);

    // Step 2: Coordination check
    runCoordinationCheck(ctx);

    // Step 3: Resolve paths
    const { repoRoot, worktreePath, spawnCmd } = resolvePaths(ctx);

    // Step 4: Symlinks
    setupSymlinks(worktreePath, repoRoot, rb);

    // Step 5: Spawn agent pane
    const agentPane = spawnAgentPane(ctx.orchestratorPane, spawnCmd, ctx.ticketId, rb);

    // Step 6: Create registry
    const { nonce, registryPath } = createRegistry(ctx, agentPane, rb);

    return { agentPane, nonce, registryPath };
  } catch (err) {
    // Any step failure triggers rollback of completed steps
    rollback(rb);
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
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
