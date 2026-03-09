/**
 * display.ts — Terminal display utilities for Fission analysis results.
 *
 * Formats ProposedMindMap data for readable ASCII terminal output.
 * No color codes or special terminal escapes -- portable across terminals.
 */

import type { ProposedMindMap } from "../naming/types.js";

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Format the full Fission analysis result for terminal display.
 *
 * Sections:
 *   1. Header with summary stats
 *   2. Foundation Mind (name, file count, top hub files)
 *   3. Domain Minds table (Name, Files, Cohesion, Domain)
 *   4. Coupling Matrix (non-zero entries only)
 *   5. Recommendations
 */
export function displayProposedMap(map: ProposedMindMap): string {
  const sections: string[] = [];

  // --- Header ---
  const domainCount = map.minds.length;
  const totalFiles =
    map.foundation.files.length +
    map.minds.reduce((sum, m) => sum + m.fileCount, 0);

  sections.push(
    line("=", 70),
    `  Fission Analysis Complete`,
    `  ${domainCount} domain Mind${domainCount !== 1 ? "s" : ""} + 1 foundation Mind | ${totalFiles} files total`,
    line("=", 70),
  );

  // --- Foundation Mind ---
  sections.push("");
  sections.push("  Foundation Mind");
  sections.push(line("-", 40));
  sections.push(`  Files: ${map.foundation.files.length} files`);
  sections.push(`  Domain: ${map.foundation.domain}`);

  if (map.foundation.files.length > 0) {
    sections.push("  Top hub files:");
    const topFiles = map.foundation.files.slice(0, 5);
    for (const f of topFiles) {
      sections.push(`    - ${f}`);
    }
    if (map.foundation.files.length > 5) {
      sections.push(
        `    ... and ${map.foundation.files.length - 5} more`,
      );
    }
  }

  if (map.foundation.exposes.length > 0) {
    sections.push(`  Exposes: ${map.foundation.exposes.join(", ")}`);
  }

  // --- Domain Minds Table ---
  if (map.minds.length > 0) {
    sections.push("");
    sections.push("  Domain Minds");
    sections.push(line("-", 70));

    // Table header
    const nameW = 18;
    const filesW = 7;
    const cohW = 9;
    const domainW = 60;

    sections.push(
      `  ${pad("Name", nameW)} ${pad("Files", filesW)} ${pad("Cohesion", cohW)} Domain`,
    );
    sections.push(`  ${pad("-", nameW, "-")} ${pad("-", filesW, "-")} ${pad("-", cohW, "-")} ${pad("-", domainW, "-")}`);

    for (const mind of map.minds) {
      const domainTrunc = truncate(mind.domain, 60);
      sections.push(
        `  ${pad(mind.name, nameW)} ${pad(String(mind.fileCount), filesW)} ${pad(mind.cohesion.toFixed(2), cohW)} ${domainTrunc}`,
      );
    }
  }

  // --- Coupling Matrix ---
  if (map.couplingMatrix.length > 0) {
    sections.push("");
    sections.push("  Coupling Matrix");
    sections.push(line("-", 50));
    sections.push(`  ${pad("From", 18)} ${pad("To", 18)} Edges`);
    sections.push(`  ${pad("-", 18, "-")} ${pad("-", 18, "-")} ${pad("-", 7, "-")}`);

    for (const entry of map.couplingMatrix) {
      sections.push(
        `  ${pad(entry.from, 18)} ${pad(entry.to, 18)} ${entry.edges}`,
      );
    }
  }

  // --- Recommendations ---
  if (map.recommendations.length > 0) {
    sections.push("");
    sections.push("  Recommendations");
    sections.push(line("-", 50));

    for (const rec of map.recommendations) {
      sections.push(`  [${rec.type}] ${rec.target}`);
      sections.push(`    ${rec.reason}`);
      sections.push(`    -> ${rec.suggestion}`);
    }
  }

  sections.push("");
  return sections.join("\n");
}

/**
 * One-line summary of the proposed Mind map.
 */
export function displaySummary(map: ProposedMindMap): string {
  const domainCount = map.minds.length;
  const totalFiles =
    map.foundation.files.length +
    map.minds.reduce((sum, m) => sum + m.fileCount, 0);

  return `Fission proposes ${domainCount} domain Mind${domainCount !== 1 ? "s" : ""} + 1 Foundation Mind covering ${totalFiles} files`;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function line(char: string, width: number): string {
  return "  " + char.repeat(width);
}

function pad(text: string, width: number, fill = " "): string {
  if (text.length >= width) return text.slice(0, width);
  return text + fill.repeat(width - text.length);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
