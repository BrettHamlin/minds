import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { readRegistry } from "./registry-read";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
  cwd: import.meta.dir,
}).trim();

const REGISTRY_DIR = path.join(REPO_ROOT, ".collab/state/pipeline-registry");
const TICKET = "TEST-RR-001";
const TICKET_FILE = path.join(REGISTRY_DIR, `${TICKET}.json`);

const FIXTURE = {
  ticket_id: TICKET,
  nonce: "aabbccdd",
  current_step: "clarify",
  status: "running",
  phase_history: [],
};

beforeAll(() => {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.writeFileSync(TICKET_FILE, JSON.stringify(FIXTURE, null, 2));
});

afterAll(() => {
  if (fs.existsSync(TICKET_FILE)) fs.unlinkSync(TICKET_FILE);
});

describe("registry-read: readRegistry()", () => {
  test("1. returns registry data for known ticket", () => {
    const data = readRegistry(TICKET, REGISTRY_DIR);
    expect(data.ticket_id).toBe(TICKET);
    expect(data.current_step).toBe("clarify");
    expect(data.nonce).toBe("aabbccdd");
  });

  test("2. throws FILE_NOT_FOUND for unknown ticket", () => {
    expect(() => readRegistry("UNKNOWN-999", REGISTRY_DIR)).toThrow("Registry not found");
  });
});
