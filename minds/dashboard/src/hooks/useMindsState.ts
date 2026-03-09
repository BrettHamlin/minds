import { useState, useEffect } from "react";

export interface Drone {
  mindName: string;
  status: "pending" | "active" | "reviewing" | "merging" | "complete" | "failed";
  paneId?: string;
  worktree?: string;
  startedAt?: string;
  completedAt?: string;
  tasks?: number;
  tasksComplete?: number;
  reviewAttempts?: number;
  violations?: number;
  branch?: string;
}

export interface Wave {
  id: string;
  status: "active" | "complete" | "pending";
  drones: Drone[];
  startedAt?: string;
  completedAt?: string;
}

export interface Contract {
  producer: string;
  consumer: string;
  interface: string;
  status: "pending" | "fulfilled";
}

export interface MindsState {
  ticketId: string;
  ticketTitle: string;
  startedAt: string;
  waves: Wave[];
  contracts: Contract[];
  updatedAt: string;
  stats: {
    mindsInvolved: number;
    activeDrones: number;
    currentWave: number;
    totalWaves: number;
    contractsFulfilled: number;
    contractsTotal: number;
  };
}

interface UseMindsStateResult {
  states: MindsState[];
  activeTicket: string | null;
  setActiveTicket: (ticket: string) => void;
  connected: boolean;
}

export function useMindsState(): UseMindsStateResult {
  const [states, setStates] = useState<MindsState[]>([]);
  const [activeTicket, setActiveTicket] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/subscribe/minds-status");

      es.onopen = () => {
        setConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const incoming = JSON.parse(event.data) as MindsState;
          setStates((prev) => {
            const idx = prev.findIndex(
              (s) => s.ticketId === incoming.ticketId
            );
            if (idx === -1) return [...prev, incoming];
            const next = [...prev];
            next[idx] = incoming;
            return next;
          });
          setActiveTicket((t) => t ?? incoming.ticketId);
        } catch {
          // Ignore parse errors
        }
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  return { states, activeTicket, setActiveTicket, connected };
}
