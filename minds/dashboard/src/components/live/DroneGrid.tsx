import { useState, useEffect, useRef } from "react";
import type { Wave, Drone } from "../../hooks/useMindsState";
import { GitMerge, Clock, AlertTriangle } from "lucide-react";

interface DroneGridProps {
  waves: Wave[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-zinc-400 bg-zinc-800",
  active: "text-violet-300 bg-violet-900/40",
  reviewing: "text-amber-300 bg-amber-900/40",
  merging: "text-blue-300 bg-blue-900/40",
  complete: "text-green-300 bg-green-900/40",
  failed: "text-red-300 bg-red-900/40",
};

function elapsed(startedAt?: string): string {
  if (!startedAt) return "\u2014";
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// DroneCard — individual drone tile with tool-activity fade and error expand
// ---------------------------------------------------------------------------

function DroneCard({ drone }: { drone: Drone }) {
  const [toolOpacity, setToolOpacity] = useState(0);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLastTool = useRef<string | undefined>(undefined);

  // Fade in on lastTool change, fade out after 3s
  useEffect(() => {
    if (drone.lastTool && drone.lastTool !== prevLastTool.current) {
      prevLastTool.current = drone.lastTool;
      setToolOpacity(1);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = setTimeout(() => setToolOpacity(0), 3000);
    }
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [drone.lastTool]);

  const progress =
    drone.tasks && drone.tasks > 0
      ? Math.round(((drone.tasksComplete ?? 0) / drone.tasks) * 100)
      : 0;

  const hasErrors = (drone.errors?.length ?? 0) > 0;

  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      style={{
        background: "hsl(224 71% 4%)",
        borderColor: "hsl(217 33% 17%)",
      }}
    >
      {/* Header row: name + tool activity + error dot + status badge */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-zinc-200 truncate">
            {drone.mindName}
          </span>
          {/* Tool activity indicator — fades after 3s */}
          {drone.lastTool && (
            <span
              className="text-[9px] text-violet-400 truncate transition-opacity duration-700"
              style={{ opacity: toolOpacity }}
            >
              {drone.lastTool}
            </span>
          )}
          {/* Error indicator */}
          {hasErrors && (
            <button
              type="button"
              onClick={() => setErrorsOpen((o) => !o)}
              className="flex-shrink-0 w-2 h-2 rounded-full bg-red-500 hover:bg-red-400 transition-colors"
              title={`${drone.errors!.length} error(s) — click to expand`}
            />
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Tool count badge */}
          {(drone.toolCount ?? 0) > 0 && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
              {drone.toolCount}
            </span>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[drone.status] ?? ""}`}
          >
            {drone.status}
          </span>
        </div>
      </div>

      {/* Expandable error list */}
      {hasErrors && errorsOpen && (
        <div className="rounded bg-red-950/30 border border-red-900/40 p-1.5 space-y-0.5">
          {drone.errors!.map((err, i) => (
            <p key={i} className="text-[9px] text-red-300 break-words">
              {err}
            </p>
          ))}
        </div>
      )}

      {/* Task progress */}
      {drone.tasks !== undefined && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span>Tasks</span>
            <span>
              {drone.tasksComplete ?? 0} / {drone.tasks}
            </span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer: elapsed + review attempts + branch */}
      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {elapsed(drone.startedAt)}
        </span>
        {(drone.reviewAttempts ?? 0) > 0 && (
          <span className="flex items-center gap-1 text-amber-500">
            <AlertTriangle className="w-3 h-3" />
            {drone.reviewAttempts}x
          </span>
        )}
        {drone.status === "complete" || drone.status === "merging" ? (
          <span className="flex items-center gap-1 text-green-500">
            <GitMerge className="w-3 h-3" />
            {drone.branch ?? "merged"}
          </span>
        ) : null}
      </div>

      {drone.worktree && (
        <p className="text-[9px] text-zinc-600 truncate">{drone.worktree}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DroneGrid
// ---------------------------------------------------------------------------

export default function DroneGrid({ waves }: DroneGridProps) {
  const allDrones = waves.flatMap((w) => w.drones);
  if (allDrones.length === 0) return null;

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: "hsl(222 47% 11%)",
        borderColor: "hsl(217 33% 17%)",
      }}
    >
      <h2 className="text-sm font-medium text-zinc-300 mb-4">Drones</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {allDrones.map((drone) => (
          <DroneCard
            key={`${drone.mindName}-${drone.paneId ?? ""}`}
            drone={drone}
          />
        ))}
      </div>
    </div>
  );
}
