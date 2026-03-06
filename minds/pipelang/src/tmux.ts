// Generic tmux utilities for the pipelang runner
// CROSS-MIND: runtime import only — Pipeline Core owns tmux-client
// Re-exports from shared library at src/lib/pipeline/tmux-client.ts

export {
  tmux,
  sleepMs,
  sendToPane,
  openAgentPane,
  pollForSignal,
} from "../../../src/lib/pipeline/tmux-client";
