/**
 * Core interfaces for the Minds protocol.
 * No external dependencies — pure TypeScript types + runtime validation.
 */

export interface WorkUnit {
  request: string;
  context?: unknown;
  from?: string;
}

export interface WorkResult {
  status: "handled" | "escalate";
  data?: unknown;
  error?: string;
}

export interface MindDescription {
  name: string;
  domain: string;
  keywords: string[];
  owns_files: string[];
  capabilities: string[];
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
  return true;
}
