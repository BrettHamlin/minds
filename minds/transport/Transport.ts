// Transport abstraction layer for agent communication (BRE-347)
//
// Defines the pluggable interface that all pipeline orchestration code
// uses to communicate with agents. Concrete implementations:
//   TmuxTransport — wraps existing tmux send-keys / capture-pane behavior
//   BusTransport  — SSE-based message bus (BRE-345)

export interface Message {
  /** Auto-generated UUID */
  id: string;
  /** Logical channel name (maps to pane ID in tmux, topic in bus) */
  channel: string;
  /** Agent identifier that sent this message */
  from: string;
  /** Message type: "started" | "progress" | "blocked" | "done" | "error" | signal name */
  type: string;
  /** Arbitrary message payload */
  payload: unknown;
  /** Unix timestamp in ms */
  timestamp: number;
}

/** Call to stop receiving messages on a subscribed channel */
export type Unsubscribe = () => void;

export interface Transport {
  /**
   * Send a message to a channel.
   * In TmuxTransport: sends text to the tmux pane identified by `channel`.
   * In BusTransport: POSTs to the bus server.
   */
  publish(channel: string, message: Omit<Message, "id" | "timestamp">): Promise<void>;

  /**
   * Listen for messages on a channel.
   * In TmuxTransport: polls capture-pane every 250ms for [SIGNAL] lines.
   * In BusTransport: subscribes to SSE stream.
   * Returns an unsubscribe function to stop listening.
   */
  subscribe(channel: string, handler: (msg: Message) => void): Promise<Unsubscribe>;

  /** Release all resources held by this transport instance. */
  teardown(): Promise<void>;

  /**
   * Returns the instructions an agent should follow to send messages back
   * through this transport. Injected into the agent's initial prompt.
   *
   * @param agentId - Unique identifier for the agent instance
   * @param channel - The channel the agent should publish to
   */
  agentPrompt(agentId: string, channel: string): string;
}
