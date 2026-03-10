// state-tracker.ts — Deterministic state machine for Minds dashboard (BRE-445)
//
// Processes MindsEventType bus events into MindsState snapshots.
// Pure TypeScript, no React dependency.

import { MindsEventType, HOOK_TYPES, type MindsBusMessage, type MindsHookEvent } from "@minds/transport/minds-events.js";
import { MindsDb } from "./db.js";

// ---------------------------------------------------------------------------
// Extended types (superset of server.ts stubs)
// ---------------------------------------------------------------------------

export interface Drone {
  mindName: string;
  status: "pending" | "active" | "reviewing" | "merging" | "complete" | "failed";
  paneId?: string;
  worktree?: string;
  startedAt?: string;
  completedAt?: string;
  tasks?: number;
  tasksComplete?: number;
  reviewAttempts?: number;
  violations?: number;
  branch?: string;
  // Hook-derived fields (T015)
  lastTool?: string;
  toolCount?: number;
  errors?: string[];
}

export interface Wave {
  id: string;
  status: "active" | "complete" | "pending";
  drones: Drone[];
  startedAt?: string;
  completedAt?: string;
}

export interface Contract {
  producer: string;
  consumer: string;
  interface: string;
  status: "pending" | "fulfilled";
}

export interface MindsStateStats {
  mindsInvolved: number;
  activeDrones: number;
  currentWave: number;
  totalWaves: number;
  contractsFulfilled: number;
  contractsTotal: number;
}

export interface MindsState {
  ticketId: string;
  ticketTitle: string;
  startedAt: string;
  waves: Wave[];
  contracts: Contract[];
  updatedAt: string;
  stats: MindsStateStats;
}

// ---------------------------------------------------------------------------
// Payload interfaces (event-specific)
// ---------------------------------------------------------------------------

interface WaveStartedPayload {
  waveId: string;
  ticketTitle?: string;
}

interface WaveCompletePayload {
  waveId: string;
}

interface DroneSpawnedPayload {
  waveId: string;
  mindName: string;
  paneId?: string;
  worktree?: string;
  tasks?: number;
  branch?: string;
}

interface DroneEventPayload {
  waveId: string;
  mindName: string;
  tasksComplete?: number;
  violations?: number;
}

interface MindSignalPayload {
  mindName: string;
}

interface ContractFulfilledPayload {
  producer: string;
  consumer: string;
  interface: string;
}

// ---------------------------------------------------------------------------
// Stats calculator
// ---------------------------------------------------------------------------

function calculateStats(state: MindsState): MindsStateStats {
  const mindNames = new Set<string>();
  let activeDrones = 0;
  let currentWave = 0;

  for (let i = 0; i < state.waves.length; i++) {
    const wave = state.waves[i];
    if (wave.status !== "pending") {
      currentWave = i + 1;
    }
    for (const drone of wave.drones) {
      mindNames.add(drone.mindName);
      if (
        drone.status === "active" ||
        drone.status === "reviewing" ||
        drone.status === "merging"
      ) {
        activeDrones++;
      }
    }
  }

  return {
    mindsInvolved: mindNames.size,
    activeDrones,
    currentWave,
    totalWaves: state.waves.length,
    contractsFulfilled: state.contracts.filter((c) => c.status === "fulfilled").length,
    contractsTotal: state.contracts.length,
  };
}

// ---------------------------------------------------------------------------
// MindsStateTracker
// ---------------------------------------------------------------------------

export class MindsStateTracker {
  private states: Map<string, MindsState> = new Map();
  private subscribers: Set<(state: MindsState) => void> = new Set();
  private db: MindsDb | null = null;

  constructor(dbPath?: string) {
    if (dbPath) {
      this.db = new MindsDb(dbPath);
    }
  }

