/**
 * daemon.ts -- DaemonManager for Axon daemon lifecycle management.
 *
 * Unlike tmux (which auto-starts), the Axon daemon must be explicitly started.
 * DaemonManager handles starting, health-checking, and shutting down the daemon.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync, unlinkSync } from "fs";
import net from "net";

export interface DaemonManagerOptions {
  /** Path to the axon binary. Default: "axon" (relies on PATH) */
  binaryPath?: string;
  /** Path to the Unix socket. Default: "/tmp/axon.sock" */
  socketPath?: string;
  /** Max processes for the daemon. Default: 64 */
  maxProcesses?: number;
  /** Buffer size per process. Default: 65536 */
  bufferSize?: number;
  /** Working directory for spawned processes */
  workDir?: string;
}

const DEFAULT_SOCKET_PATH = "/tmp/axon.sock";

/**
 * Manages the lifecycle of an Axon daemon process.
 *
 * Provides ensureRunning() to start the daemon if not already running,
 * isHealthy() to check connectivity, and shutdown() for cleanup.
 */
export class DaemonManager {
  private opts: Required<Pick<DaemonManagerOptions, "socketPath">> &
    DaemonManagerOptions;
  private daemonProcess: ChildProcess | null = null;
  private startupError: Error | null = null;
  private startupPromise: Promise<void> | null = null;

  constructor(options: DaemonManagerOptions = {}) {
    this.opts = {
      ...options,
      socketPath: options.socketPath ?? DEFAULT_SOCKET_PATH,
    };
  }

  /** The Unix socket path used for daemon communication. */
  get socketPath(): string {
    return this.opts.socketPath;
  }

  /**
   * Ensure the daemon is running and responsive.
   * Starts it if not running. Returns when the socket is accepting connections.
   */
  async ensureRunning(): Promise<void> {
    if (await this.isHealthy()) return;
    if (!this.startupPromise) {
      this.startupPromise = this.doStart().finally(() => {
        this.startupPromise = null;
      });
    }
    return this.startupPromise;
  }

  private async doStart(): Promise<void> {
    this.cleanStaleSocket();
    await this.startDaemon();
    await this.waitForSocket();
  }

  /**
   * Check if the daemon is healthy by attempting a socket connection.
   */
  async isHealthy(): Promise<boolean> {
    if (!existsSync(this.opts.socketPath)) {
      return false;
    }

    return new Promise((resolve) => {
      const socket = net.createConnection(this.opts.socketPath);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.setTimeout(1000);
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Graceful shutdown of the daemon.
   */
  async shutdown(): Promise<void> {
    if (this.daemonProcess) {
      this.daemonProcess.kill("SIGTERM");
      this.daemonProcess = null;
    }
  }

  private cleanStaleSocket(): void {
    if (existsSync(this.opts.socketPath)) {
      try {
        unlinkSync(this.opts.socketPath);
      } catch {
        // Socket may be in use
      }
    }
  }

  private async startDaemon(): Promise<void> {
    const args = ["server", "--socket", this.opts.socketPath];

    if (this.opts.maxProcesses) {
      args.push("--max-processes", String(this.opts.maxProcesses));
    }
    if (this.opts.bufferSize) {
      args.push("--buffer-size", String(this.opts.bufferSize));
    }
    if (this.opts.workDir) {
      args.push("--work-dir", this.opts.workDir);
    }

    const binaryPath = this.opts.binaryPath ?? "axon";

    this.daemonProcess = spawn(binaryPath, args, {
      stdio: "ignore",
      detached: true,
    });

    this.daemonProcess.unref();

    // Store startup failure for waitForSocket to detect
    this.daemonProcess.on("error", (err) => {
      this.startupError = new Error(`Failed to start Axon daemon: ${err.message}`);
    });
  }

  private async waitForSocket(timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.startupError) throw this.startupError;
      if (await this.isHealthy()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Axon daemon did not start within ${timeoutMs}ms`);
  }
}
