/**
 * client.ts -- AxonClient for communicating with the Axon daemon.
 *
 * Connects over a Unix domain socket, performs the handshake, and provides
 * typed methods for all Axon operations. Uses a single `request()` helper
 * with message ID correlation to correctly separate responses from push events.
 *
 * Supports connection resilience with auto-reconnect, exponential backoff,
 * and connection state tracking via optional AxonClientOptions.
 */

import * as net from "node:net";
import { LineCodec } from "./codec.ts";
import {
  AxonError,
  validateProcessId,
  type Message,
  type MessageKind,
  type HandshakeMessage,
  type ProcessId,
  type ProcessInfo,
  type EventFilter,
  type AxonEvent,
} from "./types.ts";

/** Default socket path when not specified. */
const DEFAULT_SOCKET_PATH = "/tmp/axon.sock";

/** Protocol version this client speaks. */
const PROTOCOL_VERSION = "0.1.0";

/** Result of subscribing to events. */
export interface Subscription {
  /** The server-assigned subscription ID. */
  id: number;
}

/** Options for configuring AxonClient resilience behavior. */
export interface AxonClientOptions {
  /** Maximum number of reconnection attempts. Default: 3 */
  maxReconnectAttempts?: number;
  /** Initial delay between reconnection attempts in ms. Doubles each attempt. Default: 500 */
  reconnectDelayMs?: number;
  /** Called when the connection drops. */
  onDisconnect?: () => void;
  /** Called when a reconnection succeeds. */
  onReconnect?: () => void;
  /** Called when all reconnection attempts are exhausted. */
  onReconnectFailed?: () => void;
}

/**
 * Client for the Axon process orchestrator daemon.
 *
 * Usage:
 *   const client = await AxonClient.connect();
 *   const procs = await client.list();
 *   client.close();
 *
 * With resilience options:
 *   const client = await AxonClient.connect("/tmp/axon.sock", {
 *     maxReconnectAttempts: 5,
 *     reconnectDelayMs: 200,
 *     onDisconnect: () => console.log("disconnected"),
 *     onReconnect: () => console.log("reconnected"),
 *   });
 */
export class AxonClient {
  private codec: LineCodec;
  private socket: net.Socket;
  private msgId = 0;
  private eventQueue: Message[] = [];
  private _connected = false;
  private _sessionId: string;
  private socketPath: string;
  private options: AxonClientOptions;
  private disconnectFired = false;

  /** The session ID received from the server during handshake. */
  get sessionId(): string {
    return this._sessionId;
  }

  /** Whether the client is currently connected to the daemon. */
  get connected(): boolean {
    return this._connected;
  }

  private constructor(
    socket: net.Socket,
    codec: LineCodec,
    sessionId: string,
    socketPath: string,
    options: AxonClientOptions,
  ) {
    this.socket = socket;
    this.codec = codec;
    this._sessionId = sessionId;
    this.socketPath = socketPath;
    this.options = options;
    this._connected = true;
    this.disconnectFired = false;
    this.attachSocketHandlers();
  }

  /** Attach error/close handlers to detect connection drops. */
  private attachSocketHandlers(): void {
    const onClose = () => {
      if (this._connected) {
        this._connected = false;
        if (!this.disconnectFired) {
          this.disconnectFired = true;
          this.options.onDisconnect?.();
        }
      }
    };

    this.socket.on("close", onClose);
    this.socket.on("error", () => {
      // Error will trigger close, which handles state update.
      // We just need to prevent unhandled error crashes.
    });
  }

  /**
   * Connect to the Axon daemon and perform the handshake.
   * Returns a connected AxonClient ready for requests.
   */
  static async connect(
    socketPath?: string,
    options?: AxonClientOptions,
  ): Promise<AxonClient> {
    const sockPath = socketPath ?? DEFAULT_SOCKET_PATH;
    const opts = options ?? {};
    const { socket, codec, sessionId } = await AxonClient.doConnect(sockPath);
    return new AxonClient(socket, codec, sessionId, sockPath, opts);
  }