  applyEvent(msg: MindsBusMessage): void {
    const ticketId = msg.ticketId ?? msg.channel?.replace(/^minds-/, "");
    if (!ticketId) return;
    const state = this.getOrCreate(ticketId);
    const now = new Date().toISOString();
    const payload = (msg.payload ?? {}) as Record<string, unknown>;

    // Handle hook events (type starts with "HOOK_")
    if ((msg.type as string).startsWith("HOOK_")) {
      this.applyHookEvent(state, msg);
    } else {
      switch (msg.type) {
        case MindsEventType.WAVE_STARTED: {
          const p = payload as unknown as WaveStartedPayload;
          if (p.ticketTitle) {
            state.ticketTitle = p.ticketTitle;
          }
          const existing = state.waves.find((w) => w.id === p.waveId);
          if (!existing) {
            state.waves.push({
              id: p.waveId,
              status: "active",
              drones: [],
              startedAt: now,
            });
          } else {
            existing.status = "active";
            existing.startedAt = existing.startedAt ?? now;
          }
          break;
        }

        case MindsEventType.WAVE_COMPLETE: {
          const p = payload as unknown as WaveCompletePayload;
          const wave = state.waves.find((w) => w.id === p.waveId);
          if (wave) {
            wave.status = "complete";
            wave.completedAt = now;
          }
          break;
        }

        case MindsEventType.DRONE_SPAWNED: {
          const p = payload as unknown as DroneSpawnedPayload;
          const wave = state.waves.find((w) => w.id === p.waveId);
          if (wave) {
            const existing = wave.drones.find((d) => d.mindName === p.mindName);
            if (!existing) {
              wave.drones.push({
                mindName: p.mindName,
                status: "active",
                paneId: p.paneId,
                worktree: p.worktree,
                startedAt: now,
                tasks: p.tasks,
                tasksComplete: 0,
                reviewAttempts: 0,
                violations: 0,
                branch: p.branch,
                toolCount: 0,
                errors: [],
              });
            } else {
              existing.status = "active";
              existing.paneId = p.paneId ?? existing.paneId;
              existing.worktree = p.worktree ?? existing.worktree;
              existing.startedAt = existing.startedAt ?? now;
              existing.tasks = p.tasks ?? existing.tasks;
              existing.branch = p.branch ?? existing.branch;
            }
          }
          break;
        }

        case MindsEventType.MIND_COMPLETE: {
          const p = payload as unknown as DroneEventPayload;
          const drone = this.findDrone(state, p.waveId, p.mindName);
          if (drone) {
            drone.status = "complete";
            drone.completedAt = now;
            if (p.tasksComplete !== undefined) {
              drone.tasksComplete = p.tasksComplete;
            }
          }
          break;
        }

        case MindsEventType.MIND_STARTED: {
          const p = payload as unknown as MindSignalPayload;
          const drone = this.findDroneByMindName(state, p.mindName);
          if (drone) {
            drone.status = "active";
            drone.startedAt = drone.startedAt ?? now;
          }
          break;
        }

        case MindsEventType.REVIEW_STARTED: {
          const p = payload as unknown as MindSignalPayload;
          const drone = this.findDroneByMindName(state, p.mindName);
          if (drone) {
            drone.status = "reviewing";
          }
          break;
        }

        case MindsEventType.REVIEW_FEEDBACK: {
          const p = payload as unknown as MindSignalPayload;
          const drone = this.findDroneByMindName(state, p.mindName);
          if (drone) {
            drone.status = "active";
            drone.reviewAttempts = (drone.reviewAttempts ?? 0) + 1;
          }
          break;
        }

        case MindsEventType.DRONE_REVIEWING: {
          const p = payload as unknown as DroneEventPayload;
          const drone = this.findDrone(state, p.waveId, p.mindName);
          if (drone) {
            drone.status = "reviewing";
          }
          break;
        }

        case MindsEventType.DRONE_REVIEW_PASS: {
          const p = payload as unknown as DroneEventPayload;
          const drone = this.findDrone(state, p.waveId, p.mindName);
          if (drone) {
            drone.status = "complete";
          }
          break;
        }

        case MindsEventType.DRONE_REVIEW_FAIL: {
          const p = payload as unknown as DroneEventPayload;
          const drone = this.findDrone(state, p.waveId, p.mindName);
          if (drone) {
            drone.status = "active";
            drone.reviewAttempts = (drone.reviewAttempts ?? 0) + 1;
            if (p.violations !== undefined) {
              drone.violations = p.violations;
            }
          }
          break;
        }

        case MindsEventType.DRONE_MERGING: {
          const p = payload as unknown as DroneEventPayload;
          const drone = this.findDrone(state, p.waveId, p.mindName);
          if (drone) {
            drone.status = "merging";
          }
          break;
        }

        case MindsEventType.DRONE_MERGED: {
          const p = payload as unknown as DroneEventPayload;
          const drone = this.findDrone(state, p.waveId, p.mindName);
          if (drone) {
            drone.status = "complete";
            drone.completedAt = now;
          }
          break;
        }

        case MindsEventType.CONTRACT_FULFILLED: {
          const p = payload as unknown as ContractFulfilledPayload;
          const existing = state.contracts.find(
            (c) =>
              c.producer === p.producer &&
              c.consumer === p.consumer &&
              c.interface === p.interface
          );
          if (existing) {
            existing.status = "fulfilled";
          } else {
            state.contracts.push({
              producer: p.producer,
              consumer: p.consumer,
              interface: p.interface,
              status: "fulfilled",
            });
          }
          break;
        }
      }
    }

    state.updatedAt = now;
    state.stats = calculateStats(state);

    // Persist to SQLite if db is open
    if (this.db) {
      this.db.insertEvent(
        ticketId,
        msg.from ?? "",
        msg.type as string,
        JSON.stringify(msg.payload ?? {}),
        Date.now(),
      );
      this.db.saveState(ticketId, JSON.stringify(state));
    }

    this.notify(state);
  }

