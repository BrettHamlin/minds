/**
 * hygiene.ts — Memory hygiene: promotion and pruning operations.
 *
 * promoteToMemoryMd: moves durable insights from daily logs into MEMORY.md.
 * pruneStaleEntries: removes outdated entries from MEMORY.md.
 *
 * Both operations are idempotent — safe to call repeatedly.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { memoryMdPath } from "./paths.js";

/** Marker used to delineate promoted entries in MEMORY.md. */
const PROMOTED_SECTION_START = "<!-- PROMOTED ENTRIES START -->";
const PROMOTED_SECTION_END = "<!-- PROMOTED ENTRIES END -->";

/** Marker for stale entries that should be pruned. */
const STALE_MARKER = "<!-- STALE -->";

/**
 * Promotes durable insights from daily logs into MEMORY.md.
 * Entries are appended to a "PROMOTED ENTRIES" section.
 * Idempotent: duplicate entries (same text) are not added twice.
 *
 * @param mindName - Name of the Mind
 * @param entries - Array of insight strings to promote
 */
export async function promoteToMemoryMd(mindName: string, entries: string[]): Promise<void> {
  if (entries.length === 0) return;

  const mdPath = memoryMdPath(mindName);
  const existing = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";

  // Find or create the promoted section
  let content = existing;

  const hasSection =
    content.includes(PROMOTED_SECTION_START) && content.includes(PROMOTED_SECTION_END);

  let sectionContent: string;

  if (hasSection) {
    const startIdx = content.indexOf(PROMOTED_SECTION_START) + PROMOTED_SECTION_START.length;
    const endIdx = content.indexOf(PROMOTED_SECTION_END);
    sectionContent = content.slice(startIdx, endIdx);
  } else {
    sectionContent = "\n";
    content =
      content.trimEnd() +
      "\n\n" +
      PROMOTED_SECTION_START +
      "\n" +
      PROMOTED_SECTION_END +
      "\n";
  }

  // Deduplicate: only add entries not already present
  const newEntries: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!sectionContent.includes(trimmed)) {
      newEntries.push(trimmed);
    }
  }

  if (newEntries.length === 0) return;

  // Append new entries into section
  const timestamp = new Date().toISOString().slice(0, 10);
  const entryBlock = newEntries.map((e) => `- [${timestamp}] ${e}`).join("\n");
  const newSectionContent = sectionContent + entryBlock + "\n";

  if (hasSection) {
    const startIdx = content.indexOf(PROMOTED_SECTION_START) + PROMOTED_SECTION_START.length;
    const endIdx = content.indexOf(PROMOTED_SECTION_END);
    content = content.slice(0, startIdx) + newSectionContent + content.slice(endIdx);
  } else {
    content = content.replace(
      PROMOTED_SECTION_START + "\n" + PROMOTED_SECTION_END,
      PROMOTED_SECTION_START + newSectionContent + PROMOTED_SECTION_END
    );
  }

  writeFileSync(mdPath, content, "utf8");
}

/**
 * Removes stale entries from MEMORY.md.
 * A stale entry is any line containing the STALE_MARKER (`<!-- STALE -->`).
 * Lines with this marker are removed from the file content.
 * Idempotent: if no stale entries exist, the file is unchanged.
 *
 * @param mindName - Name of the Mind
 */
export async function pruneStaleEntries(mindName: string): Promise<void> {
  const mdPath = memoryMdPath(mindName);
  if (!existsSync(mdPath)) return;

  const content = readFileSync(mdPath, "utf8");
  const lines = content.split("\n");
  const pruned = lines.filter((line) => !line.includes(STALE_MARKER));

  if (pruned.length === lines.length) return; // nothing to prune

  writeFileSync(mdPath, pruned.join("\n"), "utf8");
}
