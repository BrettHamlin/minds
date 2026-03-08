// status-derive.ts — Shared status derivation functions for transport layer
//
// Inlined from src/scripts/orchestrator/commands/status-table.ts to avoid
// cross-directory imports that break when transport/ is installed to .collab/transport/.

export function deriveStatus(reg: Record<string, unknown>): string {
  const status = reg.status as string | undefined;
  if (status) return status;

  const lastSignal = reg.last_signal as string | undefined;
  if (!lastSignal) return "running";
  if (lastSignal.endsWith("_COMPLETE")) return "completed";
  if (lastSignal.endsWith("_ERROR")) return "error";
  if (lastSignal.endsWith("_FAILED")) return "failed";
  if (lastSignal.endsWith("_WAITING")) return "waiting";
  if (lastSignal.endsWith("_QUESTION")) return "needs_input";
  return "running";
}

export function deriveDetail(reg: Record<string, unknown>): string {
  const COL_DETAIL = 30;
  const status = reg.status as string | undefined;
  if (status === "held") {
    const waitingFor = (reg.waiting_for as string) || "unknown";
    return `held | waiting for ${waitingFor}`.substring(0, COL_DETAIL);
  }

  const currentStep = reg.current_step as string | undefined;
  const phasePlan = reg.implement_phase_plan as
    | { total_phases: number; current_impl_phase: number }
    | undefined;
  if (currentStep === "implement" && phasePlan) {
    return `impl ${phasePlan.current_impl_phase}/${phasePlan.total_phases}`.substring(0, COL_DETAIL);
  }

  const lastSignal = reg.last_signal as string | undefined;
  const lastSignalAt = reg.last_signal_at as string | undefined;
  if (lastSignal && lastSignalAt) {
    return `${lastSignal} @ ${lastSignalAt}`.substring(0, COL_DETAIL);
  }

  const step = (reg.current_step as string) || "unknown";
  return `Working on ${step} phase`.substring(0, COL_DETAIL);
}
