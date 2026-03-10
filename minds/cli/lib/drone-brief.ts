/**
 * drone-brief.ts -- Build DRONE-BRIEF.md content as a TypeScript template.
 *
 * The brief is what each drone receives as its work instructions.
 * It includes the tasks assigned to the drone's mind, contract info,
 * and the bus publish command for DRONE_COMPLETE signaling.
 */

import type { MindTask, MindTaskGroup } from "./implement-types.ts";

export interface DroneBriefParams {
  ticketId: string;
  mindName: string;
  waveId: string;
  tasks: MindTask[];
  dependencies: string[];
  busPublishCmd: string;
  featureDir: string;
}

/**
 * Build the DRONE-BRIEF.md content for a drone.
 */
export function buildDroneBrief(params: DroneBriefParams): string {
  const {
    ticketId,
    mindName,
    waveId,
    tasks,
    dependencies,
    busPublishCmd,
    featureDir,
  } = params;

  const taskList = tasks
    .map((t) => {
      const pTag = t.parallel ? " [P]" : "";
      let line = `- [ ] ${t.id}${pTag} ${t.description}`;
      return line;
    })
    .join("\n");

  const depsSection =
    dependencies.length > 0
      ? `## Dependencies\n\nThis mind depends on: ${dependencies.map((d) => `@${d}`).join(", ")}.\nTheir work has already been completed and merged in previous waves.\n`
      : "";

  return `# Drone Brief: @${mindName}

Ticket: ${ticketId}
Wave: ${waveId}
Feature: ${featureDir}

## Tasks

${taskList}

${depsSection}
## Instructions

1. Read and understand each task above.
2. Implement ALL tasks in order (unless marked [P] for parallel-safe).
3. Write tests for each change (TDD: red -> green -> refactor).
4. Run \`bun test minds/${mindName}/\` to verify your changes pass.
5. Commit your work with a descriptive message referencing ${ticketId}.

## Completion Signal

When ALL tasks are done and tests pass, run this command to signal completion:

\`\`\`bash
${busPublishCmd}
\`\`\`

This tells the orchestrator you are finished. Do NOT forget this step.
`;
}

/**
 * Build the bus publish command string for DRONE_COMPLETE.
 */
export function buildBusPublishCmd(
  mindsDir: string,
  channel: string,
  mindName: string,
  waveId: string,
): string {
  return [
    `bun ${mindsDir}/transport/minds-publish.ts`,
    `--channel ${channel}`,
    `--type DRONE_COMPLETE`,
    `--payload '${JSON.stringify({ mindName, waveId })}'`,
  ].join(" ");
}
