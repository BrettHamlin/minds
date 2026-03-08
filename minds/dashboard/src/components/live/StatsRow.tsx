import { Brain, Zap, Layers, Clock, Link } from "lucide-react";
import type { MindsState } from "../../hooks/useMindsState";

interface StatsRowProps {
  stats: MindsState["stats"];
  startedAt: string;
}

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  return (
    <div
      className="flex-1 rounded-xl border p-4 flex items-start gap-3"
      style={{
        background: "hsl(222 47% 11%)",
        borderColor: "hsl(217 33% 17%)",
      }}
    >
      <div className={`mt-0.5 ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-zinc-400">{label}</p>
        <p className="text-lg font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

export default function StatsRow({ stats, startedAt }: StatsRowProps) {
  return (
    <div className="flex gap-4">
      <StatCard
        icon={<Brain className="w-4 h-4" />}
        label="Minds Involved"
        value={String(stats.mindsInvolved)}
        color="text-violet-400"
      />
      <StatCard
        icon={<Zap className="w-4 h-4" />}
        label="Active Drones"
        value={String(stats.activeDrones)}
        color="text-amber-400"
      />
      <StatCard
        icon={<Layers className="w-4 h-4" />}
        label="Current Wave"
        value={`${stats.currentWave} / ${stats.totalWaves}`}
        color="text-blue-400"
      />
      <StatCard
        icon={<Clock className="w-4 h-4" />}
        label="Elapsed"
        value={startedAt ? elapsed(startedAt) : "\u2014"}
        color="text-green-400"
      />
      <StatCard
        icon={<Link className="w-4 h-4" />}
        label="Contracts"
        value={`${stats.contractsFulfilled} / ${stats.contractsTotal}`}
        color="text-cyan-400"
      />
    </div>
  );
}
