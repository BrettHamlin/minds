import { describe, test, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const CLI_ROOT = join(import.meta.dir, "..");

describe("CLI scaffold", () => {
  test("package.json exists", () => {
    expect(existsSync(join(CLI_ROOT, "package.json"))).toBe(true);
  });

  test("bin/collab.ts exists", () => {
    expect(existsSync(join(CLI_ROOT, "bin/collab.ts"))).toBe(true);
  });

  test("CLI shows help", () => {
    const output = execSync("bun run bin/collab.ts --help", { cwd: CLI_ROOT, encoding: "utf-8" });
    expect(output).toContain("init");
    expect(output).toContain("update");
    expect(output).toContain("status");
  });

  test("CLI shows version", () => {
    const output = execSync("bun run bin/collab.ts --version", { cwd: CLI_ROOT, encoding: "utf-8" });
    expect(output.trim()).toBe("0.1.0");
  });

  test("command stubs exist", () => {
    expect(existsSync(join(CLI_ROOT, "src/commands/init.ts"))).toBe(true);
    expect(existsSync(join(CLI_ROOT, "src/commands/update.ts"))).toBe(true);
    expect(existsSync(join(CLI_ROOT, "src/commands/status.ts"))).toBe(true);
  });

  test("util modules exist", () => {
    expect(existsSync(join(CLI_ROOT, "src/utils/git.ts"))).toBe(true);
    expect(existsSync(join(CLI_ROOT, "src/utils/version.ts"))).toBe(true);
    expect(existsSync(join(CLI_ROOT, "src/utils/fs.ts"))).toBe(true);
  });
});
