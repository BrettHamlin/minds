/**
 * mind-brief.ts -- Build MIND-BRIEF.md content as a TypeScript template.
 *
 * The brief is the task-specific work order for a Mind. It contains ONLY
 * what changes per run: tasks, dependencies, and bus commands.
 *
 * Identity, standards, review process, and memory access are in CLAUDE.md
 * (assembled by mind-pane.ts). The brief should not duplicate those.
 */

import type { MindTask } from "./implement-types.ts";
import { formatTaskList } from "./drone-brief.ts";

export interface MindBusPublishCmds {
  started: string;
  reviewStarted: string;
  reviewFeedback: string;
  complete: string;
}

export interface MindBriefParams {
  ticketId: string;
  mindName: string;
  waveId: string;
  featureDir: string;
  tasks: MindTask[];
  dependencies: string[];
  worktreePath: string;
}

/**
 * Build the MIND-BRIEF.md content for a Mind.
 */
export function buildMindBrief(params: MindBriefParams): string {
  const {
    ticketId,
    mindName,
    waveId,
    featureDir,
    tasks,
    dependencies,
    worktreePath,
  } = params;

  const taskList = formatTaskList(tasks);

  const depsSection = dependencies.length > 0
    ? `\n---\n\n## 🔗 Dependencies\n\n${dependencies.map((d) => `@${d}`).join(", ")} — completed and merged in previous waves.\n`
    : "";

  return `---
name: Work Order
role: Ephemeral task assignment — tasks, dependencies, metadata
scope: Changes per run — this is your current assignment
---

Process this work order using the Review Loop in your operating manual (CLAUDE.md).

# 📋 Work Order: @${mindName}

| Field | Value |
|-------|-------|
| **Ticket** | ${ticketId} |
| **Wave** | ${waveId} |
| **Feature** | ${featureDir} |
| **Worktree** | ${worktreePath} |

---

## 🛸 Drone Tasks

${taskList}

---

## ✅ Completion Criteria

All tasks above are checked off AND all tests pass.
${depsSection}`;
}

/**
 * Build all 4 bus publish commands for a Mind's lifecycle signals.
 */
export function buildMindBusPublishCmds(
  mindsDir: string,
  channel: string,
  mindName: string,
  waveId: string,
): MindBusPublishCmds {
  const base = `bun ${mindsDir}/transport/minds-publish.ts --channel ${channel}`;
  const payload = JSON.stringify({ mindName, waveId });

  return {
    started: `${base} --type MIND_STARTED --payload '${payload}'`,
    reviewStarted: `${base} --type REVIEW_STARTED --payload '${payload}'`,
    reviewFeedback: `${base} --type REVIEW_FEEDBACK --payload '${payload}'`,
    complete: `${base} --type MIND_COMPLETE --payload '${payload}'`,
  };
}
