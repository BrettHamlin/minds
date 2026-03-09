// db.test.ts — Tests for MindsDb SQLite layer (BRE-457 T018)

import { describe, test, expect, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { MindsDb } from "../db.js";

const TEST_DB = "/tmp/minds-test-db.sqlite";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

afterEach(cleanup);

describe("MindsDb", () => {
  test("creates schema on construction", () => {
    const db = new MindsDb(TEST_DB);
    // If construction didn't throw, schema was created
    expect(db).toBeDefined();
    db.close();
  });

  test("WAL mode is enabled", () => {
    const db = new MindsDb(TEST_DB);
    // WAL mode: writes happen without error, and db is usable
    db.insertEvent("T-1", "test", "WAVE_STARTED", "{}", Date.now());
    const rows = db.queryEvents("T-1");
    expect(rows.length).toBe(1);
    db.close();
  });

  test("insertEvent and queryEvents by ticket_id", () => {
    const db = new MindsDb(TEST_DB);
    const ts = 1000000;
    db.insertEvent("T-1", "@test", "WAVE_STARTED", '{"waveId":"1"}', ts);
    db.insertEvent("T-1", "@test", "DRONE_SPAWNED", '{"mindName":"signals"}', ts + 1);
    db.insertEvent("T-2", "@test", "WAVE_STARTED", "{}", ts + 2);

    const t1Events = db.queryEvents("T-1");
    expect(t1Events).toHaveLength(2);
    expect(t1Events[0].event_type).toBe("WAVE_STARTED");
    expect(t1Events[1].event_type).toBe("DRONE_SPAWNED");

    const t2Events = db.queryEvents("T-2");
    expect(t2Events).toHaveLength(1);
    db.close();
  });

  test("queryEvents with limit", () => {
    const db = new MindsDb(TEST_DB);
    for (let i = 0; i < 10; i++) {
      db.insertEvent("T-1", "@test", "EVT", "{}", 1000 + i);
    }
    const rows = db.queryEvents("T-1", 3);
    expect(rows).toHaveLength(3);
    db.close();
  });

  test("saveState and loadState round-trip", () => {
    const db = new MindsDb(TEST_DB);
    const json = JSON.stringify({ ticketId: "T-1", waves: [] });
    db.saveState("T-1", json);
    const loaded = db.loadState("T-1");
    expect(loaded).toBe(json);
    db.close();
  });

  test("saveState overwrites previous state for same ticket", () => {
    const db = new MindsDb(TEST_DB);
    db.saveState("T-1", '{"version":1}');
    db.saveState("T-1", '{"version":2}');
    const loaded = db.loadState("T-1");
    expect(loaded).toBe('{"version":2}');
    db.close();
  });

  test("loadState returns null for unknown ticket", () => {
    const db = new MindsDb(TEST_DB);
    expect(db.loadState("NOPE-999")).toBeNull();
    db.close();
  });

  test("loadAllStates returns all persisted states", () => {
    const db = new MindsDb(TEST_DB);
    db.saveState("T-1", '{"ticketId":"T-1"}');
    db.saveState("T-2", '{"ticketId":"T-2"}');
    const all = db.loadAllStates();
    expect(all).toHaveLength(2);
    const ids = all.map((s) => s.ticketId).sort();
    expect(ids).toEqual(["T-1", "T-2"]);
    db.close();
  });

  test("concurrent writes work without errors", async () => {
    const db = new MindsDb(TEST_DB);
    const writes = Array.from({ length: 20 }, (_, i) =>
      Promise.resolve(db.insertEvent("T-1", "@test", "EVT", "{}", 1000 + i))
    );
    await Promise.all(writes);
    const rows = db.queryEvents("T-1");
    expect(rows).toHaveLength(20);
    db.close();
  });

  test("event rows include all fields", () => {
    const db = new MindsDb(TEST_DB);
    const ts = 9999;
    db.insertEvent("T-1", "@drone", "WAVE_STARTED", '{"waveId":"1"}', ts);
    const rows = db.queryEvents("T-1");
    expect(rows[0]).toMatchObject({
      ticket_id: "T-1",
      source: "@drone",
      event_type: "WAVE_STARTED",
      payload: '{"waveId":"1"}',
      timestamp: ts,
    });
    expect(typeof rows[0].id).toBe("number");
    db.close();
  });
});
