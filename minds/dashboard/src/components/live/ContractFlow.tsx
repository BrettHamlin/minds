import { useState } from "react";
import type { Wave, Contract } from "../../hooks/useMindsState";

interface ContractFlowProps {
  waves: Wave[];
  contracts: Contract[];
}

export default function ContractFlow({
  waves: _waves,
  contracts,
}: ContractFlowProps) {
  const [expanded, setExpanded] = useState(false);

  if (contracts.length === 0) return null;

  const fulfilled = contracts.filter((c) => c.status === "fulfilled");

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: "hsl(222 47% 11%)",
        borderColor: "hsl(217 33% 17%)",
      }}
    >
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <h2 className="text-sm font-medium text-zinc-300">
          Contracts ({fulfilled.length}/{contracts.length} fulfilled)
        </h2>
        <span className="text-zinc-500 text-xs ml-auto">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {contracts.map((c, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="text-zinc-400 font-mono">{c.producer}</span>
              <svg width="40" height="12" viewBox="0 0 40 12">
                <line
                  x1="0"
                  y1="6"
                  x2="34"
                  y2="6"
                  stroke={c.status === "fulfilled" ? "#22c55e" : "#8b5cf6"}
                  strokeWidth="1.5"
                  strokeDasharray={
                    c.status === "pending" ? "3 2" : undefined
                  }
                />
                <polygon
                  points="34,3 40,6 34,9"
                  fill={c.status === "fulfilled" ? "#22c55e" : "#8b5cf6"}
                />
              </svg>
              <span className="text-zinc-400 font-mono">{c.consumer}</span>
              <span className="text-zinc-600 flex-1 truncate">
                {c.interface}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  c.status === "fulfilled"
                    ? "text-green-300 bg-green-900/40"
                    : "text-violet-300 bg-violet-900/40"
                }`}
              >
                {c.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
