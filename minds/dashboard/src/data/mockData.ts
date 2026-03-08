import type { MindsState } from "../hooks/useMindsState";

export const mockStates: MindsState[] = [
  {
    ticketId: "BRE-445",
    ticketTitle: "Minds Live Dashboard",
    startedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    waves: [
      {
        id: "1",
        status: "complete",
        completedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        startedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        drones: [
          {
            mindName: "transport",
            status: "complete",
            startedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
            completedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
            tasks: 4,
            tasksComplete: 4,
            branch: "minds/BRE-445-transport",
            worktree: "/tmp/collab-BRE-445-transport",
          },
          {
            mindName: "signals",
            status: "complete",
            startedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
            completedAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
            tasks: 3,
            tasksComplete: 3,
            branch: "minds/BRE-445-signals",
            worktree: "/tmp/collab-BRE-445-signals",
          },
        ],
      },
      {
        id: "2",
        status: "active",
        startedAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
        drones: [
          {
            mindName: "dashboard",
            status: "active",
            startedAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
            tasks: 12,
            tasksComplete: 5,
            branch: "minds/BRE-445-dashboard",
            worktree: "/tmp/collab-BRE-445-dashboard",
          },
          {
            mindName: "aggregator",
            status: "reviewing",
            startedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
            tasks: 6,
            tasksComplete: 6,
            reviewAttempts: 1,
            branch: "minds/BRE-445-aggregator",
            worktree: "/tmp/collab-BRE-445-aggregator",
          },
          {
            mindName: "cli",
            status: "pending",
          },
        ],
      },
      {
        id: "3",
        status: "pending",
        drones: [
          { mindName: "testing", status: "pending" },
          { mindName: "docs", status: "pending" },
        ],
      },
    ],
    contracts: [
      {
        producer: "transport",
        consumer: "dashboard",
        interface: "MindsStateTracker",
        status: "fulfilled",
      },
      {
        producer: "transport",
        consumer: "aggregator",
        interface: "StatusAggregator routes",
        status: "fulfilled",
      },
      {
        producer: "signals",
        consumer: "dashboard",
        interface: "MindsEventType",
        status: "fulfilled",
      },
      {
        producer: "dashboard",
        consumer: "cli",
        interface: "createMindsRouteHandler",
        status: "pending",
      },
      {
        producer: "aggregator",
        consumer: "dashboard",
        interface: "aggregator instance",
        status: "pending",
      },
      {
        producer: "dashboard",
        consumer: "testing",
        interface: "SSE endpoint",
        status: "pending",
      },
      {
        producer: "transport",
        consumer: "testing",
        interface: "MindsBusMessage",
        status: "fulfilled",
      },
      {
        producer: "signals",
        consumer: "testing",
        interface: "signal validation",
        status: "fulfilled",
      },
    ],
    stats: {
      mindsInvolved: 5,
      activeDrones: 2,
      currentWave: 2,
      totalWaves: 3,
      contractsFulfilled: 5,
      contractsTotal: 8,
    },
  },
];
