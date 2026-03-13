/**
 * drone-backend-axon.ts -- AxonDroneBackend implementing the DroneBackend interface.
 *
 * Manages drone lifecycle (spawn, kill, wait, monitor) through the Axon daemon
 * instead of tmux panes. Uses event-based completion detection via
 * waitForProcessCompletion for reliable exit tracking.
 */

import type {
  DroneBackend,
  DroneHandle,
  DroneSpawnOpts,
  DroneCompletionResult,
} from "../drone-backend.ts";
import { AxonClient } from "./client.ts";
import { waitForProcessCompletion } from "./completion.ts";

/**
 * Axon-backed implementation of the DroneBackend interface.
 *
 * Each drone maps 1:1 to an Axon-managed process. The backend delegates
 * process lifecycle to the Axon daemon and uses event subscriptions for
 * completion detection (no polling).
 */
export class AxonDroneBackend implements DroneBackend {
  private client: AxonClient;

  constructor(client: AxonClient) {
    this.client = client;
  }

  /**
   * Connect to the Axon daemon and create a backend.
   *
   * @param socketPath - Path to the Axon Unix domain socket
   */
  static async connect(socketPath: string): Promise<AxonDroneBackend> {
    const client = await AxonClient.connect(socketPath);
    return new AxonDroneBackend(client);
  }

  /**
   * Spawn a Claude Code drone process via Axon.
   *
   * Maps DroneSpawnOpts to Axon's spawn command, passing through the
   * working directory (cwd), environment variables, and command/args.
   */
  async spawn(opts: DroneSpawnOpts): Promise<DroneHandle> {
    await this.client.spawn(
      opts.processId,
      opts.command,
      opts.args,
      opts.env ?? null,
      opts.cwd,
    );
    return { id: opts.processId, backend: "axon" };
  }

  /**
   * Kill a running drone. Idempotent -- silently ignores errors if the
   * process is already dead or not found.
   */
  async kill(handle: DroneHandle): Promise<void> {
    try {
      await this.client.kill(handle.id);
    } catch {
      // Idempotent: ignore errors if process is already dead
    }
  }

  /**
   * Wait for a drone to finish using event-based completion detection.
   *
   * Subscribes to Axon events for the target process and waits for an
   * Exited event. Handles the subscribe-after-exit race condition by
   * checking process state immediately after subscribing.
   *
   * Note: After a timeout, the client connection used by this call may be
   * in an indeterminate state due to a dangling readEvent() promise.
   * The caller should close and reconnect if reuse is needed.
   */
  async waitForCompletion(
    handle: DroneHandle,
    _worktreePath: string,
    timeoutMs: number,
  ): Promise<DroneCompletionResult> {
    try {
      const result = await waitForProcessCompletion(
        this.client,
        handle.id,
        timeoutMs,
      );
      return {
        ok: result.ok,
        exitCode: result.exitCode,
        error: result.error,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check if a drone is still running.
   *
   * Queries Axon for process state. Returns true only for Running or
   * Starting states. Returns false for Exited, Stopping, or if the
   * process is not found.
   */
  async isAlive(handle: DroneHandle): Promise<boolean> {
    try {
      const info = await this.client.info(handle.id);
      return info.state === "Running" || info.state === "Starting";
    } catch {
      return false;
    }
  }

  /**
   * Capture drone output from the Axon output buffer.
   *
   * Returns the full buffered output for the process. Returns an empty
   * string if the process is not found or the buffer is unavailable.
   */
  async captureOutput(handle: DroneHandle): Promise<string> {
    try {
      const result = await this.client.readBuffer(handle.id);
      return result.data;
    } catch {
      return "";
    }
  }

  /** Close the underlying Axon client connection. */
  close(): void {
    this.client.close();
  }
}
