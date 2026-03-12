/**
 * check-contracts-core.ts — Pure logic for deterministic contract verification.
 *
 * Parses `produces:` and `consumes:` annotations from task descriptions,
 * then verifies the actual source files match the contract.
 *
 * Extracted from check-contracts.ts for reuse by the supervisor and other callers.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { normalizeMindsPrefix, resolveMindsDir } from "../shared/paths.js";
import { parseRepoPath, stripRepoPrefix } from "../shared/repo-path.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContractAnnotation {
  type: "produces" | "consumes";
  interfaceName: string; // e.g. "serializeEventForSSE()" or "MindsBusMessage"
  filePath: string;      // e.g. ".minds/transport/minds-events.ts"
  taskId: string;        // e.g. "T001"
}

export interface Violation {
  annotation: ContractAnnotation;
  reason: string;
}

// ── Parse annotations from task descriptions ────────────────────────────────

export function parseAnnotations(tasksText: string, forMind: string): ContractAnnotation[] {
  const annotations: ContractAnnotation[] = [];
  const lines = tasksText.split("\n");

  for (const line of lines) {
    // Only process task lines for this mind
    const taskMatch = line.match(/^-\s*\[.\]\s*(T\d+)\s+@(\w+)/);
    if (!taskMatch) continue;

    const [, taskId, taskMind] = taskMatch;
    if (taskMind !== forMind) continue;

    // Parse produces: annotations
    const producesMatch = line.match(/produces:\s*`([^`]+)`\s+at\s+(\S+)/);
    if (producesMatch) {
      annotations.push({
        type: "produces",
        interfaceName: producesMatch[1].replace(/[()]/g, ""), // strip parens
        filePath: producesMatch[2],
        taskId,
      });
    }

    // Parse consumes: annotations
    const consumesMatch = line.match(/consumes:\s*`([^`]+)`\s+from\s+(\S+)/);
    if (consumesMatch) {
      annotations.push({
        type: "consumes",
        interfaceName: consumesMatch[1].replace(/[()]/g, ""), // strip parens
        filePath: consumesMatch[2],
        taskId,
      });
    }
  }

  return annotations;
}

// ── Verify contracts ────────────────────────────────────────────────────────

export function verifyContracts(
  annotations: ContractAnnotation[],
  repoRoot: string,
  mindName?: string,
  ownsFiles?: string[],
  mindRepo?: string,
  repoPaths?: Map<string, string>,
): { pass: boolean; violations: Violation[]; deferredCrossRepo: ContractAnnotation[] } {
  const violations: Violation[] = [];
  const deferredCrossRepo: ContractAnnotation[] = [];

  const effectiveMindName = mindName ?? "";

  // Strip repo prefixes from ownsFiles for local filesystem scanning
  const strippedOwnsFiles = ownsFiles?.map(stripRepoPrefix);

  for (const ann of annotations) {
    // Cross-repo module contract: filePath has a repo prefix different from mindRepo → defer
    const parsed = parseRepoPath(ann.filePath);
    if (parsed.repo && parsed.repo !== mindRepo) {
      deferredCrossRepo.push(ann);
      continue;
    }

    // API contract: "from @mind_name" — consumer-side import verification
    // is not possible across repos/languages. Enforced by:
    //   1. Wave ordering (producer completes before consumer starts)
    //   2. Producer-side file verification (file exists)
    //   3. LLM review (verifies consumer actually calls the endpoint)
    if (ann.type === "consumes" && ann.filePath.startsWith("@")) {
      // API contract — skip consumer-side import scan, no violation, not deferred
      continue;
    }

    // Resolve the effective root for this annotation's file
    const effectiveRoot = resolveEffectiveRoot(ann.filePath, repoRoot, repoPaths);
    // Strip repo prefix from filePath for local resolution
    const localFilePath = stripRepoPrefix(ann.filePath);
    const localAnn = { ...ann, filePath: localFilePath };

    if (ann.type === "produces") {
      verifyProduces(localAnn, effectiveRoot, violations);
    } else if (ann.type === "consumes") {
      verifyConsumes(localAnn, effectiveRoot, effectiveMindName, violations, strippedOwnsFiles);
    }
  }

  return { pass: violations.length === 0, violations, deferredCrossRepo };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function verifyProduces(
  ann: ContractAnnotation,
  repoRoot: string,
  violations: Violation[],
): void {
  const fullPath = resolveFilePath(ann.filePath, repoRoot);
  if (!existsSync(fullPath)) {
    violations.push({
      annotation: ann,
      reason: `File does not exist: ${ann.filePath}`,
    });
    return;
  }

  const content = readFileSync(fullPath, "utf-8");
  const isExported = checkExportExists(content, ann.interfaceName);
  if (!isExported) {
    violations.push({
      annotation: ann,
      reason: `'${ann.interfaceName}' is NOT exported from ${ann.filePath}`,
    });
  }
}

function verifyConsumes(
  ann: ContractAnnotation,
  repoRoot: string,
  mindName: string,
  violations: Violation[],
  ownsFiles?: string[],
): void {
  // Collect source files from the mind directory AND owns_files directories.
  // For fission-scaffolded minds the actual source lives outside .minds/
  // (e.g., src/middleware/cors/) so we must scan owns_files too.
  const tsFiles: string[] = [];

  const mindsDir = resolveMindsDir(repoRoot);
  const mindDir = resolve(mindsDir, mindName);
  if (existsSync(mindDir)) {
    tsFiles.push(...findTsFiles(mindDir));
  }

  // Also scan owns_files directories (strip trailing globs)
  if (ownsFiles?.length) {
    for (const pattern of ownsFiles) {
      const dirPath = resolve(repoRoot, pattern.replace(/\*+$/, "").replace(/\/+$/, ""));
      if (existsSync(dirPath)) {
        tsFiles.push(...findTsFiles(dirPath));
      }
    }
  }

  if (tsFiles.length === 0) {
    violations.push({
      annotation: ann,
      reason: `No source files found for @${mindName}`,
    });
    return;
  }
  let foundLocalDef = false;
  let localDefFile = "";

  for (const tsFile of tsFiles) {
    if (tsFile.includes("__tests__") || tsFile.includes(".test.")) continue;

    const content = readFileSync(tsFile, "utf-8");
    const localDefPatterns = [
      new RegExp(`export\\s+function\\s+${escapeRegExp(ann.interfaceName)}\\b`),
      new RegExp(`export\\s+const\\s+${escapeRegExp(ann.interfaceName)}\\b`),
      new RegExp(`function\\s+${escapeRegExp(ann.interfaceName)}\\s*\\(`),
    ];

    if (localDefPatterns.some((p) => p.test(content))) {
      foundLocalDef = true;
      localDefFile = tsFile.replace(repoRoot + "/", "");
      break;
    }
  }

  if (foundLocalDef) {
    violations.push({
      annotation: ann,
      reason: `CONTRACT VIOLATION: '${ann.interfaceName}' is defined locally in ${localDefFile} — must be imported from ${ann.filePath}`,
    });
  }

  // Also check that at least one file imports it from the correct source
  let foundImport = false;

  for (const tsFile of tsFiles) {
    if (tsFile.includes("__tests__") || tsFile.includes(".test.")) continue;
    const content = readFileSync(tsFile, "utf-8");

    const importPatterns = [
      new RegExp(`import\\s*\\{[^}]*\\b${escapeRegExp(ann.interfaceName)}\\b[^}]*\\}\\s*from`),
      new RegExp(`import\\s+type\\s*\\{[^}]*\\b${escapeRegExp(ann.interfaceName)}\\b[^}]*\\}\\s*from`),
    ];

    if (importPatterns.some((p) => p.test(content))) {
      foundImport = true;
      break;
    }
  }

  if (!foundImport && !foundLocalDef) {
    violations.push({
      annotation: ann,
      reason: `'${ann.interfaceName}' is not imported anywhere in @${mindName}'s source files`,
    });
  }
}

/**
 * Resolve the effective repo root for a file path. If the path has a repo prefix
 * and repoPaths is available, resolve to that repo's root. Otherwise, use repoRoot.
 */
