/**
 * Local registry helper — starts an in-process HTTP server that serves a fixture
 * registry, manifests, and tarballs for integration and E2E tests.
 *
 * Usage:
 *   const registry = await startLocalRegistry([{ name: "specify", version: "1.2.0", ... }]);
 *   // use registry.registryUrl in install/update/browse tests
 *   await registry.stop();
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { computeChecksum } from "../../minds/cli/lib/integrity.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineSpec {
  name: string;
  version: string;
  type?: "pipeline" | "pack";
  description?: string;
  dependencies?: Array<{ name: string; version: string }>;
  cliDependencies?: Array<{
    name: string;
    version: string;
    required: boolean;
    installHint?: string;
  }>;
  /** Commands listed in pipeline.json commands[] */
  commands?: string[];
  /** Command file contents: filename → content (written to commands/ subdir) */
  commandFiles?: Record<string, string>;
  /** Handler .ts paths listed in pipeline.json handlers[] */
  handlers?: string[];
  /** Handler file contents: filename → content (written to handlers/ subdir) */
  handlerFiles?: Record<string, string>;
  /** Executor .ts paths listed in pipeline.json executors[] */
  executors?: string[];
  /** Executor file contents: filename → content (written to executors/ subdir) */
  executorFiles?: Record<string, string>;
  /** Pack: list of component pipeline names */
  pipelines?: string[];
  /**
   * If set, the manifest served will claim this checksum (allows testing mismatch).
   * When undefined, no checksum field is included in the manifest.
   */
  checksumOverride?: string;
}

export interface LocalRegistry {
  /** Base URL of the server: http://localhost:{port} */
  url: string;
  /** Full URL to the registry.json index */
  registryUrl: string;
  /** Stop the server and clean up temp files */
  stop: () => Promise<void>;
  /** Get the actual SHA-256 checksum of a pipeline's tarball */
  getTarballChecksum: (name: string) => string;
  /** Replace the bytes served for a pipeline tarball (simulate content tampering) */
  tamperTarball: (name: string, newContent: Buffer) => void;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build tarballs for the given specs and start a local HTTP registry server.
 *
 * The server serves:
 *   GET /registry.json              — registry index
 *   GET /pipelines/{name}/pipeline.json
 *   GET /pipelines/{name}/{name}-{version}.tar.gz
 *   GET /packs/{name}/pipeline.json
 *   GET /packs/{name}/{name}-{version}.tar.gz
 *
 * @param pipelines  Single-pipeline specs
 * @param packs      Pack specs (type: "pack")
 */
export async function startLocalRegistry(
  pipelines: PipelineSpec[],
  packs: PipelineSpec[] = []
): Promise<LocalRegistry> {
  const buildDir = mkdtempSync(join(tmpdir(), "collab-reg-"));

  // Build all tarballs upfront
  const tarballData = new Map<string, Buffer>();
  const checksums = new Map<string, string>();

  for (const spec of [...pipelines, ...packs]) {
    const buf = buildTarball(buildDir, spec);
    tarballData.set(spec.name, buf);
    checksums.set(spec.name, computeChecksum(buf));
  }

  // port is captured after Bun.serve assigns it — safe because no requests
  // arrive until after startLocalRegistry returns
  let port = 0;
  let server: ReturnType<typeof Bun.serve> | null = null;

  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      const base = `http://localhost:${port}`;

      // ── Registry index ───────────────────────────────────────────────────
      if (pathname === "/registry.json") {
        return jsonResponse({
          version: "1",
          updatedAt: new Date().toISOString(),
          packs: packs.map((p) => ({
            name: p.name,
            description: p.description ?? p.name,
            latestVersion: p.version,
            manifestUrl: `${base}/packs/${p.name}/pipeline.json`,
            tarballUrl: `${base}/packs/${p.name}/${p.name}-${p.version}.tar.gz`,
          })),
          pipelines: pipelines.map((p) => ({
            name: p.name,
            description: p.description ?? p.name,
            latestVersion: p.version,
            manifestUrl: `${base}/pipelines/${p.name}/pipeline.json`,
            tarballUrl: `${base}/pipelines/${p.name}/${p.name}-${p.version}.tar.gz`,
          })),
        });
      }

      // ── Pipeline manifests + tarballs ────────────────────────────────────
      for (const spec of pipelines) {
        if (pathname === `/pipelines/${spec.name}/pipeline.json`) {
          return jsonResponse(buildManifestObj(spec));
        }
        if (pathname === `/pipelines/${spec.name}/${spec.name}-${spec.version}.tar.gz`) {
          const data = tarballData.get(spec.name);
          if (data) return tarballResponse(data);
        }
      }

      // ── Pack manifests + tarballs ────────────────────────────────────────
      for (const spec of packs) {
        if (pathname === `/packs/${spec.name}/pipeline.json`) {
          return jsonResponse(buildManifestObj(spec));
        }
        if (pathname === `/packs/${spec.name}/${spec.name}-${spec.version}.tar.gz`) {
          const data = tarballData.get(spec.name);
          if (data) return tarballResponse(data);
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  port = server.port;

  return {
    url: `http://localhost:${port}`,
    registryUrl: `http://localhost:${port}/registry.json`,
    stop: async () => {
      server?.stop();
      try {
        rmSync(buildDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    },
    getTarballChecksum: (name) => checksums.get(name) ?? "",
    tamperTarball: (name, newContent) => {
      tarballData.set(name, newContent);
    },
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildManifestObj(spec: PipelineSpec): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    name: spec.name,
    type: spec.type ?? "pipeline",
    version: spec.version,
    description: spec.description ?? spec.name,
    dependencies: spec.dependencies ?? [],
    cliDependencies: spec.cliDependencies ?? [],
    commands: spec.commands ?? [],
  };
  if (spec.handlers) obj.handlers = spec.handlers;
  if (spec.executors) obj.executors = spec.executors;
  if (spec.pipelines) obj.pipelines = spec.pipelines;
  if (spec.checksumOverride !== undefined) obj.checksum = spec.checksumOverride;
  return obj;
}

function buildTarball(buildDir: string, spec: PipelineSpec): Buffer {
  const rootName = `${spec.name}-${spec.version}`;
  const pipelineDir = join(buildDir, rootName);
  mkdirSync(join(pipelineDir, "commands"), { recursive: true });
  writeFileSync(
    join(pipelineDir, "pipeline.json"),
    JSON.stringify(buildManifestObj(spec), null, 2)
  );
  for (const [filename, content] of Object.entries(spec.commandFiles ?? {})) {
    writeFileSync(join(pipelineDir, "commands", filename), content);
  }
  if (spec.handlerFiles && Object.keys(spec.handlerFiles).length > 0) {
    mkdirSync(join(pipelineDir, "handlers"), { recursive: true });
    for (const [filename, content] of Object.entries(spec.handlerFiles)) {
      writeFileSync(join(pipelineDir, "handlers", filename), content);
    }
  }
  if (spec.executorFiles && Object.keys(spec.executorFiles).length > 0) {
    mkdirSync(join(pipelineDir, "executors"), { recursive: true });
    for (const [filename, content] of Object.entries(spec.executorFiles)) {
      writeFileSync(join(pipelineDir, "executors", filename), content);
    }
  }
  const tarPath = join(buildDir, `${rootName}.tar.gz`);
  execSync(`tar -czf "${tarPath}" -C "${buildDir}" "${rootName}"`);
  return readFileSync(tarPath);
}

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json" },
  });
}

function tarballResponse(data: Buffer): Response {
  return new Response(data, {
    headers: { "Content-Type": "application/gzip" },
  });
}
