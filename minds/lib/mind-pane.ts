#!/usr/bin/env bun
/**
 * minds/lib/mind-pane.ts — Create a worktree and launch a Claude Code Opus Mind (supervisor).
 *
 * Modeled on drone-pane.ts with key differences:
 *   - Launches as Mind (supervisor), not drone
 *   - Writes MIND-BRIEF.md (not DRONE-BRIEF.md)
 *   - Launches with --model opus
 *   - CLAUDE.md includes Review Loop Instructions for spawning/reviewing drones
 *   - source-app hook: mind:{mindName}
 *
 * Usage:
 *   bun minds/lib/mind-pane.ts \
 *     --mind <mind_name> \
 *     --ticket <ticket_id> \
 *     [--pane <pane_id>]              # caller's tmux pane (default: $TMUX_PANE)
 *     [--base <branch>]              # base branch to fork from (default: current branch)
 *     [--claude-file <path>]         # file whose content to write as Mind's private CLAUDE.md
 *     [--brief-file <path>]          # file whose content to write as MIND-BRIEF.md
 *     [--bus-url <url>]             # when provided, injects BUS_URL env var into Claude Code spawn command
 *     [--channel <channel>]          # Minds bus channel (e.g. minds-BRE-456)
 *     [--wave-id <id>]               # wave ID for DRONE_SPAWNED event correlation
 *     [--max-iterations <n>]         # max review iterations before approving with warnings (default: 3)
 *
 * Output: JSON to stdout
 *   { mind_pane, worktree, branch, base, claude_dir }
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, resolve } from "path";
import { injectBusEnv } from "../transport/minds-bus-lifecycle.ts";
import { publishMindsEvent } from "../transport/publish-event.ts";
import { MindsEventType } from "../transport/minds-events.ts";

// ─── Exported API ─────────────────────────────────────────────────────────────

export async function publishMindSpawned(params: {
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

// ─── assembleClaudeContent — exported for testing ─────────────────────────────

export function assembleClaudeContent(
  repoRoot: string,
  mindName: string,
  ticketId: string,
  maxIterations: number = 3,
): string {
  // Load minds.json and find entry for this mind
  const mindsJsonPath = resolve(repoRoot, ".minds", "minds.json");
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

  // Load STANDARDS.md
  const standardsPath = resolve(repoRoot, "minds", "STANDARDS.md");
  const standards = existsSync(standardsPath) ? readFileSync(standardsPath, "utf-8") : "";

  // Load MIND.md (optional)
  const mindMdPath = resolve(repoRoot, "minds", mindName, "MIND.md");
  const mindMd = existsSync(mindMdPath) ? readFileSync(mindMdPath, "utf-8") : null;

  const ownsFilesSection =
    ownsFiles.length > 0
      ? ownsFiles.map((f) => `- ${f}`).join("\n")
      : "(no file boundaries defined)";

  const domainLine = domain ? `Domain: ${domain}` : "";

  const mindProfileSection = mindMd
    ? `## Mind Profile (@${mindName})\n${mindMd}`
    : "";

  return [
    `## Mind Identity`,
    ``,
    `You are the @${mindName} Mind (supervisor) for ticket ${ticketId}.`,
    domainLine,
    ``,
    `Your file boundary (only touch files in these paths):`,
    ownsFilesSection,
    ``,
    `## Engineering Standards`,
    standards,
    mindProfileSection,
    `## Review Loop Instructions`,
    ``,
    `You supervise drone agents that do the implementation work. Follow this loop:`,
    ``,
    `1. **Spawn a drone** using the Agent tool:`,
    `   \`\`\``,
    `   Agent({ subagent_type: 'drone', prompt: 'Read DRONE-BRIEF.md and complete all tasks. Commit when done.' })`,
    `   \`\`\``,
    `   Save the returned agent ID for later use.`,
    ``,
    `2. **Review the diff** after the drone returns:`,
    `   \`\`\``,
    `   git diff {base}...HEAD`,
    `   \`\`\``,
    `   Evaluate correctness, test coverage, and adherence to standards.`,
    ``,
    `3. **If issues are found**, resume the agent with specific feedback:`,
    `   \`\`\``,
    `   Agent({ resume: '{agentId}', prompt: 'Fix: {specific feedback}' })`,
    `   \`\`\``,
    `   Then re-review the diff.`,
    ``,
    `4. **Max iterations:** ${maxIterations}. After ${maxIterations} review cycles, approve with warnings if issues remain.`,
    ``,
    `5. **Send bus events** using the publish commands defined in MIND-BRIEF.md to report`,
    `   progress and completion back to the orchestrating Mind.`,
    ``,
    `## Test Command`,
    ``,
    `Run only your Mind's tests — never bare \`bun test\`:`,
    `\`\`\``,
    `bun test minds/${mindName}/`,
    `\`\`\``,
    ``,
    `## Active Task`,
    `Your current task brief is in MIND-BRIEF.md at the worktree root.`,
    `If you've compacted or lost context, re-read that file.`,
  ]
    .filter((line) => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) { (async () => {
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
    process.env.TMUX_PANE ??
    run("tmux display-message -p '#{pane_id}'");

  const claudeFile = getArg("--claude-file");
  const briefFile = getArg("--brief-file");
  const busUrl = getArg("--bus-url");
  const channel = getArg("--channel");
  const waveId = getArg("--wave-id");
  const maxIterations = parseInt(getArg("--max-iterations") ?? "3", 10);

  // ─── Repo context ────────────────────────────────────────────────────────────

  const repoRoot = run("git rev-parse --show-toplevel");
  const repoName = basename(repoRoot);

  // ─── Base branch ─────────────────────────────────────────────────────────────

  const baseBranch = getArg("--base") ?? run("git branch --show-current");

  tryRun(`git fetch origin`);
  tryRun(`git pull origin ${baseBranch}`);

  // ─── Branch and worktree path ─────────────────────────────────────────────────

  // Branch: minds/{ticketId}-{mindName}-supervisor
  const branchName = `minds/${ticketId}-${mindName}-supervisor`;

  // Worktree path: {repoName}-{ticketId}-{mindName}-supervisor, with numeric suffix if taken
  const parentDir = resolve(repoRoot, "..");
  let worktreeBase = `${repoName}-${ticketId}-${mindName}-supervisor`;
  let worktreePath = resolve(parentDir, worktreeBase);
  let suffix = 2;
  while (existsSync(worktreePath)) {
    worktreePath = resolve(parentDir, `${worktreeBase}-${suffix}`);
    suffix++;
  }

  // ─── Create worktree ──────────────────────────────────────────────────────────

  // Delete stale branch if it exists from a previous cleaned-up worktree
  tryRun(`git branch -D "${branchName}" 2>/dev/null`);

  try {
    run(`git worktree add "${worktreePath}" -b "${branchName}" "${baseBranch}"`);
  } catch (err) {
    fail(`Failed to create worktree at ${worktreePath}: ${err}`);
  }

  // ─── Install dependencies ─────────────────────────────────────────────────────

  // node_modules is gitignored and never present in fresh worktrees
  try {
    run(`bun install --cwd "${worktreePath}"`);
  } catch (err) {
    // Non-fatal: some Minds don't need node_modules
    process.stderr.write(`Warning: bun install failed: ${err}\n`);
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

  const excludeEntries = ["MIND-BRIEF.md"];
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

  // ─── Write Mind's private CLAUDE.md BEFORE launching ─────────────────────────

  const encoded = resolve(worktreePath).replace(/\//g, "-").replace(/^-/, "");
  const claudeDir = resolve(process.env.HOME ?? "/root", ".claude", "projects", encoded);
  mkdirSync(claudeDir, { recursive: true });

  const claudeContent = claudeFile && existsSync(claudeFile)
    ? readFileSync(claudeFile, "utf-8")
    : assembleClaudeContent(repoRoot, mindName!, ticketId!, maxIterations);

  writeFileSync(resolve(claudeDir, "CLAUDE.md"), claudeContent);

  // ─── Write .claude/settings.json with hooks config BEFORE launching ──────────

  const settingsPath = resolve(worktreePath, ".claude", "settings.json");
  const hooksBase = existsSync(resolve(repoRoot, ".minds")) ? ".minds" : "minds";
  const hookScriptPath = resolve(repoRoot, hooksBase, "transport", "hooks", "send-event.ts");
  const hookCommand = `bun ${hookScriptPath} --source-app mind:${mindName}`;

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

  // ─── Write MIND-BRIEF.md BEFORE launching ─────────────────────────────────────

  const briefContent = briefFile && existsSync(briefFile)
    ? readFileSync(briefFile, "utf-8")
    : `# Mind Brief\n\nYou are the @${mindName} Mind (supervisor) for ticket ${ticketId}.\n\nAwaiting task brief.\n`;

  writeFileSync(resolve(worktreePath, "MIND-BRIEF.md"), briefContent);

  // ─── Split tmux pane ──────────────────────────────────────────────────────────

  let mindPane: string;
  try {
    mindPane = run(`tmux split-window -h -p 50 -t ${callerPane} -P -F '#{pane_id}'`);
  } catch (err) {
    fail(`Failed to split tmux pane: ${err}`);
  }

  // ─── Launch Claude Code Opus ──────────────────────────────────────────────────

  const initialPrompt = `Read MIND-BRIEF.md and begin the review loop.`;
  let launchCmd = `cd ${worktreePath} && claude --dangerously-skip-permissions --model opus ${JSON.stringify(initialPrompt)}`;
  if (busUrl) {
    launchCmd = injectBusEnv(launchCmd, busUrl);
  }
  run(`tmux send-keys -t ${mindPane} '${launchCmd}' Enter`);

  // ─── Publish DRONE_SPAWNED if bus is configured ────────────────────────────────

  if (busUrl && channel && waveId) {
    await publishMindSpawned({
      busUrl,
      channel,
      waveId,
      mindName: mindName!,
      paneId: mindPane!,
      worktree: worktreePath,
      branch: branchName,
    });
  }

  // ─── Output result ────────────────────────────────────────────────────────────

  console.log(
    JSON.stringify({
      mind_pane: mindPane,
      worktree: worktreePath,
      branch: branchName,
      base: baseBranch,
      claude_dir: claudeDir,
    })
  );
})(); }
