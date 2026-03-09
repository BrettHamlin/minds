/**
 * Collab CLI — registry.json fetching + manifest parsing
 * Fetches registry index and individual pipeline manifests from GitHub Releases API.
 * All network errors produce structured CollabError.
 */

import { makeError } from "../types/index.js";
import type {
  RegistryIndex,
  RegistryEntry,
  PipelineManifest,
  PackManifest,
  CollabError,
} from "../types/index.js";

/** Default registry URL — override via COLLAB_REGISTRY env var */
export const DEFAULT_REGISTRY_URL =
  process.env.COLLAB_REGISTRY ??
  "https://github.com/BrettHamlin/collab-registry/releases/latest/download/registry.json";

/**
 * Fetch the registry index. Throws CollabError on network or parse failure.
 */
export async function fetchRegistry(url?: string): Promise<RegistryIndex> {
  const registryUrl = url ?? DEFAULT_REGISTRY_URL;

  let response: Response;
  try {
    response = await fetch(registryUrl);
  } catch (err) {
    throw makeError("NETWORK_ERROR", `Failed to fetch registry from ${registryUrl}`, {
      url: registryUrl,
      cause: String(err),
    });
  }

  if (!response.ok) {
    throw makeError("NETWORK_ERROR", `Registry fetch returned HTTP ${response.status}: ${registryUrl}`, {
      url: registryUrl,
      status: response.status,
    });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw makeError("NETWORK_ERROR", `Failed to read registry response body`, {
      url: registryUrl,
      cause: String(err),
    });
  }

  return parseRegistryIndex(text, registryUrl);
}

/**
 * Fetch a single pipeline manifest from its URL.
 */
export async function fetchManifest(manifestUrl: string): Promise<PipelineManifest> {
  let response: Response;
  try {
    response = await fetch(manifestUrl);
  } catch (err) {
    throw makeError("NETWORK_ERROR", `Failed to fetch manifest from ${manifestUrl}`, {
      url: manifestUrl,
      cause: String(err),
    });
  }

  if (!response.ok) {
    throw makeError("NETWORK_ERROR", `Manifest fetch returned HTTP ${response.status}: ${manifestUrl}`, {
      url: manifestUrl,
      status: response.status,
    });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw makeError("NETWORK_ERROR", `Failed to read manifest response body`, {
      url: manifestUrl,
      cause: String(err),
    });
  }

  return parseManifest(text, manifestUrl);
}

/**
 * Look up a pipeline or pack entry by name in the registry.
 * Throws CollabError if not found.
 */
export function findEntry(registry: RegistryIndex, name: string): RegistryEntry {
  const all = [...registry.pipelines, ...registry.packs];
  const entry = all.find((e) => e.name === name);
  if (!entry) {
    throw makeError("PIPELINE_NOT_FOUND", `Pipeline or pack not found in registry: "${name}"`, {
      name,
      available: all.map((e) => e.name),
    });
  }
  return entry;
}

/**
 * List all available pipelines (not packs) from the registry.
 */
export function listPipelines(registry: RegistryIndex): RegistryEntry[] {
  return registry.pipelines;
}

/**
 * List all available packs from the registry.
 */
export function listPacks(registry: RegistryIndex): RegistryEntry[] {
  return registry.packs;
}

/**
 * Build a Map of name → latest version from a registry for lockfile diffing.
 */
export function buildVersionMap(registry: RegistryIndex): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of [...registry.pipelines, ...registry.packs]) {
    map.set(entry.name, entry.latestVersion);
  }
  return map;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

export function parseRegistryIndex(json: string, sourceUrl: string): RegistryIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw makeError("REGISTRY_INVALID", `Registry is not valid JSON: ${sourceUrl}`, {
      url: sourceUrl,
      cause: String(err),
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw makeError("REGISTRY_INVALID", `Registry must be a JSON object: ${sourceUrl}`, {
      url: sourceUrl,
    });
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.version !== "string") {
    throw makeError("REGISTRY_INVALID", `Registry missing "version" field: ${sourceUrl}`, {
      url: sourceUrl,
    });
  }

  if (!Array.isArray(obj.pipelines)) {
    throw makeError("REGISTRY_INVALID", `Registry missing "pipelines" array: ${sourceUrl}`, {
      url: sourceUrl,
    });
  }

  if (!Array.isArray(obj.packs)) {
    throw makeError("REGISTRY_INVALID", `Registry missing "packs" array: ${sourceUrl}`, {
      url: sourceUrl,
    });
  }

  return {
    version: obj.version,
    updatedAt: String(obj.updatedAt ?? ""),
    pipelines: obj.pipelines.map((e, i) => validateEntry(e, `pipelines[${i}]`, sourceUrl)),
    packs: obj.packs.map((e, i) => validateEntry(e, `packs[${i}]`, sourceUrl)),
  };
}

export function parseManifest(json: string, sourceUrl: string): PipelineManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw makeError("MANIFEST_INVALID", `Manifest is not valid JSON: ${sourceUrl}`, {
      url: sourceUrl,
      cause: String(err),
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw makeError("MANIFEST_INVALID", `Manifest must be a JSON object: ${sourceUrl}`, {
      url: sourceUrl,
    });
  }

  const obj = parsed as Record<string, unknown>;

  const requiredFields = ["name", "type", "version", "description"];
  for (const field of requiredFields) {
    if (typeof obj[field] !== "string") {
      throw makeError(
        "MANIFEST_INVALID",
        `Manifest missing required field "${field}": ${sourceUrl}`,
        { url: sourceUrl, field }
      );
    }
  }

  if (obj.type !== "pipeline" && obj.type !== "pack") {
    throw makeError(
      "MANIFEST_INVALID",
      `Manifest "type" must be "pipeline" or "pack", got "${obj.type}": ${sourceUrl}`,
      { url: sourceUrl, type: obj.type }
    );
  }

  return obj as unknown as PipelineManifest;
}

function validateEntry(raw: unknown, path: string, sourceUrl: string): RegistryEntry {
  if (typeof raw !== "object" || raw === null) {
    throw makeError("REGISTRY_INVALID", `Invalid registry entry at ${path}`, {
      url: sourceUrl,
      path,
    });
  }
  const obj = raw as Record<string, unknown>;
  const fields = ["name", "description", "latestVersion", "manifestUrl", "tarballUrl"];
  for (const field of fields) {
    if (typeof obj[field] !== "string") {
      throw makeError("REGISTRY_INVALID", `Registry entry ${path} missing "${field}"`, {
        url: sourceUrl,
        path,
        field,
      });
    }
  }
  const entry = obj as unknown as RegistryEntry;
  // sha256 is optional — pass through if present
  if (typeof obj.sha256 === "string") {
    entry.sha256 = obj.sha256;
  }
  return entry;
}
