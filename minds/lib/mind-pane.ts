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
 *     [--max-iterations <n>]         # max review iterations before approving with warnings (default: 10)
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
import { buildMindBusPublishCmds } from "../cli/lib/mind-brief.ts";
import type { MindBusPublishCmds } from "../cli/lib/mind-brief.ts";
import { resolveMindsDir } from "../shared/paths.js";
import { shellQuote } from "./tmux-utils.ts";
import { TmuxMultiplexer } from "./tmux-multiplexer.ts";
import type { TerminalMultiplexer } from "./terminal-multiplexer.ts";

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
  busPublishCmds?: MindBusPublishCmds,
  baseBranch?: string,
): string {
  // Resolve minds/ vs .minds/ — single source of truth for all paths
  const mindsDir = resolveMindsDir(repoRoot);

  // Load minds.json and find entry for this mind
  const mindsJsonPath = resolve(mindsDir, "minds.json");
  let domain = "";
  let ownsFiles: string[] = [];
  let exposes: string[] = [];
  let consumes: string[] = [];

  if (existsSync(mindsJsonPath)) {
    try {
      const minds = JSON.parse(readFileSync(mindsJsonPath, "utf-8")) as Array<{
        name: string;
        domain?: string;
        owns_files?: string[];
        exposes?: string[];
        consumes?: string[];
      }>;
      const entry = minds.find((m) => m.name === mindName);
      if (entry) {
        domain = entry.domain ?? "";
        ownsFiles = entry.owns_files ?? [];
        exposes = entry.exposes ?? [];
        consumes = entry.consumes ?? [];
      }
    } catch {
      // If parse fails, continue with empty values
    }
  }

  // Load STANDARDS.md (generic — ships with installer)
  const standardsPath = resolve(mindsDir, "STANDARDS.md");
  const standards = existsSync(standardsPath) ? readFileSync(standardsPath, "utf-8") : "";

  // Load STANDARDS-project.md (project-specific — NOT shipped by installer)
  const projectStandardsPath = resolve(mindsDir, "STANDARDS-project.md");
  const projectStandards = existsSync(projectStandardsPath) ? readFileSync(projectStandardsPath, "utf-8") : "";

  // Load MIND.md (optional)
  const mindMdPath = resolve(mindsDir, mindName, "MIND.md");
  const mindMd = existsSync(mindMdPath) ? readFileSync(mindMdPath, "utf-8") : null;

  // ── Build sections ──────────────────────────────────────────────────────────

  const ownsFilesSection = ownsFiles.length > 0
    ? ownsFiles.map((f) => `- \`${f}\``).join("\n")
    : "(no file boundaries defined)";

  const contractRows: string[] = [];
  for (const e of exposes) contractRows.push(`| **Exposes** | \`${e}\` |`);
  for (const c of consumes) contractRows.push(`| **Consumes** | \`${c}\` |`);
  const contractsTable = contractRows.length > 0
    ? `| Direction | Path |\n|-----------|------|\n${contractRows.join("\n")}`
    : "(none defined)";

  const signalBlock = (cmd: string | undefined): string =>
    cmd ? `\`\`\`bash\n${cmd}\n\`\`\`` : "(bus not configured)";

  const mindProfileSection = mindMd
    ? `---\n\n# 🧬 Mind Profile (@${mindName})\n\n${mindMd}`
    : "";

  const projectStandardsSection = projectStandards
    ? `\n\n## Project-Specific Standards\n\n${projectStandards}`
    : "";

  // #2+#3: Conditional file boundary section
  const fileBoundarySection = ownsFiles.length > 0
    ? `# 🚨 File Boundary

**NEVER modify files outside your \`owns_files\` boundary.**

${ownsFilesSection}

---`
    : `# 🚨 File Boundary

This Mind has unrestricted file access. No \`owns_files\` boundary is defined.

---`;

  // #2+#3: Conditional contracts section
  const contractsSection = contractRows.length > 0
    ? `# 📋 Contracts

${contractsTable}

**Honor these exactly.** Exposes are exported at their declared paths. Consumes are imported, never reimplemented.

---`
    : "";

  // #4: Build deterministic contract check command (runs check-contracts.ts)
  // The script parses produces:/consumes: annotations from MIND-BRIEF.md
  // and verifies actual source files match. Exit 0 = pass, exit 1 = violation.
  const checkContractsPath = resolve(mindsDir, "lib", "check-contracts.ts");
  const hasContractChecker = existsSync(checkContractsPath);
  const contractCheckCmd = hasContractChecker
    ? `
**📋 Contract Check (MANDATORY — run before manual review):**
\`\`\`bash
bun ${mindsDir}/lib/check-contracts.ts --mind ${mindName} --tasks MIND-BRIEF.md --repo-root .
\`\`\`
If this script exits with code 1, there are contract violations. These are **blocking**:
1. Copy the script's violation output **verbatim** into REVIEW-FEEDBACK-{n}.md as checklist items
2. The output tells the drone exactly what's wrong and how to fix it (which file, which function, import vs local)
3. Do NOT approve with contract violations — resume the drone to fix them
If it exits with code 0, contracts are verified — proceed with manual review.
`
    : "";

  // #5: Resolve base branch for git diff
  const diffBase = baseBranch ?? "main";

  return `---
name: Mind Operating Manual
role: Static identity, process, and standards for the 🧠 Mind supervisor
scope: Same across all tasks for this Mind — re-read after compaction
---

${fileBoundarySection}

# 🧠 Mind Identity

You are the 🧠 @${mindName} Mind (supervisor) for ticket ${ticketId}.
${domain ? `Domain: ${domain}\n` : ""}
| Role | Emoji | Example |
|------|-------|---------|
| **You** (supervisor) | 🧠 | "🧠 I reviewed the diff", "🧠 Found a DRY violation" |
| **Drone** (code worker) | 🛸 | "🛸 Drone missed...", "🛸 Drone's changes..." |

---

${contractsSection}

# 🔁 Review Loop

You supervise a 🛸 Drone that does the implementation work. Follow this process exactly (max 10 iterations).

━━━ 1. READ ━━━
Read MIND-BRIEF.md for your task assignment.
Read your memory at \`${mindsDir}/${mindName}/memory/MEMORY.md\` for context from previous reviews.
Search memory for task-relevant context:
\`\`\`bash
bun ${mindsDir}/memory/lib/search-cli.ts --mind ${mindName} --query "<keywords from your task>"
\`\`\`

━━━ 2. SIGNAL ━━━
${signalBlock(busPublishCmds?.started)}

━━━ 3. SPAWN ━━━
\`\`\`
Agent({ subagent_type: '🛸', prompt: 'Read DRONE-BRIEF.md and complete all tasks. Commit when done.' })
\`\`\`
Save the returned agent ID.

━━━ 4. WAIT ━━━
🛸 Drone works autonomously. When it returns → step 5.

━━━ 5. SIGNAL ━━━
${signalBlock(busPublishCmds?.reviewStarted)}

━━━ 6. REVIEW ━━━
Verify all tasks from MIND-BRIEF.md are implemented, then evaluate the diff:
\`\`\`bash
git diff ${diffBase}...HEAD
\`\`\`
${contractCheckCmd}Evaluate against the **full Review Checklist** in Engineering Standards below.
**On re-review after feedback:** Run the COMPLETE checklist again, not just the items you flagged. Fixes can introduce new issues.

━━━ 7. VERDICT ━━━

**❌ ANY issues found (including minor ones — unused imports, inefficiencies, missing edge cases, style violations):**
Every finding is a fix. Do NOT approve with known issues.

Write ALL findings to a checklist file so the drone can track progress:
\`\`\`bash
# Write REVIEW-FEEDBACK-{n}.md at the worktree root (n = review iteration, starting at 1)
# Use this exact checklist format:
cat > REVIEW-FEEDBACK-1.md << 'FEEDBACK'
# Review Feedback (Round 1)

- [ ] Issue 1: description of the issue, what file, what to fix
- [ ] Issue 2: description of the issue, what file, what to fix
- [ ] Issue 3: ...
FEEDBACK
\`\`\`
Increment the number for each round (REVIEW-FEEDBACK-1.md, REVIEW-FEEDBACK-2.md, etc.).

${signalBlock(busPublishCmds?.reviewFeedback)}
Then resume 🛸 Drone. Use this EXACT prompt (replace {n} with the round number):
\`\`\`
Agent({ resume: '{agentId}', prompt: 'Read REVIEW-FEEDBACK-{n}.md at the worktree root. It contains a checklist of issues to fix. For each item: fix the issue, then edit the file to check off the checkbox (change [ ] to [x]). Commit when all items are checked off.' })
\`\`\`
Do NOT paraphrase or summarize the issues in the prompt — the feedback file IS the prompt.

| ✅ Correct resume prompt | ❌ Wrong resume prompt |
|--------------------------|----------------------|
| \`'Read REVIEW-FEEDBACK-1.md at the worktree root...'\` | \`'Fix the async bug and DRY violation'\` |
| | \`'Fix review feedback round 1'\` |
| | \`'Fix these issues: 1. ...'\` |
→ Go to step 5.

**✅ Approved (ONLY when zero issues found):**
a. Flush memory with key insights from this review:
\`\`\`bash
bun ${mindsDir}/memory/lib/write-cli.ts --mind ${mindName} --content "<insight>"
\`\`\`
b. Signal completion:
${signalBlock(busPublishCmds?.complete)}

**⚠️ Max iterations (10) reached:**
Approve with warnings. Flush unresolved issues to memory (step 7a), then signal completion (step 7b).

---

# ⚙️ Engineering Standards

${standards}${projectStandardsSection}

${mindProfileSection}

---

# 💾 Memory

Your curated memory: \`${mindsDir}/${mindName}/memory/MEMORY.md\` — read at start of each task.

\`\`\`bash
# Search (hybrid BM25 + vector)
bun ${mindsDir}/memory/lib/search-cli.ts --mind ${mindName} --query "<search text>"

# Write (append to daily log — same command as Review Loop step 7a)
bun ${mindsDir}/memory/lib/write-cli.ts --mind ${mindName} --content "<insight>"
\`\`\`

| ✅ Write | ❌ Don't Write |
|----------|---------------|
| Architectural decisions | Trivial passes |
| Pattern violations found | Session-specific context |
| DRY opportunities identified | In-progress state |
| Contract gaps discovered | Won't apply to future reviews |

**🛸 Drone does NOT have memory access. Memory is 🧠 Mind-only.**

---

# 🧪 Test Command

\`\`\`
bun test ${mindsDir}/${mindName}/
\`\`\`

**Never bare \`bun test\`.** It runs all tests across the entire repo.

---

# 📎 Active Task

Your current task brief is in **MIND-BRIEF.md** at the worktree root.
If you've compacted or lost context, re-read that file.`.replace(/\n{3,}/g, "\n\n");
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

  const claudeFile = getArg("--claude-file");
  const briefFile = getArg("--brief-file");
  const busUrl = getArg("--bus-url");
  const channel = getArg("--channel");
  const waveId = getArg("--wave-id");
  const maxIterations = parseInt(getArg("--max-iterations") ?? "10", 10);

  // ─── Repo context ────────────────────────────────────────────────────────────

  const repoRoot = run("git rev-parse --show-toplevel");
  const repoName = basename(repoRoot);

  // ─── Base branch ─────────────────────────────────────────────────────────────

  const baseBranch = getArg("--base") ?? run("git branch --show-current");

  tryRun(`git fetch origin`);
  tryRun(`git pull origin ${shellQuote(baseBranch)}`);

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
  tryRun(`git branch -D ${shellQuote(branchName)} 2>/dev/null`);

  try {
    run(`git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branchName)} ${shellQuote(baseBranch)}`);
  } catch (err) {
    fail(`Failed to create worktree at ${worktreePath}: ${err}`);
  }

  // ─── Install dependencies ─────────────────────────────────────────────────────

  // node_modules is gitignored and never present in fresh worktrees
  try {
    run(`bun install --cwd ${shellQuote(worktreePath)}`);
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

  const excludeEntries = ["MIND-BRIEF.md", "DRONE-BRIEF.md", "CLAUDE.md", "REVIEW-FEEDBACK-*.md"];
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

  // ─── Resolve minds dir and build bus commands ────────────────────────────────

  const mindsDir = resolveMindsDir(repoRoot);
  const busCmds = (channel && waveId)
    ? buildMindBusPublishCmds(mindsDir, channel, mindName!, waveId)
    : undefined;

  const claudeContent = claudeFile && existsSync(claudeFile)
    ? readFileSync(claudeFile, "utf-8")
    : assembleClaudeContent(repoRoot, mindName!, ticketId!, busCmds, baseBranch);

  writeFileSync(resolve(claudeDir, "CLAUDE.md"), claudeContent);

  // Also write to worktree root so explicit Read("CLAUDE.md") gets the operating manual
  // (the repo's checked-in CLAUDE.md is generic; this overwrites it in the worktree only)
  writeFileSync(resolve(worktreePath, "CLAUDE.md"), claudeContent);

  // ─── Write .claude/settings.json with hooks config BEFORE launching ──────────

  const settingsPath = resolve(worktreePath, ".claude", "settings.json");
  const hookScriptPath = resolve(mindsDir, "transport", "hooks", "send-event.ts");
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
    mindPane = mux.splitPane(callerPane);
  } catch (err) {
    fail(`Failed to split tmux pane: ${err}`);
  }

  // ─── Launch Claude Code Opus ──────────────────────────────────────────────────

  const initialPrompt = `You are a 🧠 Mind supervisor. Your CLAUDE.md has been replaced with your operating manual — read it now. Then read MIND-BRIEF.md for your tasks. Follow the Review Loop exactly: do NOT implement tasks yourself. Spawn a 🛸 Drone via Agent({ subagent_type: '🛸' }) to do the work.`;
  let launchCmd = `cd ${shellQuote(worktreePath)} && claude --dangerously-skip-permissions --model opus ${JSON.stringify(initialPrompt)}`;
  if (busUrl) {
    launchCmd = injectBusEnv(launchCmd, busUrl);
  }
  mux.sendKeys(mindPane, launchCmd);

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
