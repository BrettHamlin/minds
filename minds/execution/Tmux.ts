#!/usr/bin/env bun

/**
 * Tmux - Tmux window interaction CLI
 *
 * Safe wrapper around tmux send-keys and capture-pane.
 * ALWAYS appends Enter to send-keys calls (the #1 tmux automation failure mode).
 *
 * Usage:
 *   bun Tmux.ts send --window BRE-148 --text "answer text"
 *   bun Tmux.ts send --window BRE-148 --text "/speckit.clarify"
 *   bun Tmux.ts send --window BRE-148 --text "yes" --delay 2
 *   bun Tmux.ts capture --window BRE-148
 *   bun Tmux.ts capture --window BRE-148 --scrollback 100
 *   bun Tmux.ts list
 *
 * @author PAI
 * @version 1.0.0
 */

import { $ } from "bun";
import { parseArgs } from "util";

// ============================================================================
// Types
// ============================================================================

type Command = "send" | "capture" | "list" | "split" | "label" | "pane-exists" | "help";

// ============================================================================
// Colors
// ============================================================================

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ============================================================================
// Core Functions
// ============================================================================

async function listWindows(): Promise<string[]> {
  try {
    const result = await $`tmux list-windows -a -F "#{session_name}:#{window_name}"`.quiet();
    return result.stdout.toString().trim().split("\n").filter(Boolean);
  } catch {
    console.error(c.red("Error: tmux is not running or no sessions exist."));
    process.exit(1);
  }
}

/**
 * Strip tmux suffixes: * (active window) and - (last active window)
 * so "BRE-148*" and "BRE-148-" both match user input "BRE-148"
 */
function stripTmuxSuffix(name: string): string {
  return name.replace(/[*\-]$/, "");
}

