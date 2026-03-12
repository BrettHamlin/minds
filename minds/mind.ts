/**
 * Core interfaces for the Minds protocol.
 * No external dependencies — pure TypeScript types + runtime validation.
 */

export interface WorkUnit {
  request: string;
  context?: unknown;
  from?: string;
  /** Best-matching capability string from this Mind's description, set by server-base. */
  intent?: string;
  contract?: {
    produces?: string[];
    consumes?: string[];
    boundaries?: string[];
  };
}

export interface WorkResult {
  status: "handled" | "escalate";
  data?: unknown;
  error?: string;
  /** Routing observability — set by server-base and router, never by Mind handlers */
  _routing?: {
    mind?: string;
    score?: number;
    intent?: string;
    routed?: string;
  };
}

export interface MindDescription {
  name: string;
  domain: string;
  keywords: string[];
  owns_files: string[];
  capabilities: string[];
  exposes?: string[];
  consumes?: string[];
  /** Provenance: how this mind was created. */
  source?: "fission" | "task-scaffolded" | "manual";
  /** Repo alias for multi-repo workspaces. */
  repo?: string;
}

export interface Mind {
  handle(workUnit: WorkUnit): Promise<WorkResult>;
  describe(): MindDescription;
}

/**
 * Runtime validation guard for WorkUnit.
 * Returns true only if value is a structurally valid WorkUnit.
 */
export function validateWorkUnit(value: unknown): value is WorkUnit {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.request !== "string") return false;
  if (obj.from !== undefined && typeof obj.from !== "string") return false;
  if (obj.contract !== undefined) {
    if (typeof obj.contract !== "object" || obj.contract === null) return false;
    const c = obj.contract as Record<string, unknown>;
    if (c.produces !== undefined && (!Array.isArray(c.produces) || !c.produces.every((p) => typeof p === "string"))) return false;
    if (c.consumes !== undefined && (!Array.isArray(c.consumes) || !c.consumes.every((x) => typeof x === "string"))) return false;
    if (c.boundaries !== undefined && (!Array.isArray(c.boundaries) || !c.boundaries.every((b) => typeof b === "string"))) return false;
  }
  return true;
}

/**
 * Runtime validation guard for WorkResult.
 */
export function validateWorkResult(value: unknown): value is WorkResult {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.status !== "handled" && obj.status !== "escalate") return false;
  if (obj.error !== undefined && typeof obj.error !== "string") return false;
  if (obj._routing !== undefined) {
    if (typeof obj._routing !== "object" || obj._routing === null) return false;
    const r = obj._routing as Record<string, unknown>;
    if (r.mind !== undefined && typeof r.mind !== "string") return false;
    if (r.score !== undefined && typeof r.score !== "number") return false;
    if (r.intent !== undefined && typeof r.intent !== "string") return false;
    if (r.routed !== undefined && typeof r.routed !== "string") return false;
  }
  return true;
}

/**
 * Runtime validation guard for MindDescription.
 */
export function validateMindDescription(value: unknown): value is MindDescription {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.name !== "string") return false;
  if (typeof obj.domain !== "string") return false;
  if (!Array.isArray(obj.keywords) || !obj.keywords.every((k) => typeof k === "string")) return false;
  if (!Array.isArray(obj.owns_files) || !obj.owns_files.every((f) => typeof f === "string")) return false;
  if (!Array.isArray(obj.capabilities) || !obj.capabilities.every((c) => typeof c === "string")) return false;
  if (obj.exposes !== undefined && (!Array.isArray(obj.exposes) || !obj.exposes.every((e) => typeof e === "string"))) return false;
  if (obj.consumes !== undefined && (!Array.isArray(obj.consumes) || !obj.consumes.every((c) => typeof c === "string"))) return false;
  if (obj.source !== undefined && obj.source !== "fission" && obj.source !== "task-scaffolded" && obj.source !== "manual") return false;
  if (obj.repo !== undefined && typeof obj.repo !== "string") return false;
  return true;
}
