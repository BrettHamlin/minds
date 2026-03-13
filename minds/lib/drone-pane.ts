#!/usr/bin/env bun
/**
 * minds/lib/drone-pane.ts — Create a worktree and launch a Claude Code Sonnet drone for Minds work.
 *
 * This is the TS implementation for /drone.launch. It replaces /dev.pane for Minds development
 * with key differences:
 *   - Worktree path: {repo}-{repo-alias?}-{ticket-id}-{mind-name} (unique, predictable)
 *   - Writes drone's private CLAUDE.md BEFORE launching Claude Code
 *   - Writes DRONE-BRIEF.md BEFORE launching Claude Code
 *   - Handles worktree .git (file, not dir) for correct .git/info/exclude writes
 *   - Does NOT install collab or pipeline packs
 *   - Launches Sonnet directly
 *
 * Usage:
 *   bun minds/lib/drone-pane.ts \
 *     --mind <mind_name> \
 *     --ticket <ticket_id> \
 *     [--pane <pane_id>]              # caller's tmux pane (default: $TMUX_PANE)
 *     [--mind-pane <pane_id>]        # Mind's pane ID for drone completion signals (default: same as --pane)
 *     [--base <branch>]              # base branch to fork from (default: current branch)
 *     [--claude-file <path>]         # file whose content to write as drone's private CLAUDE.md
 *     [--brief-file <path>]          # file whose content to write as DRONE-BRIEF.md
 *     [--bus-url <url>]             # when provided, injects BUS_URL env var into Claude Code spawn command
 *     [--channel <channel>]          # Minds bus channel (e.g. minds-BRE-456)
 *     [--wave-id <id>]               # wave ID for DRONE_SPAWNED event correlation
 *
 * Output: JSON to stdout
 *   { drone_pane, worktree, branch, base, claude_dir, mind_pane }
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, resolve } from "path";
import { injectBusEnv } from "../transport/minds-bus-lifecycle.ts";
import { publishMindsEvent } from "../transport/publish-event.ts";
import { MindsEventType } from "../transport/minds-events.ts";
import { resolveMindsDir, encodeProjectPath } from "../shared/paths.js";
import { loadStandards } from "./supervisor/supervisor-checks.ts";
import { shellQuote } from "./tmux-utils.ts";
import { TmuxMultiplexer } from "./tmux-multiplexer.ts";
import type { TerminalMultiplexer } from "./terminal-multiplexer.ts";

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Assemble the CLAUDE.md content for a drone, loading minds.json, STANDARDS.md,
 * STANDARDS-project.md, and optional MIND.md from the repo's minds directory.
 */
