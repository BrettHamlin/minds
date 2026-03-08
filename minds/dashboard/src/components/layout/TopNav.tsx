import { Brain } from "lucide-react";
import { useMindsState } from "../../hooks/useMindsState";

type Tab = "live" | "history" | "plan";

interface TopNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export default function TopNav({ activeTab, onTabChange }: TopNavProps) {
  const { connected } = useMindsState();

  return (
    <nav
      className="h-16 flex items-center px-6 gap-6 border-b"
      style={{
        background: "hsl(224 71% 4%)",
        borderColor: "hsl(217 33% 17%)",
      }}
    >
      <div className="flex items-center gap-2 mr-4">
        <Brain className="w-5 h-5 text-violet-500" />
        <span className="font-semibold text-white">Minds</span>
      </div>

      <div className="flex gap-1">
        {(["live", "history", "plan"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === t
                ? "bg-violet-500/20 text-violet-300"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-zinc-500">
          {connected ? "Connected" : "Disconnected"}
        </span>
        <div
          className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
        />
      </div>
    </nav>
  );
}
