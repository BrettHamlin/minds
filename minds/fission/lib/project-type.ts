/**
 * project-type.ts — Detect the project type of a target directory.
 *
 * Extends the marker-file pattern from detectLanguage() in pipeline.ts
 * to determine the project type for pipeline template selection.
 *
 * Deterministic: file checks and JSON parsing only, no LLM calls.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type ProjectType =
  | "frontend-web"
  | "backend-api"
  | "ios-mobile"
  | "android-mobile"
  | "library"
  | "cli"
  | "unknown";

/* ------------------------------------------------------------------ */
/*  Dep lists for detection                                            */
/* ------------------------------------------------------------------ */

const FRONTEND_DEPS = new Set([
  "react",
  "vue",
  "svelte",
  "next",
  "nuxt",
  "angular",
  "@angular/core",
]);

const BACKEND_NODE_DEPS = new Set([
  "express",
  "fastify",
  "hono",
  "koa",
  "nest",
  "@nestjs/core",
]);

const GO_BACKEND_PATTERNS = [
  "gin-gonic/gin",
  "labstack/echo",
  "gofiber/fiber",
  "gorilla/mux",
  "go-chi/chi",
];

const RUST_BACKEND_DEPS = ["actix-web", "axum", "rocket", "warp"];

const PYTHON_BACKEND_DEPS = ["flask", "django", "fastapi", "starlette"];

/* ------------------------------------------------------------------ */
/*  File reading helpers                                               */
/* ------------------------------------------------------------------ */

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  const content = readFileSafe(path);
  if (!content) return null;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getAllDeps(pkg: Record<string, unknown>): Set<string> {
  const deps = new Set<string>();
  const sections = ["dependencies", "devDependencies"] as const;
  for (const section of sections) {
    const val = pkg[section];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const key of Object.keys(val as Record<string, unknown>)) {
        deps.add(key);
      }
    }
  }
  return deps;
}

function hasAnyDep(allDeps: Set<string>, targets: Set<string> | string[]): boolean {
  const targetSet = targets instanceof Set ? targets : new Set(targets);
  for (const dep of allDeps) {
    if (targetSet.has(dep)) return true;
  }
  return false;
}

/** Check if any entry in rootDir matches a glob-like pattern (e.g., *.xcodeproj). */
function hasEntryMatching(dir: string, suffix: string): boolean {
  try {
    const entries = readdirSync(dir);
    return entries.some((e) => e.endsWith(suffix));
  } catch {
    return false;
  }
}

