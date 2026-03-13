/**
 * multiplexer.ts -- AxonMultiplexer implementing the TerminalMultiplexer interface.
 *
 * Maps the abstract multiplexer operations to Axon client calls, replacing
 * tmux-based process orchestration with the Axon daemon.
 *
 * Key differences from tmux:
 * - Tmux panes are long-lived shells that accept multiple sendKeys calls.
 * - Axon processes are single-command executions.
 * - Each sendKeys call derives a unique process ID with an internal counter
 *   to avoid duplicate ID errors on repeated calls.
 * - Source pane IDs are sanitized (e.g., tmux's %42 format) to comply with
 *   Axon's ProcessId regex: [a-zA-Z0-9_-]{1,64}.
 */

import type { TerminalMultiplexer } from "../terminal-multiplexer.ts";
import type { AxonClient } from "./client.ts";
import { sanitizeProcessId } from "./types.ts";

/**
 * Axon-backed implementation of the TerminalMultiplexer interface.
 *
 * Instead of tmux panes, processes are managed by the Axon daemon.
 * "Pane IDs" map to logical groups of Axon processes. Each sendKeys call
 * spawns a new process with a derived ID under the pane's group.
 */
export class AxonMultiplexer implements TerminalMultiplexer {
  private client: AxonClient;
  private nextId = 0;
  private paneProcesses: Map<string, string[]> = new Map();
  private commandCounters: Map<string, number> = new Map();

  constructor(client: AxonClient) {
    this.client = client;
  }

  /**
   * Allocate a logical pane ID. No process is spawned yet -- the caller
   * will start a process via sendKeys.
   *
   * The sourcePane is sanitized to remove invalid characters (e.g., tmux's
   * %N format) before being used in the generated pane ID.
   */
  async splitPane(sourcePane: string): Promise<string> {
    const sanitized = sanitizeProcessId(sourcePane);
    const id = `${sanitized}-${this.nextId++}`;
    this.paneProcesses.set(id, []);
    this.commandCounters.set(id, 0);
    return id;
  }

  /**
   * Spawn a process in the given pane by running the command directly.
   *
   * Each call derives a unique process ID using an internal counter,
   * allowing multiple sendKeys calls on the same pane without duplicate
   * ID errors. All derived process IDs are tracked for cleanup.
   */
  async sendKeys(paneId: string, command: string): Promise<void> {
    const counter = this.commandCounters.get(paneId) ?? 0;
    const suffix = `-cmd-${counter}`;
    // Truncate paneId so the full processId stays within Axon's 64-char limit
    const maxPaneLen = 64 - suffix.length;
    const processId = `${paneId.slice(0, maxPaneLen)}${suffix}`;
    this.commandCounters.set(paneId, counter + 1);

    // Spawn FIRST, track AFTER success -- avoids phantom entries on failure
    await this.client.spawn(processId, "/bin/sh", ["-c", command]);

    const processes = this.paneProcesses.get(paneId) ?? [];
    processes.push(processId);
    this.paneProcesses.set(paneId, processes);
  }

  /**
   * Kill all processes associated with a pane, then clean up tracking state.
   * Silently ignores errors if individual processes are already gone.
   */
  async killPane(paneId: string): Promise<void> {
    const processes = this.paneProcesses.get(paneId) ?? [];
    for (const processId of processes) {
      try {
        await this.client.kill(processId);
      } catch {
        // Process may already be gone
      }
    }
    this.paneProcesses.delete(paneId);
    this.commandCounters.delete(paneId);
  }

  /**
   * Check if any process in the pane is still alive.
   * A pane is considered alive if at least one of its processes is Running
   * or Starting.
   */
  async isPaneAlive(paneId: string): Promise<boolean> {
    const processes = this.paneProcesses.get(paneId) ?? [];
    for (const processId of processes) {
      try {
        const info = await this.client.info(processId);
        if (info.state === "Running" || info.state === "Starting") {
          return true;
        }
      } catch {
        // Process not found, continue checking others
      }
    }
    return false;
  }

  /**
   * Get the current session ID as the "current pane".
   */
  async getCurrentPane(): Promise<string> {
    return this.client.sessionId;
  }

  /**
   * Capture the output buffer of the most recent process in the pane.
   * Returns an empty string if no processes have been spawned in the pane.
   */
  async capturePane(paneId: string): Promise<string> {
    const processes = this.paneProcesses.get(paneId) ?? [];
    if (processes.length === 0) {
      return "";
    }
    const lastProcess = processes[processes.length - 1];
    const result = await this.client.readBuffer(lastProcess);
    return result.data;
  }

  /**
   * Close the underlying AxonClient connection.
   * Call this when the multiplexer is no longer needed to avoid socket leaks.
   */
  close(): void {
    this.client.close();
  }
}
