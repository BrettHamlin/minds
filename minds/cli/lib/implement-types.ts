/**
 * implement-types.ts -- Shared types for the `minds implement` command.
 */

export interface ImplementOptions {
  yes?: boolean;
}

/** A task grouped under a specific mind. */
export interface MindTask {
  id: string;
  mind: string;
  description: string;
  parallel: boolean;
  produces?: { interface: string; path: string };
  consumes?: { interface: string; path: string };
  repo?: string;  // Repo alias for multi-repo workspaces
}

/** Tasks grouped by mind name, with dependency metadata. */
export interface MindTaskGroup {
  mind: string;
  tasks: MindTask[];
  dependencies: string[]; // mind names this group depends on
  ownsFiles?: string[]; // globs from (owns: ...) section annotation — undefined if not declared
  repo?: string;  // Repo alias for multi-repo workspaces
}

/** An execution wave: a set of minds that can run in parallel. */
export interface ExecutionWave {
  id: string; // "wave-1", "wave-2", etc.
  minds: string[];
}

/** Dispatch plan shown to user before confirmation. */
export interface DispatchPlan {
  ticketId: string;
  featureDir: string;
  waves: ExecutionWave[];
  taskGroups: MindTaskGroup[];
  totalTasks: number;
  totalMinds: number;
}

/** Tracking info for a spawned drone. */
export interface DroneInfo {
  mindName: string;
  waveId: string;
  paneId: string;
  worktree: string;
  branch: string;
  repo?: string;  // Repo alias for multi-repo workspaces
}

/** Tracking info for a spawned Mind. */
export interface MindInfo {
  mindName: string;
  waveId: string;
  paneId: string;
  worktree: string;
  branch: string;
  repo?: string;  // Repo alias for multi-repo workspaces
}

/** Result of the full implement run. */
export interface ImplementResult {
  ok: boolean;
  wavesCompleted: number;
  totalWaves: number;
  mindsSpawned: MindInfo[];
  mergeResults: Array<{ mind: string; ok: boolean; error?: string; repo?: string }>;
  errors: string[];
}
