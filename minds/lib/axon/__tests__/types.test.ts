/**
 * types.test.ts -- Tests for Axon wire protocol type definitions.
 *
 * Validates ProcessId branded type, discriminated unions, and type guards.
 */

import { describe, test, expect } from "bun:test";
import {
  validateProcessId,
  type ProcessId,
  type Message,
  type MessageKind,
  type HandshakeMessage,
  type ProcessState,
  type ProcessInfo,
  type AxonEvent,
  type EventFilter,
  AxonError,
} from "../types.ts";

describe("ProcessId validation", () => {
  test("accepts valid alphanumeric IDs", () => {
    expect(validateProcessId("my-proc")).toBe("my-proc");
    expect(validateProcessId("proc_123")).toBe("proc_123");
    expect(validateProcessId("a")).toBe("a");
    expect(validateProcessId("A")).toBe("A");
  });

  test("accepts IDs at max length (64 chars)", () => {
    const maxId = "a".repeat(64);
    expect(validateProcessId(maxId)).toBe(maxId);
  });

  test("rejects empty string", () => {
    expect(() => validateProcessId("")).toThrow("Invalid process ID");
  });

  test("rejects IDs exceeding 64 characters", () => {
    const tooLong = "a".repeat(65);
    expect(() => validateProcessId(tooLong)).toThrow("Invalid process ID");
  });

  test("rejects IDs with invalid characters", () => {
    expect(() => validateProcessId("hello world")).toThrow("Invalid process ID");
    expect(() => validateProcessId("proc.name")).toThrow("Invalid process ID");
    expect(() => validateProcessId("proc/name")).toThrow("Invalid process ID");
    expect(() => validateProcessId("proc@name")).toThrow("Invalid process ID");
  });

  test("returns a branded ProcessId type", () => {
    const id: ProcessId = validateProcessId("valid-id");
    // The branded type is still a string at runtime
    expect(typeof id).toBe("string");
  });
});

describe("AxonError", () => {
  test("has code and message properties", () => {
    const err = new AxonError("PROCESS_NOT_FOUND", "process not found: foo");
    expect(err.code).toBe("PROCESS_NOT_FOUND");
    expect(err.message).toBe("process not found: foo");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AxonError);
  });

  test("name is AxonError", () => {
    const err = new AxonError("TEST", "test message");
    expect(err.name).toBe("AxonError");
  });
});

describe("Wire format shape validation", () => {
  test("Message has id and kind fields", () => {
    const msg: Message = {
      id: 1,
      kind: { t: "List", c: null },
    };
    expect(msg.id).toBe(1);
    expect(msg.kind.t).toBe("List");
  });

  test("MessageKind List has null content", () => {
    const kind: MessageKind = { t: "List", c: null };
    expect(kind.t).toBe("List");
    expect(kind.c).toBeNull();
  });

  test("MessageKind Spawn has structured content", () => {
    const kind: MessageKind = {
      t: "Spawn",
      c: {
        process_id: "my-proc" as ProcessId,
        command: "/bin/echo",
        args: ["hello"],
        env: null,
      },
    };
    expect(kind.t).toBe("Spawn");
    if (kind.t === "Spawn") {
      expect(kind.c.command).toBe("/bin/echo");
    }
  });

  test("MessageKind ListOk has processes array", () => {
    const kind: MessageKind = {
      t: "ListOk",
      c: { processes: [] },
    };
    if (kind.t === "ListOk") {
      expect(kind.c.processes).toEqual([]);
    }
  });

  test("MessageKind Error has code and message", () => {
    const kind: MessageKind = {
      t: "Error",
      c: { code: "PROCESS_NOT_FOUND", message: "not found" },
    };
    if (kind.t === "Error") {
      expect(kind.c.code).toBe("PROCESS_NOT_FOUND");
    }
  });

  test("HandshakeMessage Hello variant", () => {
    const msg: HandshakeMessage = {
      t: "Hello",
      c: { version: "0.1.0", client_name: "axon-ts" },
    };
    expect(msg.t).toBe("Hello");
  });

  test("HandshakeMessage Ok variant", () => {
    const msg: HandshakeMessage = {
      t: "Ok",
      c: { version: "0.1.0", session_id: "sess-123" },
    };
    expect(msg.t).toBe("Ok");
  });

  test("ProcessState simple variants", () => {
    const starting: ProcessState = "Starting";
    const running: ProcessState = "Running";
    const stopping: ProcessState = "Stopping";
    expect(starting).toBe("Starting");
    expect(running).toBe("Running");
    expect(stopping).toBe("Stopping");
  });

  test("ProcessState Exited variant", () => {
    const exited: ProcessState = { Exited: { exit_code: 0 } };
    expect(exited).toEqual({ Exited: { exit_code: 0 } });
  });

  test("ProcessState Exited with null exit_code", () => {
    const exited: ProcessState = { Exited: { exit_code: null } };
    expect(exited).toEqual({ Exited: { exit_code: null } });
  });

  test("AxonEvent Spawned variant", () => {
    const event: AxonEvent = {
      t: "Spawned",
      c: { process_id: "proc-1" as ProcessId, command: "echo", timestamp: 123 },
    };
    expect(event.t).toBe("Spawned");
  });

  test("AxonEvent OutputLine variant", () => {
    const event: AxonEvent = {
      t: "OutputLine",
      c: {
        process_id: "proc-1" as ProcessId,
        stream: "Stdout",
        line: "hello",
        timestamp: 123,
      },
    };
    if (event.t === "OutputLine") {
      expect(event.c.stream).toBe("Stdout");
    }
  });

  test("EventFilter with all optional fields", () => {
    const empty: EventFilter = {};
    const withIds: EventFilter = { process_ids: ["a" as ProcessId] };
    const withTypes: EventFilter = { event_types: ["Spawned"] };
    const full: EventFilter = {
      process_ids: ["a" as ProcessId],
      event_types: ["Spawned", "Exited"],
    };
    expect(empty).toEqual({});
    expect(withIds.process_ids).toHaveLength(1);
    expect(withTypes.event_types).toHaveLength(1);
    expect(full.process_ids).toHaveLength(1);
    expect(full.event_types).toHaveLength(2);
  });
});
