/**
 * group-questions.ts — Batch question grouping utility for the clarify phase.
 *
 * Groups related findings by topic/section before emission so the orchestrator
 * can reason about related questions together and avoid redundant context loading.
 *
 * Owned by: @clarify Mind
 */

import type { Finding } from "../pipeline_core/questions.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface GroupedFindings {
  /** Inferred topic label (e.g., "Data Model", "API Contracts", "Uncategorized") */
  topic: string;
  /** All findings that belong to this topic group */
  findings: Finding[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the keyword matches as a whole word (or phrase) in text.
 * Uses word boundaries to avoid false positives like "form" matching "format".
 */
function matchesWholeWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

// ── Topic extraction ──────────────────────────────────────────────────────────

/**
 * Known taxonomy categories from the clarify phase spec.
 * Ordered by priority — first match wins.
 */
const TOPIC_PATTERNS: Array<{ topic: string; keywords: string[] }> = [
  {
    topic: "Functional Scope",
    keywords: ["scope", "out-of-scope", "user role", "permission", "access", "feature"],
  },
  {
    topic: "Data Model",
    keywords: ["schema", "model", "field", "column", "table", "primary key", "relationship", "database", "db"],
  },
  {
    topic: "UX Flow",
    keywords: ["ui", "ux", "error state", "loading", "loading state", "flow", "page", "screen", "form", "modal"],
  },
  {
    topic: "Non-Functional",
    keywords: ["performance", "latency", "throughput", "observability", "monitoring", "logging", "scale", "sla"],
  },
  {
    topic: "Integration",
    keywords: ["api", "contract", "endpoint", "webhook", "integration", "third-party", "external", "failure mode"],
  },
  {
    topic: "Edge Cases",
    keywords: ["edge case", "concurrency", "race condition", "validation", "boundary", "limit", "overflow"],
  },
  {
    topic: "Terminology",
    keywords: ["terminology", "naming", "canonical", "enum", "constant", "definition", "term"],
  },
];

/**
 * Extract a topic label from a finding by scanning its question text and context fields.
 *
 * Resolution order:
 *  1. specReferences — look for Markdown section headers (## ...) or quoted section names
 *  2. question + why text — match against known taxonomy keywords
 *  3. Fallback: "Uncategorized"
 */
function extractTopic(finding: Finding): string {
  // 1. Check specReferences for section headers first
  for (const ref of finding.context.specReferences) {
    // Match "## Section Name" patterns
    const headerMatch = ref.match(/#{1,3}\s+(.+)/);
    if (headerMatch) {
      return headerMatch[1].trim();
    }
    // Match "Section: Name" or "Section Name" patterns from quoted references
    const sectionMatch = ref.match(/^[Ss]ection[:\s]+(.+?)(?:\s*[-–—]|$)/);
    if (sectionMatch) {
      return sectionMatch[1].trim();
    }
  }

  // 2. Match question + why text against known taxonomy keywords
  const searchText = [
    finding.question,
    finding.context.why,
    ...finding.context.specReferences,
    ...finding.context.implications,
  ]
    .join(" ")
    .toLowerCase();

  for (const { topic, keywords } of TOPIC_PATTERNS) {
    if (keywords.some((kw) => matchesWholeWord(searchText, kw))) {
      return topic;
    }
  }

  return "Uncategorized";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Group an array of findings by inferred topic/section.
 *
 * Findings within each group preserve their original order.
 * Groups are ordered by first occurrence of their topic in the input array.
 *
 * @example
 * const groups = groupFindings(collector.getFindings());
 * // groups[0] = { topic: "Data Model", findings: [f1, f3] }
 * // groups[1] = { topic: "Integration", findings: [f2] }
 */
export function groupFindings(findings: Finding[]): GroupedFindings[] {
  const topicOrder: string[] = [];
  const groups = new Map<string, Finding[]>();

  for (const finding of findings) {
    const topic = extractTopic(finding);
    if (!groups.has(topic)) {
      topicOrder.push(topic);
      groups.set(topic, []);
    }
    groups.get(topic)!.push(finding);
  }

  return topicOrder.map((topic) => ({
    topic,
    findings: groups.get(topic)!,
  }));
}
