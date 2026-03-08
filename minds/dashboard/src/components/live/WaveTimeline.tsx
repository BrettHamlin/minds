import { useState } from "react";
import type { Wave, Contract } from "../../hooks/useMindsState";
import { CheckCircle, Loader2 } from "lucide-react";

interface WaveTimelineProps {
  waves: Wave[];
  contracts: Contract[];
}

const STATUS_DOT: Record<string, string> = {
  complete: "bg-green-500",
  active: "bg-violet-500",
  pending: "bg-zinc-500",
  failed: "bg-red-500",
  reviewing: "bg-amber-500",
  merging: "bg-blue-500",
};

const STATUS_LABEL: Record<string, string> = {
  complete: "done",
  active: "active",
  pending: "pending",
  failed: "failed",
  reviewing: "reviewing",
  merging: "merging",
};

function getDepsCount(mindName: string, contracts: Contract[]): number {
  return contracts.filter((c) => c.consumer === mindName).length;
}

export default function WaveTimeline({ waves, contracts }: WaveTimelineProps) {
  const [hoveredMind, setHoveredMind] = useState<string | null>(null);

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: "hsl(222 47% 11%)",
        borderColor: "hsl(217 33% 17%)",
      }}
    >
      <h2 className="text-sm font-medium text-zinc-300 mb-4">Wave Timeline</h2>
      <div className="flex gap-4 overflow-x-auto">
        {waves.map((wave) => (
          <div key={wave.id} className="flex-shrink-0 min-w-[160px]">
            <div className="flex items-center gap-2 mb-3">
              {wave.status === "active" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                  <span className="text-xs text-violet-300">in progress</span>
                </>
              ) : wave.status === "complete" ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs text-green-300">complete</span>
                </>
              ) : (
                <span className="text-xs text-zinc-500">pending</span>
              )}
            </div>

            <p className="text-xs text-zinc-500 mb-2">Wave {wave.id}</p>

            <div className="space-y-1.5">
              {wave.drones.map((drone) => {
                const depsCount = getDepsCount(drone.mindName, contracts);
                const isHovered = hoveredMind === drone.mindName;
                const isRelated =
                  hoveredMind === null ||
                  isHovered ||
                  contracts.some(
                    (c) =>
                      (c.producer === hoveredMind &&
                        c.consumer === drone.mindName) ||
                      (c.consumer === hoveredMind &&
                        c.producer === drone.mindName)
                  );

                return (
                  <div
                    key={drone.mindName}
                    className="relative flex items-center gap-2 rounded-lg border px-3 py-2 cursor-default transition-opacity"
                    style={{
                      background: "hsl(224 71% 4%)",
                      borderColor: "hsl(217 33% 17%)",
                      opacity: isRelated ? 1 : 0.3,
                    }}
                    onMouseEnter={() => setHoveredMind(drone.mindName)}
                    onMouseLeave={() => setHoveredMind(null)}
                  >
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[drone.status] ?? "bg-zinc-500"}`}
                    />
                    <span className="text-xs text-zinc-200 flex-1 truncate">
                      {drone.mindName}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {STATUS_LABEL[drone.status] ?? drone.status}
                    </span>
                    {depsCount > 0 && !hoveredMind && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-violet-700 text-white text-[9px] flex items-center justify-center">
                        {depsCount}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
