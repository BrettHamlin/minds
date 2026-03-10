/**
 * mind-brief.ts -- Build MIND-BRIEF.md content as a TypeScript template.
 *
 * The brief is what each Mind receives as its work instructions.
 * It includes the tasks assigned to the mind, review loop instructions,
 * and bus publish commands for signaling pipeline events.
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
  mindMdPath: string;
  memoryMdPath: string;
  maxReviewIterations?: number;
  worktreePath: string;
  busPublishCmds: MindBusPublishCmds;
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
    mindMdPath,
    memoryMdPath,
    maxReviewIterations = 3,
    worktreePath,
    busPublishCmds,
  } = params;

  const taskList = formatTaskList(tasks);

  const depsSection =
    dependencies.length > 0
      ? `## Dependencies\n\nThis mind depends on: ${dependencies.map((d) => `@${d}`).join(", ")}.\nTheir work has already been completed and merged in previous waves.\n\n`
      : "";

  return `# Mind Brief: @${mindName}

Ticket: ${ticketId}
Wave: ${waveId}
Feature: ${featureDir}
Worktree: ${worktreePath}

## Domain Context

Read your MIND.md at: ${mindMdPath}

## Memory

Read your MEMORY.md at: ${memoryMdPath}

## Drone Tasks

${taskList}

${depsSection}## Review Loop Instructions

You are the supervising Mind. Your job is to spawn a drone, review its work, and approve or request fixes.

### Spawning the drone

\`\`\`typescript
const result = await Agent({
  subagent_type: 'drone',
  prompt: 'Read DRONE-BRIEF.md and complete all tasks. Commit when done.'
});
const agentId = result.agentId;
\`\`\`

### Reviewing drone output

After the drone returns, review its work with \`git diff\`. Check that:
- All tasks are completed
- Tests pass
- Code follows project conventions

### If issues are found

\`\`\`typescript
const result = await Agent({
  subagent_type: 'drone',
  resume: agentId,
  prompt: 'Fix: {feedback}'
});
\`\`\`

Maximum iterations: ${maxReviewIterations}. After reaching the maximum, approve with warnings and note remaining issues in your memory update.

## Bus Commands

Signal pipeline events by running these commands at the appropriate times:

**Mind started:**
\`\`\`bash
${busPublishCmds.started}
\`\`\`

**Review started:**
\`\`\`bash
${busPublishCmds.reviewStarted}
\`\`\`

**Review feedback sent to drone:**
\`\`\`bash
${busPublishCmds.reviewFeedback}
\`\`\`

**Mind complete (run after final approval):**
\`\`\`bash
${busPublishCmds.complete}
\`\`\`

## Memory Update

After approving the drone's work, update your MEMORY.md at ${memoryMdPath} with:
- What patterns worked well in this review
- Any recurring issues the drone encountered
- Conventions or pitfalls relevant to this domain
`;
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