  /** Load all persisted states from the DB into memory (call on startup). */
  loadFromDb(): void {
    if (!this.db) return;
    const allStates = this.db.loadAllStates();
    for (const { ticketId, stateJson } of allStates) {
      try {
        const state = JSON.parse(stateJson) as MindsState;
        this.states.set(ticketId, state);
      } catch {
        // Corrupt state — skip
      }
    }
  }

  /** Return raw event rows for a ticket (for debugging / dashboard history view). */
  getHistory(ticketId: string, limit?: number): ReturnType<MindsDb["queryEvents"]> {
    if (!this.db) return [];
    return this.db.queryEvents(ticketId, limit);
  }

  getState(ticketId: string): MindsState | undefined {
    return this.states.get(ticketId);
  }

  getAllActive(): MindsState[] {
    return Array.from(this.states.values());
  }

  subscribe(cb: (state: MindsState) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  // -- private helpers --

  private getOrCreate(ticketId: string): MindsState {
    let state = this.states.get(ticketId);
    if (!state) {
      state = {
        ticketId,
        ticketTitle: "",
        startedAt: new Date().toISOString(),
        waves: [],
        contracts: [],
        updatedAt: new Date().toISOString(),
        stats: {
          mindsInvolved: 0,
          activeDrones: 0,
          currentWave: 0,
          totalWaves: 0,
          contractsFulfilled: 0,
          contractsTotal: 0,
        },
      };
      this.states.set(ticketId, state);
    }
    return state;
  }

  private findDrone(
    state: MindsState,
    waveId: string,
    mindName: string
  ): Drone | undefined {
    const wave = state.waves.find((w) => w.id === waveId);
    if (!wave) return undefined;
    return wave.drones.find((d) => d.mindName === mindName);
  }

  /** Find drone by mindName across all waves (most recent wave first). */
  private findDroneByMindName(state: MindsState, mindName: string): Drone | undefined {
    for (let i = state.waves.length - 1; i >= 0; i--) {
      const drone = state.waves[i].drones.find((d) => d.mindName === mindName);
      if (drone) return drone;
    }
    return undefined;
  }

  /** Find or create drone by mindName; inserts into most recent wave (creates one if none). */
  private findOrCreateDroneByMindName(state: MindsState, mindName: string): Drone {
    const existing = this.findDroneByMindName(state, mindName);
    if (existing) return existing;

    let wave = state.waves[state.waves.length - 1];
    if (!wave) {
      wave = {
        id: "hooks",
        status: "active",
        drones: [],
        startedAt: new Date().toISOString(),
      };
      state.waves.push(wave);
    }
    const drone: Drone = {
      mindName,
      status: "active",
      startedAt: new Date().toISOString(),
      toolCount: 0,
      errors: [],
    };
    wave.drones.push(drone);
    return drone;
  }

  /** Handle HOOK_* bus events (T014). */
  private applyHookEvent(state: MindsState, msg: MindsBusMessage): void {
    const hookPayload = (msg.payload ?? {}) as MindsHookEvent;
    const hookType = hookPayload.hookType;
    const source = hookPayload.source ?? "";
    // "drone:signals" → "signals", "mind:orchestrator" → "orchestrator"
    const mindName = source.includes(":") ? source.split(":")[1] : source;

    switch (hookType) {
      case HOOK_TYPES.SUBAGENT_START: {
        this.findOrCreateDroneByMindName(state, mindName);
        break;
      }

      case HOOK_TYPES.SUBAGENT_STOP: {
        const drone = this.findDroneByMindName(state, mindName);
        if (drone) {
          drone.status = "complete";
          drone.completedAt = new Date().toISOString();
        }
        break;
      }

      case HOOK_TYPES.PRE_TOOL_USE: {
        const drone = this.findDroneByMindName(state, mindName);
        if (drone) {
          drone.toolCount = (drone.toolCount ?? 0) + 1;
          drone.lastTool = hookPayload.toolName;
        }
        break;
      }

      case HOOK_TYPES.POST_TOOL_USE_FAILURE: {
        const drone = this.findDroneByMindName(state, mindName);
        if (drone) {
          if (!drone.errors) drone.errors = [];
          const errMsg =
            (hookPayload.payload?.error as string | undefined) ??
            `Tool failure: ${hookPayload.toolName ?? "unknown"}`;
          drone.errors.push(errMsg);
        }
        break;
      }
    }
  }

  private notify(state: MindsState): void {
    for (const cb of this.subscribers) {
      cb(state);
    }
  }
}
