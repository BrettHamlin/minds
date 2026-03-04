#!/usr/bin/env bun

/**
 * resolve-tickets.ts — Resolve mixed ticket/project-name arguments into a structured ticket list.
 *
 * Accepts raw arguments from collab.run: ticket IDs, ticket:variant pairs, and project names.
 * Queries Linear GraphQL API for project-sourced tickets and resolves pipeline variants from labels.
 *
 * Usage:
 *   bun resolve-tickets.ts BRE-342:default BRE-341:mobile
 *   bun resolve-tickets.ts "Collab Install"
 *   bun resolve-tickets.ts "Collab Install" BRE-999:custom
 *   bun resolve-tickets.ts --project-id <id> [BRE-123[:variant] ...]
 *
 * Output (stdout):
 *   On success:    JSON array — [{ticket, variant, title, status, source}, ...]
 *   On ambiguity:  JSON object — {"ambiguous": true, "query": string, "projects": [{id, name}, ...]}
 *
 * Exit codes:
 *   0 = success (array) or ambiguous (JSON object — caller handles UX)
 *   1 = usage error or Linear API failure
 *   2 = project name matches zero Linear projects
 *   3 = project found but has zero open tickets
 *
 * Environment:
 *   LINEAR_API_KEY — required when any argument is a project name or a bare ticket ID (no variant)
 */

/** Matches BRE-123 or BRE-123:variant — the ticket ID pattern. */
const TICKET_RE = /^([A-Z]+-\d+)(?::(\w+))?$/;

const LINEAR_API = "https://api.linear.app/graphql";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ResolvedTicket {
  /** Linear ticket identifier, e.g. "BRE-342" */
  ticket: string;
  /** Pipeline variant name, e.g. "default", "backend", "mobile" */
  variant: string;
  /** Issue title from Linear */
  title: string;
  /** State name from Linear, e.g. "In Progress", "Todo" */
  status: string;
  /** "explicit" for direct args; "project:<name>" for project-expanded tickets */
  source: string;
}

