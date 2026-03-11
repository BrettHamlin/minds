/**
 * terminal-multiplexer.ts -- Abstract interface for terminal multiplexer operations.
 *
 * Consumers should depend on this interface rather than calling tmux directly.
 * Currently only TmuxMultiplexer exists, but the interface makes it straightforward
 * to add zellij or another backend in the future.
 */

export interface TerminalMultiplexer {
  /** Split a new pane from a source pane. Returns the new pane ID. */
  splitPane(sourcePane: string): string;

  /** Send a command string to a pane (like typing + Enter). */
  sendKeys(paneId: string, command: string): void;

  /** Kill/close a pane. Should not throw if pane is already gone. */
  killPane(paneId: string): void;

  /** Check if a pane is still alive. */
  isPaneAlive(paneId: string): boolean;

  /** Get the current pane ID. */
  getCurrentPane(): string;

  /** Capture the visible content of a pane (for monitoring). */
  capturePane(paneId: string): string;
}
