import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const COMMANDS_DIR = join(__dirname, "../../src/commands");

describe("no shell script references in commands", () => {
  test("command files do not reference .sh scripts", () => {
    const cmdFiles = readdirSync(COMMANDS_DIR).filter(f => f.endsWith(".md"));
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of cmdFiles) {
      const content = readFileSync(join(COMMANDS_DIR, file), "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        // Match references to .sh scripts (not just mentions in comments/docs)
        if (/\.\w+\.sh\b/.test(lines[i]) && !/^<!--/.test(lines[i].trim())) {
          violations.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map(v => `${v.file}:${v.line}: ${v.text}`)
        .join("\n");
      console.error("Shell script references found in command files:\n" + report);
    }
    expect(violations).toEqual([]);
  });
});
