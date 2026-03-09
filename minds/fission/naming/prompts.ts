/**
 * prompts.ts -- Prompt templates for the LLM naming layer (Stage 4).
 *
 * Builds structured prompts for cluster naming and recommendation
 * generation. These prompts are used when an LLM is available;
 * the offline fallback in naming.ts bypasses them entirely.
 */

export interface ClusterForNaming {
  clusterId: number;
  /** Representative filenames (basenames only, to save tokens). */
  filenames: string[];
  /** Directory distribution: { dir: count } */
  directories: Record<string, number>;
  fileCount: number;
  cohesion: number;
  externalEdges: number;
}

/**
 * Build the prompt that asks an LLM to name each cluster.
 *
 * The prompt includes:
 * - File distribution by directory for each cluster
 * - Representative filenames
 * - Few-shot examples of good naming
 * - JSON output schema
 */
export function buildNamingPrompt(clusterData: ClusterForNaming[]): string {
  const clusterDescriptions = clusterData.map((c) => {
    const dirLines = Object.entries(c.directories)
      .sort(([, a], [, b]) => b - a)
      .map(([dir, count]) => `    ${dir}: ${count} files`)
      .join("\n");

    const sampleFiles = c.filenames.slice(0, 10).join(", ");

    return `Cluster ${c.clusterId} (${c.fileCount} files, cohesion: ${c.cohesion.toFixed(2)}):
  Directories:
${dirLines}
  Sample files: ${sampleFiles}`;
  }).join("\n\n");

  return `You are analyzing a codebase that has been split into clusters of tightly-coupled files.
Name each cluster as a domain-specific "Mind" (a bounded-context module).

## Rules
- name: lowercase, letters and hyphens only, 2-20 characters (e.g., "auth", "data-access", "billing")
- domain: 1-2 sentence description of what this cluster is responsible for
- keywords: 3-8 keywords for intent routing (what questions/tasks this Mind handles)
- exposes: capabilities this Mind provides to others (e.g., "user authentication", "payment processing")
- consumes: capabilities this Mind needs from others (e.g., "database access", "configuration")

## Few-shot examples

Cluster with files in src/auth/login.ts, src/auth/session.ts, src/auth/middleware.ts:
{
  "name": "auth",
  "domain": "Handles user authentication, session management, and authorization middleware.",
  "keywords": ["auth", "login", "session", "jwt", "token", "middleware"],
  "exposes": ["user authentication", "session validation", "auth middleware"],
  "consumes": ["database access", "configuration"]
}

Cluster with files in src/api/routes/, src/api/middleware/, src/api/handlers/:
{
  "name": "api",
  "domain": "HTTP API layer including route definitions, request handlers, and API middleware.",
  "keywords": ["api", "routes", "handlers", "http", "rest", "endpoints"],
  "exposes": ["REST API endpoints", "request handling"],
  "consumes": ["auth", "business logic", "data access"]
}

## Clusters to name

${clusterDescriptions}

## Response format

Respond with a JSON array. One object per cluster, in order:
\`\`\`json
[
  {
    "clusterId": 0,
    "name": "...",
    "domain": "...",
    "keywords": ["..."],
    "exposes": ["..."],
    "consumes": ["..."]
  }
]
\`\`\`

Respond ONLY with the JSON array. No explanation.`;
}

/**
 * Build the prompt that asks an LLM to review the proposed Mind map
 * and suggest improvements.
 */
export function buildRecommendationPrompt(
  proposedMinds: { name: string; fileCount: number; cohesion: number; domain: string }[],
  couplingData: { from: string; to: string; edges: number }[],
): string {
  const mindLines = proposedMinds
    .map((m) => `- ${m.name} (${m.fileCount} files, cohesion: ${m.cohesion.toFixed(2)}): ${m.domain}`)
    .join("\n");

  const couplingLines = couplingData
    .slice(0, 20)
    .map((c) => `  ${c.from} <-> ${c.to}: ${c.edges} edges`)
    .join("\n");

  return `Review this proposed Mind map and identify improvements.

## Proposed Minds
${mindLines}

## Coupling (top cross-Mind edges)
${couplingLines}

## Review criteria
1. Clusters with >500 files are too large and should be split
2. Clusters with <5 files are too small and could be merged with a related Mind
3. Files that seem misplaced based on their path or name
4. High coupling between two Minds (>50 edges) suggests they should be one Mind

## Response format
\`\`\`json
[
  {
    "type": "split" | "merge" | "reassign" | "review",
    "target": "mind-name or file path",
    "reason": "why this is recommended",
    "suggestion": "what to do about it"
  }
]
\`\`\`

Respond ONLY with the JSON array. Empty array [] if no recommendations.`;
}