/** Recursively check if a file matching a pattern exists anywhere under dir. */
function existsDeep(dir: string, fileName: string): boolean {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name === fileName) return true;
      if (entry.isDirectory()) {
        if (existsDeep(join(dir, entry.name), fileName)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Detection functions (one per project type)                         */
/* ------------------------------------------------------------------ */

function isFrontendWeb(
  targetDir: string,
  pkg: Record<string, unknown> | null,
  allDeps: Set<string>,
): boolean {
  // Check package.json for frontend framework deps
  if (pkg && hasAnyDep(allDeps, FRONTEND_DEPS)) return true;

  // Check for root index.html
  if (existsSync(join(targetDir, "index.html"))) return true;

  return false;
}

function isBackendApi(
  targetDir: string,
  pkg: Record<string, unknown> | null,
  allDeps: Set<string>,
): boolean {
  // Node.js backend frameworks
  if (pkg && hasAnyDep(allDeps, BACKEND_NODE_DEPS)) return true;

  // Go web frameworks (check go.mod content)
  const goMod = readFileSafe(join(targetDir, "go.mod"));
  if (goMod) {
    for (const pattern of GO_BACKEND_PATTERNS) {
      if (goMod.includes(pattern)) return true;
    }
  }

  // Rust web frameworks (check Cargo.toml content)
  const cargoToml = readFileSafe(join(targetDir, "Cargo.toml"));
  if (cargoToml) {
    for (const dep of RUST_BACKEND_DEPS) {
      if (cargoToml.includes(dep)) return true;
    }
  }

  // Python web frameworks (check pyproject.toml or setup.py)
  const pyproject = readFileSafe(join(targetDir, "pyproject.toml"));
  if (pyproject) {
    for (const dep of PYTHON_BACKEND_DEPS) {
      if (pyproject.includes(dep)) return true;
    }
  }
  const setupPy = readFileSafe(join(targetDir, "setup.py"));
  if (setupPy) {
    for (const dep of PYTHON_BACKEND_DEPS) {
      if (setupPy.includes(dep)) return true;
    }
  }

  // Spring Boot (pom.xml or build.gradle)
  const pomXml = readFileSafe(join(targetDir, "pom.xml"));
  if (pomXml && pomXml.includes("springframework")) return true;

  const buildGradle = readFileSafe(join(targetDir, "build.gradle"));
  if (buildGradle && buildGradle.includes("springframework")) return true;

  const buildGradleKts = readFileSafe(join(targetDir, "build.gradle.kts"));
  if (buildGradleKts && buildGradleKts.includes("springframework")) return true;

  return false;
}

function isIosMobile(targetDir: string): boolean {
  // xcodeproj or xcworkspace in root
  if (hasEntryMatching(targetDir, ".xcodeproj")) return true;
  if (hasEntryMatching(targetDir, ".xcworkspace")) return true;

  // Podfile
  if (existsSync(join(targetDir, "Podfile"))) return true;

  return false;
}

function isAndroidMobile(targetDir: string): boolean {
  // build.gradle or build.gradle.kts with android application plugin
  const buildGradle = readFileSafe(join(targetDir, "build.gradle"));
  if (buildGradle && buildGradle.includes("com.android.application")) return true;

  const buildGradleKts = readFileSafe(join(targetDir, "build.gradle.kts"));
  if (buildGradleKts && buildGradleKts.includes("com.android.application")) return true;

  // AndroidManifest.xml anywhere in the tree
  if (existsDeep(targetDir, "AndroidManifest.xml")) return true;

  return false;
}

function isCli(
  targetDir: string,
  pkg: Record<string, unknown> | null,
): boolean {
  // package.json with bin field
  if (pkg && pkg.bin) return true;

  // Go with cmd/ directory
  if (
    existsSync(join(targetDir, "go.mod")) &&
    existsSync(join(targetDir, "cmd"))
  ) {
    return true;
  }

  // Cargo.toml with [[bin]] section
  const cargoToml = readFileSafe(join(targetDir, "Cargo.toml"));
  if (cargoToml && cargoToml.includes("[[bin]]")) return true;

  return false;
}

function isLibrary(
  targetDir: string,
  pkg: Record<string, unknown> | null,
): boolean {
  // package.json with main or exports but no framework deps
  if (pkg && (pkg.main || pkg.exports)) return true;

  // Cargo.toml with [lib] section
  const cargoToml = readFileSafe(join(targetDir, "Cargo.toml"));
  if (cargoToml && cargoToml.includes("[lib]")) return true;

  return false;
}

/* ------------------------------------------------------------------ */
/*  Main detection function                                            */
/* ------------------------------------------------------------------ */

/**
 * Detect the project type of a target directory by checking marker files,
 * dependency manifests, and directory structure.
 *
 * Detection priority order:
 * 1. frontend-web (highest — full-stack apps tend to be frontend-centric)
 * 2. ios-mobile
 * 3. android-mobile
 * 4. backend-api
 * 5. cli
 * 6. library
 * 7. unknown (fallback)
 */
export function detectProjectType(targetDir: string): ProjectType {
  // Pre-read package.json once (many checks use it)
  const pkgPath = join(targetDir, "package.json");
  const pkg = existsSync(pkgPath) ? readJsonSafe(pkgPath) : null;
  const allDeps = pkg ? getAllDeps(pkg) : new Set<string>();

  // Priority 1: frontend-web
  if (isFrontendWeb(targetDir, pkg, allDeps)) return "frontend-web";

  // Priority 2: iOS
  if (isIosMobile(targetDir)) return "ios-mobile";

  // Priority 3: Android
  if (isAndroidMobile(targetDir)) return "android-mobile";

  // Priority 4: backend-api
  if (isBackendApi(targetDir, pkg, allDeps)) return "backend-api";

  // Priority 5: CLI (check before library — CLI with bin takes precedence)
  if (isCli(targetDir, pkg)) return "cli";

  // Priority 6: library
  if (isLibrary(targetDir, pkg)) return "library";

  // Priority 7: fallback
  return "unknown";
}
