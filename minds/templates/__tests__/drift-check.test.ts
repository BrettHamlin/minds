// Drift detection: minds/templates/commands/ and cli/src/templates/commands/
// must stay in sync with src/commands/ (the canonical source of truth).
import { describe, test, expect } from "bun:test";
import { readdirSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const CANONICAL_DIR = join(REPO_ROOT, "src", "commands");
const MINDS_TEMPLATES_DIR = join(REPO_ROOT, "minds", "templates", "commands");
const CLI_TEMPLATES_DIR = join(REPO_ROOT, "cli", "src", "templates", "commands");

function mdFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

const canonicalFiles = mdFiles(CANONICAL_DIR);

describe("minds/templates/commands/ matches src/commands/", () => {
  for (const file of canonicalFiles) {
    test(`${file} matches canonical`, async () => {
      const canonical = await Bun.file(join(CANONICAL_DIR, file)).text();
      const template = await Bun.file(join(MINDS_TEMPLATES_DIR, file)).text();
      expect(template).toBe(canonical);
    });
  }
});

describe("cli/src/templates/commands/ matches src/commands/", () => {
  const cliFiles = mdFiles(CLI_TEMPLATES_DIR);
  for (const file of cliFiles) {
    test(`${file} matches canonical`, async () => {
      const canonical = await Bun.file(join(CANONICAL_DIR, file)).text();
      const cliTemplate = await Bun.file(join(CLI_TEMPLATES_DIR, file)).text();
      expect(cliTemplate).toBe(canonical);
    });
  }
});
