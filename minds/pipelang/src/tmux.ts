// Generic tmux utilities for the pipelang runner
// CROSS-MIND: runtime import only — Pipeline Core owns tmux-client
// Re-exports from minds/pipeline_core/tmux-client.ts (WD-2)

export {
  tmux,
  sleepMs,
  sendToPane,
  openAgentPane,
  pollForSignal,
} from "../../../minds/pipeline_core/tmux-client"; // CROSS-MIND
