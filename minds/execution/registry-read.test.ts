import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { readRegistry } from "./registry-read";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
  cwd: import.meta.dir,
}).trim();

const REGISTRY_DIR = path.join(REPO_ROOT, ".minds/state/pipeline-registry");
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
    const data = readRegistry(TICKET, REPO_ROOT);
    expect(data.ticket_id).toBe(TICKET);
    expect(data.current_step).toBe("clarify");
    expect(data.nonce).toBe("aabbccdd");
  });

  test("2. throws FILE_NOT_FOUND for unknown ticket", () => {
    expect(() => readRegistry("UNKNOWN-999", REPO_ROOT)).toThrow("Registry not found");
  });
});

describe("registry-read: --field extraction (via execSync)", () => {
  test("3. extracts known field value", () => {
    const { execSync } = require("child_process");
    const out = execSync(
      `bun ${import.meta.dir}/registry-read.ts ${TICKET} --field current_step`,
      { encoding: "utf-8", cwd: REPO_ROOT }
    ).trim();
    expect(out).toBe("clarify");
  });

  test("4. returns default when field is absent", () => {
    const { execSync } = require("child_process");
    const out = execSync(
      `bun ${import.meta.dir}/registry-read.ts ${TICKET} --field code_review_attempts --default 0`,
      { encoding: "utf-8", cwd: REPO_ROOT }
    ).trim();
    expect(out).toBe("0");
  });

  test("5. returns empty string when field absent and no default", () => {
    const { execSync } = require("child_process");
    const out = execSync(
      `bun ${import.meta.dir}/registry-read.ts ${TICKET} --field nonexistent_field`,
      { encoding: "utf-8", cwd: REPO_ROOT }
    ).trim();
    expect(out).toBe("");
  });
});