export interface AmbiguousResult {
  ambiguous: true;
  /** The project name query that produced multiple matches */
  query: string;
  /** All matching projects — caller must disambiguate */
  projects: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Linear API helpers
// ---------------------------------------------------------------------------

async function linearQuery(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data?: unknown;
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(
      `Linear API error: ${json.errors.map((e) => e.message).join(", ")}`
    );
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Label → variant resolution
// ---------------------------------------------------------------------------

/** Scan label names for "pipeline:<variant>" and return the variant suffix, or "default". */
export function resolvePipelineVariant(labels: string[]): string {
  for (const label of labels) {
    const m = label.match(/^pipeline:(\w+)$/i);
    if (m) return m[1];
  }
  return "default";
}

// ---------------------------------------------------------------------------
// Linear queries
// ---------------------------------------------------------------------------

interface LinearIssueNode {
  identifier: string;
  title: string;
  state: { name: string };
  labels: { nodes: { name: string }[] };
}

interface LinearProjectNode {
  id: string;
  name: string;
}

async function fetchIssuesByIdentifiers(
  apiKey: string,
  identifiers: string[]
): Promise<LinearIssueNode[]> {
  const data = (await linearQuery(
    apiKey,
    `query IssuesByIdentifier($identifiers: [String!]!) {
      issues(filter: { identifier: { in: $identifiers } }) {
        nodes {
          identifier
          title
          state { name }
          labels { nodes { name } }
        }
      }
    }`,
    { identifiers }
  )) as { issues: { nodes: LinearIssueNode[] } };

  return data.issues.nodes;
}

async function findProjectsByName(
  apiKey: string,
  name: string
): Promise<LinearProjectNode[]> {
  const data = (await linearQuery(
    apiKey,
    `query FindProjects($name: String!) {
      projects(filter: { name: { containsIgnoreCase: $name } }) {
        nodes { id name }
      }
    }`,
    { name }
  )) as { projects: { nodes: LinearProjectNode[] } };

  return data.projects.nodes;
}

async function fetchOpenIssuesForProject(
  apiKey: string,
  projectId: string
): Promise<{ projectName: string; issues: LinearIssueNode[] }> {
  const data = (await linearQuery(
    apiKey,
    `query ProjectIssues($projectId: String!) {
      project(id: $projectId) {
        name
        issues(
          first: 250
          filter: { state: { type: { nin: ["completed", "cancelled"] } } }
        ) {
          nodes {
            identifier
            title
            state { name }
            labels { nodes { name } }
          }
        }
      }
    }`,
    { projectId }
  )) as {
    project: {
      name: string;
      issues: { nodes: LinearIssueNode[] };
    } | null;
  };

  if (!data.project) {
    throw new Error(`Project with ID '${projectId}' not found`);
  }

  return {
    projectName: data.project.name,
    issues: data.project.issues.nodes,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    process.stderr.write(
      "Usage: resolve-tickets.ts [BRE-123[:variant]] [\"Project Name\"] ...\n" +
        "       resolve-tickets.ts --project-id <id> [BRE-123[:variant] ...]\n" +
        "\n" +
        "Environment:\n" +
        "  LINEAR_API_KEY  Required for project name and bare ticket ID resolution\n"
    );
    process.exit(1);
  }

  // Extract --project-id flag (used after disambiguation by collab.run)
  let forceProjectId: string | null = null;
  const args = [...rawArgs];
  const projectIdIdx = args.indexOf("--project-id");
  if (projectIdIdx !== -1) {
    forceProjectId = args[projectIdIdx + 1] ?? null;
    if (!forceProjectId) {
      process.stderr.write("Error: --project-id requires a value\n");
      process.exit(1);
    }
    args.splice(projectIdIdx, 2);
  }

  // Classify each argument
  const explicitWithVariant: { ticket: string; variant: string }[] = [];
  const explicitNoVariant: string[] = [];
  const projectNames: string[] = [];

  for (const arg of args) {
    const m = arg.match(TICKET_RE);
    if (m) {
      if (m[2]) {
        explicitWithVariant.push({ ticket: m[1], variant: m[2] });
      } else {
        explicitNoVariant.push(m[1]);
      }
    } else {
      projectNames.push(arg);
    }
  }

  const needsApi =
    forceProjectId !== null ||
    projectNames.length > 0 ||
    explicitNoVariant.length > 0;

  const apiKey = process.env.LINEAR_API_KEY ?? null;
  if (needsApi && !apiKey) {
    process.stderr.write(
      "Error: LINEAR_API_KEY environment variable is required for project name " +
        "and bare ticket ID resolution\n"
    );
    process.exit(1);
  }

  const results: ResolvedTicket[] = [];

  // --- Explicit tickets with variant — passthrough, no API needed ---
  // title and status are intentionally empty: the variant is already known from
  // the argument itself (e.g. BRE-342:backend), so no Linear API call is made.
  // The orchestrator only uses title/status for the AskUserQuestion confirmation
  // UI, which is only shown for project-sourced tickets.
  for (const { ticket, variant } of explicitWithVariant) {
    results.push({ ticket, variant, title: "", status: "", source: "explicit" });
  }

  // --- Explicit tickets without variant — resolve from Linear labels ---
  if (explicitNoVariant.length > 0) {
    const nodes = await fetchIssuesByIdentifiers(apiKey!, explicitNoVariant);
    const byId = new Map(nodes.map((n) => [n.identifier, n]));

    for (const ticketId of explicitNoVariant) {
      const issue = byId.get(ticketId);
      const labels = issue?.labels.nodes.map((l) => l.name) ?? [];
      results.push({
        ticket: ticketId,
        variant: resolvePipelineVariant(labels),
        title: issue?.title ?? "",
        status: issue?.state.name ?? "",
        source: "explicit",
      });
    }
  }

  // --- Forced project ID (called after disambiguation) ---
  if (forceProjectId !== null) {
    const { projectName, issues } = await fetchOpenIssuesForProject(
      apiKey!,
      forceProjectId
    );

    if (issues.length === 0) {
      process.stderr.write(`No open tickets found in '${projectName}'\n`);
      process.exit(3);
    }

    for (const issue of issues) {
      const labels = issue.labels.nodes.map((l) => l.name);
      results.push({
        ticket: issue.identifier,
        variant: resolvePipelineVariant(labels),
        title: issue.title,
        status: issue.state.name,
        source: `project:${projectName}`,
      });
    }

    process.stdout.write(JSON.stringify(results) + "\n");
    return;
  }

  // --- Project name arguments ---
  for (const name of projectNames) {
    const projects = await findProjectsByName(apiKey!, name);

    if (projects.length === 0) {
      process.stderr.write(
        `Error: No Linear project found matching '${name}'. ` +
          `Check the project name and try again.\n`
      );
      process.exit(2);
    }

    if (projects.length > 1) {
      // Ambiguous — output structured result for the orchestrator to handle via AskUserQuestion
      const ambiguous: AmbiguousResult = {
        ambiguous: true,
        query: name,
        projects,
      };
      process.stdout.write(JSON.stringify(ambiguous) + "\n");
      process.exit(0);
    }

    const project = projects[0];
    const { projectName, issues } = await fetchOpenIssuesForProject(
      apiKey!,
      project.id
    );

    if (issues.length === 0) {
      process.stderr.write(
        `No open tickets found in '${projectName}'. Nothing to run.\n`
      );
      process.exit(3);
    }

    for (const issue of issues) {
      const labels = issue.labels.nodes.map((l) => l.name);
      results.push({
        ticket: issue.identifier,
        variant: resolvePipelineVariant(labels),
        title: issue.title,
        status: issue.state.name,
        source: `project:${projectName}`,
      });
    }
  }

  process.stdout.write(JSON.stringify(results) + "\n");
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(
      `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
}