  /**
   * Establish a socket connection and perform the handshake.
   * Shared by initial connect and reconnect logic.
   */
  private static async doConnect(sockPath: string): Promise<{
    socket: net.Socket;
    codec: LineCodec;
    sessionId: string;
  }> {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const sock = net.createConnection(sockPath, () => {
        sock.removeListener("error", reject);
        resolve(sock);
      });
      sock.once("error", reject);
    });

    const codec = new LineCodec(socket);

    // Send Hello
    const hello: HandshakeMessage = {
      t: "Hello",
      c: { version: PROTOCOL_VERSION, client_name: "axon-ts" },
    };
    await codec.writeMessage(hello);

    // Read handshake response
    const response = await codec.readMessage<HandshakeMessage>();

    if (response.t === "Error") {
      socket.destroy();
      throw new AxonError(
        response.c.code,
        `handshake rejected: ${response.c.message}`,
      );
    }

    if (response.t !== "Ok") {
      socket.destroy();
      throw new Error(`unexpected handshake response: ${JSON.stringify(response)}`);
    }

    return { socket, codec, sessionId: response.c.session_id };
  }

  /**
   * Attempt to reconnect with exponential backoff.
   * Re-establishes the socket, codec, and handshake.
   * Throws AxonError with code CONNECTION_LOST if all attempts fail.
   */
  private async reconnect(): Promise<void> {
    const maxAttempts = this.options.maxReconnectAttempts ?? 3;
    const baseDelay = this.options.reconnectDelayMs ?? 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));

      try {
        const { socket, codec, sessionId } = await AxonClient.doConnect(
          this.socketPath,
        );

        // Replace internals with new connection
        this.socket = socket;
        this.codec = codec;
        this._sessionId = sessionId;
        this._connected = true;
        this.disconnectFired = false;
        this.eventQueue = [];
        this.attachSocketHandlers();

        this.options.onReconnect?.();
        return;
      } catch {
        // Attempt failed, try again
      }
    }

    // All attempts exhausted
    this.options.onReconnectFailed?.();
    throw new AxonError(
      "CONNECTION_LOST",
      `Failed to reconnect after ${maxAttempts} attempts`,
    );
  }

  /**
   * Send a request and wait for the correlated response.
   * If the server responds with Error, throws an AxonError.
   * Non-matching messages (e.g. push events) are buffered in eventQueue.
   * If disconnected, attempts auto-reconnect before sending.
   */
  private async request(kind: MessageKind): Promise<MessageKind> {
    // If disconnected and we have resilience options, try reconnect
    if (!this._connected && this.hasReconnectOptions()) {
      await this.reconnect();
    }

    const id = ++this.msgId;
    const msg: Message = { id, kind };

    // If the socket is already destroyed, skip straight to reconnect
    if (this.socket.destroyed) {
      if (this.hasReconnectOptions()) {
        this._connected = false;
        await this.reconnect();
        return this.requestDirect(kind);
      }
      throw new Error("Socket is destroyed and no reconnect options configured");
    }

    try {
      await this.codec.writeMessage(msg);

      // Loop until we find the response matching our request ID
      for (;;) {
        const response = await this.codec.readMessage<Message>();

        if (response.id === id) {
          if (response.kind.t === "Error") {
            throw new AxonError(
              (response.kind as { t: "Error"; c: { code: string; message: string } }).c.code,
              (response.kind as { t: "Error"; c: { code: string; message: string } }).c.message,
            );
          }
          return response.kind;
        }

        // Non-matching message (e.g. push event) -- buffer it
        this.eventQueue.push(response);
      }
    } catch (err) {
      // If the error is an AxonError (server-level), don't reconnect
      if (err instanceof AxonError) {
        throw err;
      }

      // Transport-level failure -- attempt reconnect if configured
      if (this.hasReconnectOptions()) {
        this._connected = false;
        await this.reconnect();
        // Retry the request once after successful reconnect
        return this.requestDirect(kind);
      }

      throw err;
    }
  }

  /**
   * Send a request without reconnect logic (used after reconnect to avoid loops).
   */
  private async requestDirect(kind: MessageKind): Promise<MessageKind> {
    const id = ++this.msgId;
    const msg: Message = { id, kind };

    await this.codec.writeMessage(msg);

    for (;;) {
      const response = await this.codec.readMessage<Message>();

      if (response.id === id) {
        if (response.kind.t === "Error") {
          throw new AxonError(
            (response.kind as { t: "Error"; c: { code: string; message: string } }).c.code,
            (response.kind as { t: "Error"; c: { code: string; message: string } }).c.message,
          );
        }
        return response.kind;
      }

      this.eventQueue.push(response);
    }
  }

  /** Check whether reconnect options are configured. */
  private hasReconnectOptions(): boolean {
    return (
      this.options.maxReconnectAttempts !== undefined ||
      this.options.reconnectDelayMs !== undefined ||
      this.options.onReconnect !== undefined ||
      this.options.onReconnectFailed !== undefined
    );
  }

  /** Spawn a process. Returns the process ID. */
  async spawn(
    id: string,
    command: string,
    args: string[] = [],
    env: Record<string, string> | null = null,
    cwd: string | null = null,
  ): Promise<string> {
    const processId = validateProcessId(id);
    const response = await this.request({
      t: "Spawn",
      c: { process_id: processId, command, args, env, cwd },
    });
    if (response.t === "SpawnOk") {
      return response.c.process_id;
    }
    throw new Error(`unexpected response: ${response.t}`);
  }

  /** Kill a process. */
  async kill(id: string, signal?: number): Promise<void> {
    const processId = validateProcessId(id);
    const response = await this.request({
      t: "Kill",
      c: { process_id: processId, signal: signal ?? null },
    });
    if (response.t !== "KillOk") {
      throw new Error(`unexpected response: ${response.t}`);
    }
  }

  /** List all managed processes. */
  async list(): Promise<ProcessInfo[]> {
    const response = await this.request({ t: "List" });
    if (response.t === "ListOk") {
      return response.c.processes;
    }
    throw new Error(`unexpected response: ${response.t}`);
  }

  /** Get info about a specific process. */
  async info(id: string): Promise<ProcessInfo> {
    const processId = validateProcessId(id);
    const response = await this.request({
      t: "GetProcess",
      c: { process_id: processId },
    });
    if (response.t === "GetProcessOk") {
      return response.c.process;
    }
    throw new Error(`unexpected response: ${response.t}`);
  }

  /** Subscribe to events. Returns a Subscription with the server-assigned ID. */
  async subscribe(filter?: EventFilter): Promise<Subscription> {
    const response = await this.request({
      t: "Subscribe",
      c: { filter: filter ?? {} },
    });
    if (response.t === "SubscribeOk") {
      return { id: response.c.subscription_id };
    }
    throw new Error(`unexpected response: ${response.t}`);
  }

  /** Unsubscribe from events. */
  async unsubscribe(subscriptionId: number): Promise<void> {
    const response = await this.request({
      t: "Unsubscribe",
      c: { subscription_id: subscriptionId },
    });
    if (response.t !== "UnsubscribeOk") {
      throw new Error(`unexpected response: ${response.t}`);
    }
  }

  /** Read output buffer for a process. */
  async readBuffer(
    id: string,
    offset?: number,
    limit?: number,
  ): Promise<{ data: string; bytes_read: number; total_written: number }> {
    const processId = validateProcessId(id);
    const response = await this.request({
      t: "ReadBuffer",
      c: { process_id: processId, offset: offset ?? null, limit: limit ?? null },
    });
    if (response.t === "ReadBufferOk") {
      return response.c;
    }
    throw new Error(`unexpected response: ${response.t}`);
  }

  /** Write input data to a process's PTY (stdin). */
  async writeInput(id: string, data: string): Promise<number> {
    const processId = validateProcessId(id);
    const response = await this.request({
      t: "WriteInput",
      c: { process_id: processId, data },
    });
    if (response.t === "WriteInputOk") {
      return response.c.bytes_written;
    }
    throw new Error(`unexpected response: ${response.t}`);
  }

  /** Request daemon shutdown. */
  async shutdown(): Promise<void> {
    const response = await this.request({ t: "Shutdown" });
    if (response.t !== "ShutdownOk") {
      throw new Error(`unexpected response: ${response.t}`);
    }
  }

  /** Read the next pushed event message from the server. */
  async readEvent(): Promise<{ subscription_id: number; event: AxonEvent }> {
    // Drain from internal event queue first
    if (this.eventQueue.length > 0) {
      const msg = this.eventQueue.shift()!;
      if (msg.kind.t === "Event") {
        return (msg.kind as { t: "Event"; c: { subscription_id: number; event: AxonEvent } }).c;
      }
      throw new Error(`expected Event, got ${msg.kind.t}`);
    }

    const msg = await this.codec.readMessage<Message>();
    if (msg.kind.t === "Event") {
      return (msg.kind as { t: "Event"; c: { subscription_id: number; event: AxonEvent } }).c;
    }
    throw new Error(`expected Event, got ${msg.kind.t}`);
  }

  /** Close the connection. */
  close(): void {
    this._connected = false;
    this.socket.destroy();
  }
}
