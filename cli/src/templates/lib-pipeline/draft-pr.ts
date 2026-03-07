/**
 * draft-pr.ts — Create a GitHub draft PR for a feature branch
 *
 * Uses `gh pr create --draft` to open a draft PR on GitHub.
 * Returns the PR URL, number, and branch for storage in metrics.db.
 *
 * Category: System node backing library. Called by create-draft-pr.ts CLI.
 */
import { execFileSync } from "child_process";

export interface DraftPrResult {
  prUrl: string;
  prNumber: number;
  prBranch: string;
}

/** Extract PR number from a GitHub PR URL — e.g. ".../pull/42" -> 42 */
export function extractPrNumber(url: string): number {
  const trimmed = url.trim();
  const match = trimmed.match(/\/pull\/(\d+)\s*$/);
  if (!match) {
    throw new Error(`Cannot extract PR number from URL: ${url}`);
  }
  return parseInt(match[1], 10);
}

/** Build default PR title: "[{ticketId}] {branch}" */
export function buildPrTitle(ticketId: string, branch: string): string {
  return `[${ticketId}] ${branch}`;
}

/** Build default PR body: includes ticketId, branch, note about auto-creation */
export function buildPrBody(ticketId: string, branch: string): string {
  return [
    `## ${ticketId}`,
    "",
    `Branch: \`${branch}\``,
    "",
    "---",
    "_Auto-created draft PR by collab pipeline._",
  ].join("\n");
}

/**
 * Create a GitHub draft PR.
 * Uses execFileSync("gh", ["pr","create","--draft","--title",title,"--body",body])
 * with cwd set to the repo root. gh outputs the PR URL on stdout.
 * Parses URL to extract PR number. Returns DraftPrResult.
 * Throws if gh fails or URL cannot be parsed.
 */
export function createDraftPr(
  ticketId: string,
  branch: string,
  options: { title?: string; body?: string; cwd?: string } = {}
): DraftPrResult {
  const title = options.title ?? buildPrTitle(ticketId, branch);
  const body = options.body ?? buildPrBody(ticketId, branch);

  const stdout = execFileSync(
    "gh",
    ["pr", "create", "--draft", "--title", title, "--body", body],
    {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const prUrl = stdout.trim();
  const prNumber = extractPrNumber(prUrl);

  return {
    prUrl,
    prNumber,
    prBranch: branch,
  };
}
