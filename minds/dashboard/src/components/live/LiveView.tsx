import { useMindsState } from "../../hooks/useMindsState";
import RunSwitcher from "./RunSwitcher";
import StatsRow from "./StatsRow";
import WaveTimeline from "./WaveTimeline";
import DroneGrid from "./DroneGrid";
import ContractFlow from "./ContractFlow";

export default function LiveView() {
  const { states, activeTicket, setActiveTicket } = useMindsState();
  const state = states.find((s) => s.ticketId === activeTicket) ?? states[0];

  if (!state) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500">
        No active Minds runs. Waiting for events...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">
            {state.ticketId}
          </h1>
          <p className="text-sm text-zinc-400">
            {state.ticketTitle || "Minds Execution"}
          </p>
        </div>
        <div className="ml-auto">
          <RunSwitcher
            tickets={states.map((s) => s.ticketId)}
            activeTicket={activeTicket ?? ""}
            onSelect={setActiveTicket}
          />
        </div>
      </div>

      <StatsRow stats={state.stats} startedAt={state.startedAt} />
      <WaveTimeline waves={state.waves} contracts={state.contracts} />
      <DroneGrid waves={state.waves} />
      <ContractFlow waves={state.waves} contracts={state.contracts} />
    </div>
  );
}