async function targetExists(target: string): Promise<boolean> {
  // Pane IDs (%N) — validate directly via tmux
  if (/^%\d+$/.test(target)) {
    try {
      await $`tmux display-message -p -t ${target} '#{pane_id}'`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  // Window IDs (@N) are stable identifiers — validate directly via tmux
  if (/^@\d+$/.test(target)) {
    try {
      await $`tmux display-message -p -t ${target} '#{window_id}'`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  const windows = await listWindows();
  const clean = stripTmuxSuffix(target);
  return windows.some((w) => {
    const windowPart = w.includes(":") ? w.split(":").slice(1).join(":") : w;
    return stripTmuxSuffix(windowPart) === clean || w.includes(clean);
  });
}

async function validateTarget(target: string): Promise<void> {
  if (!(await targetExists(target))) {
    // Pane IDs don't need window listing
    if (/^%\d+$/.test(target)) {
      console.error(c.red(`Error: Pane "${target}" not found.`));
      process.exit(1);
    }
    const windows = await listWindows();
    console.error(c.red(`Error: Window "${target}" not found.`));
    console.error(c.yellow("\nAvailable windows:"));
    for (const w of windows) {
      console.error(`  ${c.dim("•")} ${w}`);
    }
    process.exit(1);
  }
}

async function capturePane(windowName: string, scrollback?: number): Promise<string> {
  const clean = stripTmuxSuffix(windowName);
  await validateTarget(clean);

  try {
    const args = ["-t", clean, "-p"];
    if (scrollback && scrollback > 0) {
      args.push("-S", `-${scrollback}`);
    }

    const result = await $`tmux capture-pane ${args}`.quiet();
    return result.stdout.toString();
  } catch (error: any) {
    console.error(c.red(`Error capturing pane: ${error.message}`));
    process.exit(1);
  }
}

async function sendKeys(
  windowName: string,
  text: string,
  delay: number,
  noEnter: boolean
): Promise<void> {
  const clean = stripTmuxSuffix(windowName);
  await validateTarget(clean);

  try {
    if (noEnter) {
      // Rare escape hatch — send text without Enter
      console.error(c.yellow("⚠ --no-enter: text sent WITHOUT Enter (use with caution)"));
      await $`tmux send-keys -t ${clean} ${text}`.quiet();
    } else {
      // Send text first, then C-m (carriage return) separately.
      // Why two calls: tmux "text C-m" in one send-keys doesn't submit in Claude Code.
      // C-m must arrive as a separate send-keys call to register as submit (\r).
      // Note: tmux "Enter" sends \n which Claude Code treats as newline, not submit.
      await $`tmux send-keys -t ${clean} ${text}`.quiet();

      // Post-text delay: wait between text arrival and Enter press.
      // This gives the target application time to process/render the text
      // before the submit keystroke arrives.
      if (delay > 0) {
        console.error(c.dim(`Waiting ${delay}s before pressing Enter...`));
        await Bun.sleep(delay * 1000);
      }

      await $`tmux send-keys -t ${clean} C-m`.quiet();
    }

    console.error(c.green(`✓ Sent to ${clean}: "${text}"${noEnter ? " (no Enter)" : " + Enter"}`));
  } catch (error: any) {
    console.error(c.red(`Error sending keys: ${error.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Pane Operations
// ============================================================================

/**
 * Split a pane and return the new pane ID.
 * Uses tmux split-window with -P -F to capture the new pane's ID.
 */
async function splitPane(
  targetPane: string,
  horizontal: boolean,
  percentage: number,
  command?: string
): Promise<string> {
  await validateTarget(targetPane);

  try {
    const args: string[] = [];
    if (horizontal) args.push("-h");
    args.push("-p", String(percentage));
    args.push("-t", targetPane);
    args.push("-P", "-F", "#{pane_id}");
    if (command) args.push(command);

    const result = await $`tmux split-window ${args}`.quiet();
    const newPaneId = result.stdout.toString().trim();

    console.error(c.green(`✓ Split ${targetPane} → new pane ${newPaneId}`));
    // Output pane ID to stdout for callers to capture
    console.log(newPaneId);
    return newPaneId;
  } catch (error: any) {
    console.error(c.red(`Error splitting pane: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Label a pane with a title and optionally enable pane border display.
 * Sets pane title via select-pane -T.
 */
async function labelPane(
  targetPane: string,
  title: string,
  colorIndex?: number
): Promise<void> {
  await validateTarget(targetPane);

  try {
    // Set pane title
    await $`tmux select-pane -t ${targetPane} -T ${title}`.quiet();

    // Enable pane border status (idempotent — safe to call multiple times)
    await $`tmux set -g pane-border-status top`.quiet();

    // If color index provided, rebuild the border format
    if (colorIndex !== undefined) {
      await rebuildBorderFormat(targetPane);
    }

    console.error(c.green(`✓ Labeled ${targetPane}: "${title}"${colorIndex ? ` (color ${colorIndex})` : ""}`));
  } catch (error: any) {
    console.error(c.red(`Error labeling pane: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Color palette for pane borders (5 slots max).
 */
const BORDER_COLORS: Record<number, { fg: string; bg: string }> = {
  1: { fg: "white", bg: "blue" },
  2: { fg: "white", bg: "green" },
  3: { fg: "black", bg: "yellow" },
  4: { fg: "white", bg: "magenta" },
  5: { fg: "black", bg: "cyan" },
};

/**
 * Rebuild the pane-border-format string using conditionals based on pane titles.
 * Scans all panes in the current window to build the format.
 */
async function rebuildBorderFormat(targetPane: string): Promise<void> {
  try {
    // Get the window that contains this pane
    const windowResult = await $`tmux display-message -p -t ${targetPane} '#{window_id}'`.quiet();
    const windowId = windowResult.stdout.toString().trim();

    // List all panes in this window with their titles
    const panesResult = await $`tmux list-panes -t ${windowId} -F '#{pane_title}'`.quiet();
    const paneTitles = panesResult.stdout.toString().trim().split("\n").filter(Boolean);

    // Read all registry files to map titles to color indices
    const { getRepoRoot } = await import("../shared/paths.js");
    const repoRoot = getRepoRoot();
    const registryDir = `${repoRoot}/.minds/state/pipeline-registry`;
    let titleColorMap: Record<string, number> = {};
    try {
      const { readdirSync, readFileSync } = await import("fs");
      const { join } = await import("path");
      const files = readdirSync(registryDir).filter((f: string) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(join(registryDir, file), "utf8"));
          if (data.ticket_id && data.color_index) {
            titleColorMap[data.ticket_id] = data.color_index;
          }
        } catch {}
      }
    } catch {}

    // Build conditional format string
    // Default style for orchestrator/unlabeled panes
    let format = "";
    const titlesWithColors = paneTitles.filter((t: string) => titleColorMap[t]);

    if (titlesWithColors.length === 0) {
      format = " #{pane_title} ";
    } else {
      // Build nested conditionals: #{?#{==:#{pane_title},TICKET}, styled , next}
      let inner = "#[default] #{pane_title} ";
      for (const title of titlesWithColors.reverse()) {
        const colorIdx = titleColorMap[title];
        const color = BORDER_COLORS[colorIdx] || BORDER_COLORS[1];
        inner = `#{?#{==:#{pane_title},${title}},#[fg=${color.fg}${","} bg=${color.bg}] ${title} #[default],${inner}}`;
      }
      format = inner;
    }

    await $`tmux set pane-border-format ${format}`.quiet();
  } catch (error: any) {
    // Non-fatal — border format is visual polish
    console.error(c.yellow(`Warning: Could not rebuild border format: ${error.message}`));
  }
}

/**
 * Check if a pane exists. Returns true/false, exits with 0/1.
 */
async function paneExists(paneId: string): Promise<boolean> {
  if (!/^%\d+$/.test(paneId)) {
    console.error(c.red(`Error: "${paneId}" is not a valid pane ID (expected %N format)`));
    process.exit(1);
  }
  return await targetExists(paneId);
}

// ============================================================================
// Help
// ============================================================================

function printHelp(): void {
  console.log(`
${c.bold("Tmux")} — Safe tmux window and pane interaction

${c.yellow("USAGE:")}
  bun Tmux.ts <command> [options]

${c.yellow("COMMANDS:")}
  ${c.green("send")}         Send text to a tmux target (auto-appends Enter)
  ${c.green("capture")}      Capture current screen content from a target
  ${c.green("split")}        Split a pane and return new pane ID
  ${c.green("label")}        Set pane title and enable border display
  ${c.green("pane-exists")}  Check if a pane ID exists (exit 0/1)
  ${c.green("list")}         List all available tmux windows
  ${c.green("help")}         Show this help

${c.yellow("TARGET (-w):")}
  The -w flag accepts window names, window IDs (@N), and pane IDs (%N).
  Pane IDs are the most precise targeting mechanism.

${c.yellow("OPTIONS:")}
  ${c.blue("--window, -w")}      Target: window name, @N (window ID), or %N (pane ID)
  ${c.blue("--text, -t")}        Text to send (required for send)
  ${c.blue("--delay, -d")}       Seconds to wait between text and Enter (default: 0)
  ${c.blue("--no-enter")}        Skip the Enter keystroke (rare escape hatch)
  ${c.blue("--scrollback, -s")}  Lines of scrollback to capture (default: visible only)
  ${c.blue("--horizontal")}      Split horizontally (left/right) instead of vertically
  ${c.blue("--percentage")}      Size percentage for new pane in split (default: 50)
  ${c.blue("--command, -c")}     Command to run in new split pane
  ${c.blue("--title, -T")}       Pane title for label command
  ${c.blue("--color")}           Color index (1-5) for pane border (label command)

${c.yellow("EXAMPLES:")}
  ${c.dim("# Send a command to a pane (Enter is automatic)")}
  bun Tmux.ts send -w %3 -t "/speckit.clarify"

  ${c.dim("# Send to a window by name")}
  bun Tmux.ts send -w BRE-148 -t "yes" -d 1

  ${c.dim("# Split pane horizontally, 70% for new pane")}
  bun Tmux.ts split -w %0 --horizontal --percentage 70 -c "claude --dangerously-skip-permissions"

  ${c.dim("# Label a pane with title and color")}
  bun Tmux.ts label -w %3 -T "BRE-168" --color 1

  ${c.dim("# Check if pane exists")}
  bun Tmux.ts pane-exists -w %3

  ${c.dim("# Capture pane screen")}
  bun Tmux.ts capture -w %3 -s 200

  ${c.dim("# List all windows")}
  bun Tmux.ts list

${c.yellow("SAFETY:")}
  Enter is ALWAYS appended to send-keys unless --no-enter is explicitly used.
  This eliminates the #1 tmux automation failure mode.
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      window: { type: "string", short: "w" },
      text: { type: "string", short: "t" },
      delay: { type: "string", short: "d", default: "0" },
      "no-enter": { type: "boolean", default: false },
      scrollback: { type: "string", short: "s" },
      horizontal: { type: "boolean", default: false },
      percentage: { type: "string", default: "50" },
      command: { type: "string", short: "c" },
      title: { type: "string", short: "T" },
      color: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  const command = (positionals[0] || "help") as Command;

  if (values.help || command === "help") {
    printHelp();
    return;
  }

  switch (command) {
    case "list": {
      const windows = await listWindows();
      console.log(c.bold("Available tmux windows:"));
      for (const w of windows) {
        console.log(`  ${c.dim("•")} ${w}`);
      }
      break;
    }

    case "capture": {
      if (!values.window) {
        console.error(c.red("Error: --window (-w) is required for capture"));
        process.exit(1);
      }
      const scrollback = values.scrollback ? parseInt(values.scrollback, 10) : undefined;
      const content = await capturePane(values.window, scrollback);
      // Output to stdout (not stderr) so it can be captured by callers
      console.log(content);
      break;
    }

    case "send": {
      if (!values.window) {
        console.error(c.red("Error: --window (-w) is required for send"));
        process.exit(1);
      }
      if (!values.text) {
        console.error(c.red("Error: --text (-t) is required for send"));
        process.exit(1);
      }
      const delay = parseFloat(values.delay || "0");
      await sendKeys(values.window, values.text, delay, values["no-enter"] || false);
      break;
    }

    case "split": {
      if (!values.window) {
        console.error(c.red("Error: --window (-w) is required for split"));
        process.exit(1);
      }
      const pct = parseInt(values.percentage || "50", 10);
      await splitPane(values.window, values.horizontal || false, pct, values.command);
      break;
    }

    case "label": {
      if (!values.window) {
        console.error(c.red("Error: --window (-w) is required for label"));
        process.exit(1);
      }
      if (!values.title) {
        console.error(c.red("Error: --title (-T) is required for label"));
        process.exit(1);
      }
      const colorIdx = values.color ? parseInt(values.color, 10) : undefined;
      await labelPane(values.window, values.title, colorIdx);
      break;
    }

    case "pane-exists": {
      if (!values.window) {
        console.error(c.red("Error: --window (-w) is required for pane-exists"));
        process.exit(1);
      }
      const exists = await paneExists(values.window);
      if (exists) {
        console.log("true");
        process.exit(0);
      } else {
        console.log("false");
        process.exit(1);
      }
    }

    default:
      console.error(c.red(`Unknown command: ${command}`));
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(c.red(`Fatal: ${err.message}`));
  process.exit(1);
});
