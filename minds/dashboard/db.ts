// db.ts — SQLite persistence layer for Minds dashboard (BRE-457)
//
// Uses bun:sqlite (zero external deps). WAL mode for concurrent reads.
// DB file: .collab/state/minds-dashboard.db

import { Database } from "bun:sqlite";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id  TEXT    NOT NULL,
    source     TEXT    NOT NULL,
    event_type TEXT    NOT NULL,
    payload    TEXT    NOT NULL,
    timestamp  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_ticket_id ON events(ticket_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp)`,
  `CREATE TABLE IF NOT EXISTS mind_states (
    ticket_id  TEXT    PRIMARY KEY,
    state_json TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

export interface EventRow {
  id: number;
  ticket_id: string;
  source: string;
  event_type: string;
  payload: string;
  timestamp: number;
}

export class MindsDb {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    for (const stmt of SCHEMA_STATEMENTS) {
      this.db.exec(stmt);
    }
  }

  insertEvent(
    ticketId: string,
    source: string,
    eventType: string,
    payload: string,
    timestamp: number,
  ): void {
    this.db
      .prepare(
        "INSERT INTO events (ticket_id, source, event_type, payload, timestamp) VALUES (?, ?, ?, ?, ?)",
      )
      .run(ticketId, source, eventType, payload, timestamp);
  }

  queryEvents(ticketId: string, limit?: number): EventRow[] {
    if (limit !== undefined) {
      return this.db
        .prepare(
          "SELECT * FROM events WHERE ticket_id = ? ORDER BY timestamp ASC LIMIT ?",
        )
        .all(ticketId, limit) as EventRow[];
    }
    return this.db
      .prepare(
        "SELECT * FROM events WHERE ticket_id = ? ORDER BY timestamp ASC",
      )
      .all(ticketId) as EventRow[];
  }

  saveState(ticketId: string, stateJson: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO mind_states (ticket_id, state_json, updated_at) VALUES (?, ?, ?)",
      )
      .run(ticketId, stateJson, Date.now());
  }

  loadState(ticketId: string): string | null {
    const row = this.db
      .prepare("SELECT state_json FROM mind_states WHERE ticket_id = ?")
      .get(ticketId) as { state_json: string } | null;
    return row?.state_json ?? null;
  }

  loadAllStates(): Array<{ ticketId: string; stateJson: string }> {
    const rows = this.db
      .prepare("SELECT ticket_id, state_json FROM mind_states")
      .all() as Array<{ ticket_id: string; state_json: string }>;
    return rows.map((r) => ({ ticketId: r.ticket_id, stateJson: r.state_json }));
  }

  close(): void {
    this.db.close();
  }
}