export function assembleClaudeContent(
  repoRoot: string,
  mindName: string,
  ticketId: string,
  opts?: { repoAlias?: string; orchestratorRoot?: string },
): string {
  const mindsBase = resolveMindsDir(repoRoot);
  const standardsRoot = opts?.orchestratorRoot ?? repoRoot;

  // Load minds.json and find entry for this mind
  const mindsJsonPath = resolve(mindsBase, "minds.json");
  let domain = "";
  let ownsFiles: string[] = [];

  if (existsSync(mindsJsonPath)) {
    try {
      const minds = JSON.parse(readFileSync(mindsJsonPath, "utf-8")) as Array<{
        name: string;
        domain?: string;
        owns_files?: string[];
      }>;
      const entry = minds.find((m) => m.name === mindName);
      if (entry) {
        domain = entry.domain ?? "";
        ownsFiles = entry.owns_files ?? [];
      }
    } catch {
      // If parse fails, continue with empty values
    }
  }

  // Load STANDARDS.md + STANDARDS-project.md from orchestrator root
  const standards = loadStandards(standardsRoot);

  // Load MIND.md (optional)
  const mindMdPath = resolve(mindsBase, mindName, "MIND.md");
  const mindMd = existsSync(mindMdPath) ? readFileSync(mindMdPath, "utf-8") : null;

  const ownsFilesSection =
    ownsFiles.length > 0
      ? ownsFiles.map((f) => `- ${f}`).join("\n")
      : "(no file boundaries defined)";

  const domainLine = domain ? `Domain: ${domain}` : "";

  const mindProfileSection = mindMd
    ? `## Mind Profile (@${mindName})\n${mindMd}`
    : "";

  const repoContextSection = opts?.repoAlias
    ? [
        `## Repository Context`,
        ``,
        `You are working in the **${opts.repoAlias}** repository.`,
        `Other repos in this workspace are read-only references — do not modify files outside this repo.`,
        ``,
      ].join("\n")
    : null;

  return [
    `## Mind Identity`,
    ``,
    `You are the @${mindName} drone for ticket ${ticketId}.`,
    domainLine,
    ``,
    `Your file boundary (only touch files in these paths):`,
    ownsFilesSection,
    ``,
    repoContextSection,
    `## Engineering Standards`,
    standards,
    mindProfileSection,
    `## Test Command`,
    ``,
    `Run only your Mind's tests — never bare \`bun test\`:`,
    `\`\`\``,
    `bun test minds/${mindName}/`,
    `\`\`\``,
    ``,
    `## Active Task`,
    `Your current task brief is in DRONE-BRIEF.md at the worktree root.`,
    `If you've compacted or lost context, re-read that file.`,
  ]
    .filter((line) => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export async function publishDroneSpawned(params: {
  busUrl: string;
  channel: string;
  waveId: string;
  mindName: string;
  paneId: string;
  worktree: string;
  branch: string;
}): Promise<void> {
  const { busUrl, channel, waveId, mindName, paneId, worktree, branch } = params;
  const ticketId = channel.replace(/^minds-/, "");
  await publishMindsEvent(busUrl, channel, {
    type: MindsEventType.DRONE_SPAWNED,
    source: "orchestrator",
    ticketId,
    payload: { mindName, waveId, paneId, worktree, branch },
  });
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) { (async () => {
  const mux: TerminalMultiplexer = new TmuxMultiplexer();

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function run(cmd: string): string {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  }

  function tryRun(cmd: string): string | null {
    try {
      return run(cmd);
    } catch {
      return null;
    }
  }

  function fail(msg: string): never {
    process.stderr.write(JSON.stringify({ error: msg }) + "\n");
    process.exit(1);
  }

  function getArg(flag: string): string | undefined {
    const args = process.argv.slice(2);
    const i = args.indexOf(flag);
    if (i !== -1 && i + 1 < args.length) return args[i + 1];
    return undefined;
  }

  // ─── Parse arguments ────────────────────────────────────────────────────────

  const mindName = getArg("--mind");
  const ticketId = getArg("--ticket");

  if (!mindName) fail("--mind <name> is required");
  if (!ticketId) fail("--ticket <ticket_id> is required");

  const callerPane =
    getArg("--pane") ??
    mux.getCurrentPane();

  const mindPane = getArg("--mind-pane") ?? callerPane;

  const claudeFile = getArg("--claude-file");
  const briefFile = getArg("--brief-file");
  const busUrl = getArg("--bus-url");
  const channel = getArg("--channel");
  const waveId = getArg("--wave-id");

  // ─── Repo context ────────────────────────────────────────────────────────────

  const overrideRepoRoot = getArg("--repo-root");
  const repoRoot = overrideRepoRoot ?? run("git rev-parse --show-toplevel");
  const repoName = basename(repoRoot);
  const repoAlias = getArg("--repo-alias");
  const installCmd = getArg("--install-cmd");
  const orchestratorRoot = getArg("--orchestrator-root");

  // ─── Base branch ─────────────────────────────────────────────────────────────

  const baseBranch = getArg("--base") ?? run(`git -C ${shellQuote(repoRoot)} branch --show-current`);

  // CRITICAL: fetch/pull must target the MIND's repo, not orchestrator
  tryRun(`git -C ${shellQuote(repoRoot)} fetch origin`);
  tryRun(`git -C ${shellQuote(repoRoot)} pull origin ${shellQuote(baseBranch)}`);

  // ─── Branch and worktree path ─────────────────────────────────────────────────

  // Branch: minds/{ticketId}-{mindName}
  const branchName = `minds/${ticketId}-${mindName}`;

  // Worktree path: collab-dev-{ticketId}-{mindName}, with numeric suffix if taken
  const parentDir = resolve(repoRoot, "..");
  let worktreeBase = repoAlias
    ? `${repoName}-${repoAlias}-${ticketId}-${mindName}`
    : `${repoName}-${ticketId}-${mindName}`;
  let worktreePath = resolve(parentDir, worktreeBase);
  let suffix = 2;
  while (existsSync(worktreePath)) {
    worktreePath = resolve(parentDir, `${worktreeBase}-${suffix}`);
    suffix++;
  }

  // ─── Create worktree ──────────────────────────────────────────────────────────

  // Delete stale branch if it exists from a previous cleaned-up worktree
  tryRun(`git branch -D ${shellQuote(branchName)} 2>/dev/null`);

  try {
    run(`git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branchName)} ${shellQuote(baseBranch)}`);
  } catch (err) {
    fail(`Failed to create worktree at ${worktreePath}: ${err}`);
  }

  // ─── Install dependencies ─────────────────────────────────────────────────────

  // node_modules is gitignored and never present in fresh worktrees
  try {
    if (installCmd) {
      const result = Bun.spawnSync(["sh", "-c", installCmd], { cwd: worktreePath, stdout: "inherit", stderr: "inherit" });
      if (result.exitCode !== 0) throw new Error(`Install command failed with exit code ${result.exitCode}`);
    } else {
      run(`bun install --cwd ${shellQuote(worktreePath)}`);
    }
  } catch (err) {
    // Non-fatal: some Minds don't need node_modules
    process.stderr.write(`Warning: install failed: ${err}\n`);
  }

  // ─── Write .git/info/exclude (worktree-safe) ─────────────────────────────────

  // In a worktree, .git is a FILE containing "gitdir: /path/to/real/gitdir"
  // We must read it to find the real gitdir, not assume it's a directory.
  const gitPointer = resolve(worktreePath, ".git");
  let realGitdir: string;
  try {
    const content = readFileSync(gitPointer, "utf-8").trim();
    if (content.startsWith("gitdir: ")) {
      realGitdir = content.slice("gitdir: ".length).trim();
    } else {
      // Already a directory (shouldn't happen in a worktree, but handle it)
      realGitdir = gitPointer;
    }
  } catch {
    realGitdir = resolve(worktreePath, ".git");
  }

  const excludeDir = resolve(realGitdir, "info");
  const excludePath = resolve(excludeDir, "exclude");
  mkdirSync(excludeDir, { recursive: true });

  const excludeEntries = ["DRONE-BRIEF.md", "CLAUDE.md"];
  let existingExclude = "";
  if (existsSync(excludePath)) {
    existingExclude = readFileSync(excludePath, "utf-8");
  }
  for (const entry of excludeEntries) {
    if (!existingExclude.includes(entry)) {
      writeFileSync(excludePath, existingExclude + (existingExclude.endsWith("\n") || existingExclude === "" ? "" : "\n") + entry + "\n");
      existingExclude += entry + "\n";
    }
  }

  // ─── Write drone's private CLAUDE.md BEFORE launching ────────────────────────

  const encoded = encodeProjectPath(resolve(worktreePath));
  const claudeDir = resolve(process.env.HOME ?? "/root", ".claude", "projects", encoded);
  mkdirSync(claudeDir, { recursive: true });

  const claudeContent = claudeFile && existsSync(claudeFile)
    ? readFileSync(claudeFile, "utf-8")
    : assembleClaudeContent(repoRoot, mindName!, ticketId!, {
        repoAlias: repoAlias,
        orchestratorRoot: orchestratorRoot,
      });

  writeFileSync(resolve(claudeDir, "CLAUDE.md"), claudeContent);

  // Also write to worktree root so explicit Read("CLAUDE.md") gets the drone instructions
  writeFileSync(resolve(worktreePath, "CLAUDE.md"), claudeContent);

  // ─── Write .claude/settings.json with hooks config BEFORE launching ──────────

  const settingsPath = resolve(worktreePath, ".claude", "settings.json");
  const hookScriptPath = resolve(resolveMindsDir(orchestratorRoot ?? repoRoot), "transport", "hooks", "send-event.ts");
  const hookCommand = `bun ${hookScriptPath} --source-app drone:${mindName}`;

  // Claude Code hooks use matcher-based format: { matcher?: string, hooks: [{ type, command }] }
  const hookWrapper = { hooks: [{ type: "command", command: hookCommand }] };
  const hooksConfig: Record<string, unknown[]> = {
    SubagentStart: [hookWrapper],
    SubagentStop: [hookWrapper],
    PreToolUse: [hookWrapper],
    PostToolUse: [hookWrapper],
    PostToolUseFailure: [hookWrapper],
    Stop: [hookWrapper],
  };

  let existingSettings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      existingSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // Malformed settings — overwrite
    }
  }

  const worktreeClaudeDir = resolve(worktreePath, ".claude");
  mkdirSync(worktreeClaudeDir, { recursive: true });
  writeFileSync(
    settingsPath,
    JSON.stringify({ ...existingSettings, hooks: hooksConfig }, null, 2),
  );

  // ─── Write DRONE-BRIEF.md BEFORE launching ────────────────────────────────────

  const briefContent = briefFile && existsSync(briefFile)
    ? readFileSync(briefFile, "utf-8")
    : `# Drone Brief\n\nYou are the @${mindName} drone for ticket ${ticketId}.\n\nAwaiting task brief from the Mind.\n`;

  writeFileSync(resolve(worktreePath, "DRONE-BRIEF.md"), briefContent);

  // ─── Split tmux pane ──────────────────────────────────────────────────────────

  let dronePane: string;
  try {
    dronePane = mux.splitPane(callerPane);
  } catch (err) {
    fail(`Failed to split tmux pane: ${err}`);
  }

  // ─── Launch Claude Code Sonnet (no collab/pipeline pack install) ──────────────

  const initialPrompt = `Read DRONE-BRIEF.md and complete all tasks. When done, run the completion command at the bottom of the brief.`;
  let launchCmd = `cd ${shellQuote(worktreePath)} && claude --dangerously-skip-permissions --model sonnet --setting-sources project,local ${JSON.stringify(initialPrompt)}`;
  if (busUrl) {
    launchCmd = injectBusEnv(launchCmd, busUrl);
  }
  mux.sendKeys(dronePane, launchCmd);

  // ─── Publish DRONE_SPAWNED if bus is configured ────────────────────────────────

  if (busUrl && channel && waveId) {
    await publishDroneSpawned({
      busUrl,
      channel,
      waveId,
      mindName: mindName!,
      paneId: dronePane!,
      worktree: worktreePath,
      branch: branchName,
    });
  }

  // ─── Output result ────────────────────────────────────────────────────────────

  console.log(
    JSON.stringify({
      drone_pane: dronePane,
      worktree: worktreePath,
      branch: branchName,
      base: baseBranch,
      claude_dir: claudeDir,
      mind_pane: mindPane,
    })
  );
})(); }
