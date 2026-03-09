import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateGroupId, cmdCreate, cmdAdd, cmdQuery, cmdList } from "./group-manage";
import { writeJsonAtomic } from "../pipeline_core";

let tmpDir: string;
let groupsDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-gm-"));
  const registryDir = path.join(tmpDir, ".minds", "state", "pipeline-registry");
  groupsDir = path.join(tmpDir, "groups");
  fs.mkdirSync(registryDir, { recursive: true });
  fs.mkdirSync(groupsDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeReg(ticketId: string, data: Record<string, unknown> = {}): void {
  const registryDir = path.join(tmpDir, ".minds", "state", "pipeline-registry");
  writeJsonAtomic(path.join(registryDir, `${ticketId}.json`), {
    ticket_id: ticketId,
    current_step: "clarify",
    status: "running",
    ...data,
  });
}

describe("group-manage: generateGroupId()", () => {
  test("1. same ticket IDs → same group ID", () => {
    const a = generateGroupId(["BRE-1", "BRE-2"]);
    const b = generateGroupId(["BRE-2", "BRE-1"]);
    expect(a).toBe(b);
  });

  test("2. different ticket IDs → different group IDs", () => {
    const a = generateGroupId(["BRE-1", "BRE-2"]);
    const b = generateGroupId(["BRE-1", "BRE-3"]);
    expect(a).not.toBe(b);
  });

  test("3. returns 12-char hex string", () => {
    const id = generateGroupId(["A", "B"]);
    expect(id).toMatch(/^[a-f0-9]{12}$/);
  });
});

describe("group-manage: cmdCreate()", () => {
  test("4. creates group and returns group object", () => {
    writeReg("T-001");
    writeReg("T-002");
    const group = cmdCreate(["T-001", "T-002"], tmpDir, groupsDir);
    expect(group.tickets).toContain("T-001");
    expect(group.tickets).toContain("T-002");
    expect(group.group_id).toMatch(/^[a-f0-9]{12}$/);
  });

  test("5. throws USAGE for fewer than 2 tickets", () => {
    expect(() => cmdCreate(["T-001"], tmpDir, groupsDir)).toThrow("at least 2");
  });

  test("6. throws VALIDATION for unknown ticket", () => {
    expect(() => cmdCreate(["T-001", "UNKNOWN-999"], tmpDir, groupsDir)).toThrow(
      "No registry for ticket"
    );
  });
});

describe("group-manage: cmdAdd()", () => {
  test("7. adds ticket to existing group", () => {
    writeReg("T-010");
    writeReg("T-011");
    writeReg("T-012");
    const group = cmdCreate(["T-010", "T-011"], tmpDir, groupsDir);
    const updated = cmdAdd(group.group_id, "T-012", tmpDir, groupsDir);
    expect(updated.tickets).toContain("T-012");
  });
});

describe("group-manage: cmdQuery()", () => {
  test("8. query ticket with no group returns null group_id", () => {
    writeReg("T-020");
    const result = cmdQuery("T-020", tmpDir, groupsDir);
    expect(result.group_id).toBeNull();
  });

  test("9. query ticket in group returns group data", () => {
    writeReg("T-030");
    writeReg("T-031");
    const group = cmdCreate(["T-030", "T-031"], tmpDir, groupsDir);
    const result = cmdQuery("T-030", tmpDir, groupsDir);
    expect(result.group_id).toBe(group.group_id);
  });
});

describe("group-manage: cmdList()", () => {
  test("10. list returns ticket statuses", () => {
    writeReg("T-040");
    writeReg("T-041");
    const group = cmdCreate(["T-040", "T-041"], tmpDir, groupsDir);
    const result = cmdList(group.group_id, tmpDir, groupsDir);
    expect(result.count).toBe(2);
    const tickets = result.tickets as Array<{ ticket_id: string }>;
    expect(tickets.map((t) => t.ticket_id)).toContain("T-040");
  });
});
