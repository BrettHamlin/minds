import TopNav from "./components/layout/TopNav";
import LiveView from "./components/live/LiveView";
import { useState } from "react";

type Tab = "live" | "history" | "plan";

export default function App() {
  const [tab, setTab] = useState<Tab>("live");

  return (
    <div className="min-h-screen" style={{ background: "hsl(224 71% 4%)" }}>
      <TopNav activeTab={tab} onTabChange={setTab} />
      <main className="p-6">
        {tab === "live" && <LiveView />}
        {tab === "history" && (
          <div className="text-zinc-400">History coming soon</div>
        )}
        {tab === "plan" && (
          <div className="text-zinc-400">Plan view coming soon</div>
        )}
      </main>
    </div>
  );
}