function resolveEffectiveRoot(
  filePath: string,
  repoRoot: string,
  repoPaths?: Map<string, string>,
): string {
  const parsed = parseRepoPath(filePath);
  if (parsed.repo && repoPaths?.has(parsed.repo)) {
    return repoPaths.get(parsed.repo)!;
  }
  return repoRoot;
}

/**
 * Check whether a file exports a given interface name.
 * Scans for all common TypeScript export forms.
 */
export function checkExportExists(content: string, interfaceName: string): boolean {
  const exportPatterns = [
    new RegExp(`export\\s+function\\s+${escapeRegExp(interfaceName)}\\b`),
    new RegExp(`export\\s+const\\s+${escapeRegExp(interfaceName)}\\b`),
    new RegExp(`export\\s+type\\s+${escapeRegExp(interfaceName)}\\b`),
    new RegExp(`export\\s+interface\\s+${escapeRegExp(interfaceName)}\\b`),
    new RegExp(`export\\s+class\\s+${escapeRegExp(interfaceName)}\\b`),
    new RegExp(`export\\s+enum\\s+${escapeRegExp(interfaceName)}\\b`),
    new RegExp(`export\\s*\\{[^}]*\\b${escapeRegExp(interfaceName)}\\b[^}]*\\}`),
  ];
  return exportPatterns.some((p) => p.test(content));
}

function resolveFilePath(filePath: string, root: string): string {
  // Handle .minds/ vs minds/ — check both
  const direct = resolve(root, filePath);
  if (existsSync(direct)) return direct;

  // Try the normalized prefix (`.minds/` → `minds/`) or vice versa
  const normalized = normalizeMindsPrefix(filePath);
  if (normalized !== filePath) {
    const alt = resolve(root, normalized);
    if (existsSync(alt)) return alt;
  } else if (filePath.startsWith("minds/")) {
    const alt = resolve(root, ".minds/" + filePath.slice(6));
    if (existsSync(alt)) return alt;
  }

  return direct; // return original path even if not found
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        results.push(...findTsFiles(fullPath));
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist or can't be read
  }
  return results;
}
