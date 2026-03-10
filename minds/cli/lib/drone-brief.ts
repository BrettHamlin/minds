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
  mindsDir?: string; // absolute path to minds/ dir for test commands
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
    mindsDir,
  } = params;

  const taskList = formatTaskList(tasks);
  const testPath = mindsDir ? `${mindsDir}/${mindName}/` : `minds/${mindName}/`;

  const depsSection =
    dependencies.length > 0
      ? `\n---\n\n## 🔗 Dependencies\n\n${dependencies.map((d) => `@${d}`).join(", ")} — completed and merged in previous waves.\n`
      : "";

  return `---
name: Drone Brief
role: Implementation tasks for the 🛸 Drone code worker
scope: Complete all tasks, commit when done
---

Your agent definition is in \`.claude/agents/drone.md\`. If you've compacted, re-read this file.

# 🛸 Drone Brief: @${mindName}

| Field | Value |
|-------|-------|
| **Ticket** | ${ticketId} |
| **Wave** | ${waveId} |
| **Feature** | ${featureDir} |

---

## 📋 Tasks

${taskList}

---

## ✅ Completion Criteria

All tasks above are checked off AND all tests pass.
${depsSection}
## 🔧 Instructions

1. Read and understand each task above.
2. Implement ALL tasks in order (unless marked [P] for parallel-safe).
3. Write tests for each change (TDD: red -> green -> refactor).
4. Run \`bun test ${testPath}\` to verify your changes pass.
5. Commit your work with a descriptive message referencing ${ticketId}.
`;
}
