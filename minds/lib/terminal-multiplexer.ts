/**
 * terminal-multiplexer.ts -- Abstract interface for terminal multiplexer operations.
 *
 * Consumers should depend on this interface rather than calling tmux directly.
 * Currently only TmuxMultiplexer exists, but the interface makes it straightforward
 * to add zellij or another backend in the future.
 */

export interface TerminalMultiplexer {
  /** Split a new pane from a source pane. Returns the new pane ID. */
  splitPane(sourcePane: string): Promise<string>;

  /** Send a command string to a pane (like typing + Enter). */
  sendKeys(paneId: string, command: string): Promise<void>;

  /** Kill/close a pane. Should not throw if pane is already gone. */
  killPane(paneId: string): Promise<void>;

  /** Check if a pane is still alive. */
  isPaneAlive(paneId: string): Promise<boolean>;

  /** Get the current pane ID. */
  getCurrentPane(): Promise<string>;

  /** Capture the visible content of a pane (for monitoring). */
  capturePane(paneId: string): Promise<string>;
}
