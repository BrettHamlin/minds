#!/usr/bin/env bun
/**
 * Update or remove a markdown section in a file.
 *
 * A "section" is defined as a level-2 heading line (## Heading) and all
 * lines that follow it, up to (but not including) the next level-2 heading
 * or EOF — whichever comes first.
 *
 * CLI usage:
 *   # Remove a section:
 *   bun minds/lib/update-claude-section.ts <file> '<## Heading>'
 *
 *   # Replace a section (content from a file):
 *   bun minds/lib/update-claude-section.ts <file> '<## Heading>' --content-file <path>
 *
 *   # Replace a section (content from stdin):
 *   echo "## Heading\ncontent" | bun minds/lib/update-claude-section.ts <file> '<## Heading>' --stdin
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

/**
 * Update or remove a named section in a markdown file.
 *
 * @param filePath    Absolute or relative path to the file.
 * @param heading     Exact heading line to match (e.g. "## Active Mind Review").
 * @param newContent  If provided, replaces the section with this content.
 *                    If undefined, removes the section entirely.
 *                    If the section is not found and newContent is provided, appends it.
 */
export function updateSection(
  filePath: string,
  heading: string,
  newContent?: string
): void {
  let text = "";
  if (existsSync(filePath)) {
    text = readFileSync(filePath, "utf8");
  } else if (newContent === undefined) {
    // Nothing to remove from a non-existent file.
    return;
  }

  // Split into lines, stripping the trailing empty element produced when
  // the file ends with a newline (we re-add the trailing newline at write time).
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  // Find the start of the target section.
  const startIdx = lines.findIndex((line) => line.trimEnd() === heading);

  if (startIdx === -1) {
    // Section not found.
    if (newContent !== undefined) {
      // Append new content, ensuring a separating newline.
      const sep = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
      const toWrite =
        text + sep + newContent + (newContent.endsWith("\n") ? "" : "\n");
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, toWrite, "utf8");
    }
    return;
  }

  // Find end of section: next level-2 heading or EOF.
  // Handles the edge case where the section is the last in the file —
  // endIdx stays at lines.length and slice(endIdx) returns [].
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);

  let finalLines: string[];

  if (newContent !== undefined) {
    // Replace section with new content.
    const newLines = newContent.split("\n");
    // Strip trailing empty element if newContent ends with \n.
    if (newLines[newLines.length - 1] === "") {
      newLines.pop();
    }
    finalLines = [...before, ...newLines, ...after];
  } else {
    // Remove section entirely.
    // Also strip blank lines at the removal boundary to avoid double-spacing.
    while (before.length > 0 && before[before.length - 1].trim() === "") {
      before.pop();
    }
    while (after.length > 0 && after[0].trim() === "") {
      after.shift();
    }
    finalLines = [...before, ...after];
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, finalLines.join("\n") + "\n", "utf8");
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      "Usage: bun update-claude-section.ts <file> <heading> [--content-file <path>] [--stdin]"
    );
    process.exit(1);
  }

  const filePath = args[0];
  const heading = args[1];
  let newContent: string | undefined;

  const contentFileIdx = args.indexOf("--content-file");
  const stdinFlag = args.includes("--stdin");

  if (contentFileIdx !== -1) {
    const contentFile = args[contentFileIdx + 1];
    if (!contentFile) {
      console.error("--content-file requires a path argument");
      process.exit(1);
    }
    newContent = readFileSync(contentFile, "utf8");
  } else if (stdinFlag) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    newContent = Buffer.concat(chunks).toString("utf8");
  }
  // else newContent remains undefined → remove the section

  updateSection(filePath, heading, newContent);
}

