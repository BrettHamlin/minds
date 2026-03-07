import { describe, it, expect } from "bun:test";
import { matchIntent } from "./intent";

const PIPELINE_CORE_CAPS = [
  "load pipeline for ticket",
  "resolve signal name",
  "get registry path",
  "resolve transition",
  "find feature dir",
  "read feature metadata",
  "validate ticket id",
  "read json file",
];

const EXECUTION_CAPS = [
  "dispatch phase",
  "evaluate gate",
  "validate signal",
  "advance phase",
  "init orchestrator",
  "resolve execution mode",
  "resolve retry config",
  "analyze task phases",
];

const TRANSPORT_CAPS = [
  "publish message via transport",
  "resolve transport implementation path",
  "get transport status",
];

describe("matchIntent()", () => {
  describe("exact phrase matches", () => {
    it("returns the capability for an exact match", () => {
      expect(matchIntent("load pipeline for ticket", PIPELINE_CORE_CAPS)).toBe("load pipeline for ticket");
    });

    it("returns the capability when request is lowercased", () => {
      expect(matchIntent("LOAD PIPELINE FOR TICKET", PIPELINE_CORE_CAPS)).toBe("load pipeline for ticket");
    });

    it("matches 'resolve signal name' exactly", () => {
      expect(matchIntent("resolve signal name", PIPELINE_CORE_CAPS)).toBe("resolve signal name");
    });

    it("matches 'dispatch phase' exactly", () => {
      expect(matchIntent("dispatch phase", EXECUTION_CAPS)).toBe("dispatch phase");
    });

    it("matches 'evaluate gate' exactly", () => {
      expect(matchIntent("evaluate gate", EXECUTION_CAPS)).toBe("evaluate gate");
    });

    it("matches 'resolve execution mode' exactly", () => {
      expect(matchIntent("resolve execution mode", EXECUTION_CAPS)).toBe("resolve execution mode");
    });

    it("matches longer capability strings exactly", () => {
      expect(matchIntent("publish message via transport", TRANSPORT_CAPS)).toBe("publish message via transport");
    });
  });

  describe("natural language variations", () => {
    it("matches 'load the pipeline config for this ticket'", () => {
      expect(matchIntent("load the pipeline config for this ticket", PIPELINE_CORE_CAPS)).toBe("load pipeline for ticket");
    });

    it("matches 'please load the pipeline for ticket BRE-123'", () => {
      expect(matchIntent("please load the pipeline for ticket BRE-123", PIPELINE_CORE_CAPS)).toBe("load pipeline for ticket");
    });

    it("matches 'find the feature directory'", () => {
      expect(matchIntent("find the feature directory", PIPELINE_CORE_CAPS)).toBe("find feature dir");
    });

    it("matches 'read the feature metadata for this ticket'", () => {
      expect(matchIntent("read the feature metadata for this ticket", PIPELINE_CORE_CAPS)).toBe("read feature metadata");
    });

    it("matches 'dispatch the next phase'", () => {
      expect(matchIntent("dispatch the next phase", EXECUTION_CAPS)).toBe("dispatch phase");
    });

    it("matches 'evaluate this gate'", () => {
      expect(matchIntent("evaluate this gate", EXECUTION_CAPS)).toBe("evaluate gate");
    });

    it("matches 'advance to the next phase'", () => {
      expect(matchIntent("advance to the next phase", EXECUTION_CAPS)).toBe("advance phase");
    });

    it("matches 'initialize the orchestrator'", () => {
      expect(matchIntent("initialize the orchestrator", EXECUTION_CAPS)).toBe("init orchestrator");
    });

    it("matches 'what is the transport status'", () => {
      expect(matchIntent("what is the transport status", TRANSPORT_CAPS)).toBe("get transport status");
    });

    it("matches 'resolve the transport path'", () => {
      expect(matchIntent("resolve the transport path", TRANSPORT_CAPS)).toBe("resolve transport implementation path");
    });
  });

  describe("returns null for unrelated text", () => {
    it("returns null for completely unrelated request", () => {
      expect(matchIntent("send an email to bob", PIPELINE_CORE_CAPS)).toBeNull();
    });

    it("returns null for generic greeting", () => {
      expect(matchIntent("hello world", PIPELINE_CORE_CAPS)).toBeNull();
    });

    it("returns null for random words unrelated to capabilities", () => {
      expect(matchIntent("coffee weather sunshine umbrella", EXECUTION_CAPS)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(matchIntent("", PIPELINE_CORE_CAPS)).toBeNull();
    });

    it("returns null when capabilities list is empty", () => {
      expect(matchIntent("load pipeline for ticket", [])).toBeNull();
    });

    it("returns null for punctuation-only input", () => {
      expect(matchIntent("!!! ???", PIPELINE_CORE_CAPS)).toBeNull();
    });
  });

  describe("threshold behavior", () => {
    it("returns the best match when multiple capabilities share tokens", () => {
      // "resolve signal name" vs "resolve transition" vs "resolve execution mode" vs "resolve retry config"
      // A request specifically about "signal name" should pick the signal name capability
      const result = matchIntent("resolve the signal name for phase", PIPELINE_CORE_CAPS);
      expect(result).toBe("resolve signal name");
    });

    it("picks the highest scoring match when tokens overlap multiple capabilities", () => {
      // "validate ticket id" vs "validate signal" — "ticket" is the discriminating token
      const result = matchIntent("validate the ticket id argument", PIPELINE_CORE_CAPS);
      expect(result).toBe("validate ticket id");
    });

    it("single relevant token still returns a match", () => {
      // "orchestrator" only appears in "init orchestrator"
      expect(matchIntent("orchestrator", EXECUTION_CAPS)).toBe("init orchestrator");
    });

    it("does not match unrelated single token in empty cap list", () => {
      expect(matchIntent("pipeline", [])).toBeNull();
    });
  });
});
