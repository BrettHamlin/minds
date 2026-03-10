/**
 * drone-brief.ts -- Build DRONE-BRIEF.md content as a TypeScript template.
 *
 * The brief is what each drone receives as its work instructions.
 * It includes the tasks assigned to the drone's mind and contract info.
 */

import type { MindTask, MindTaskGroup } from "./implement-types.ts";

export interface DroneBriefParams {
  ticketId: string;
  mindName: string;
  waveId: string;
  tasks: MindTask[];
  dependencies: string[];
  featureDir: string;
}

/**
 * Format a list of MindTasks into a markdown checklist string.
 */
export function formatTaskList(tasks: MindTask[]): string {
  return tasks
    .map((t) => {
      const pTag = t.parallel ? " [P]" : "";
      return `- [ ] ${t.id}${pTag} ${t.description}`;
    })
    .join("\n");
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
    featureDir,
  } = params;

  const taskList = formatTaskList(tasks);

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
`;
}
