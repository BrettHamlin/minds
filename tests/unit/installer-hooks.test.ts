import { describe, test, expect } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

const TEMPLATES_DIR = join(__dirname, "../../cli/src/templates");

describe("installer template completeness", () => {
  test("hooks template directory exists with required files", () => {
    const hooksDir = join(TEMPLATES_DIR, "hooks");
    expect(existsSync(hooksDir)).toBe(true);

    const files = readdirSync(hooksDir);
    expect(files).toContain("question-signal.hook.ts");
  });

  test("all directories referenced by installer exist in templates", () => {
    // These are the template dirs that copyTemplateDir() references in installer.ts
    const expectedDirs = [
      "commands",
      "skills",
      "handlers",
      "orchestrator",
      "lib-pipeline",
      "hooks",
      "scripts",
      "config",
    ];

    const missing = expectedDirs.filter(
      dir => !existsSync(join(TEMPLATES_DIR, dir))
    );

    if (missing.length > 0) {
      throw new Error(
        `Missing template directories: ${missing.join(", ")}\n` +
        `These are referenced by the installer but don't exist in cli/src/templates/`
      );
    }
  });

  test("settings.json hook paths reference files that exist in templates", () => {
    const settingsPath = join(TEMPLATES_DIR, "claude-settings.json");
    if (!existsSync(settingsPath)) return; // skip if no settings template

    const settings = JSON.parse(
      require("fs").readFileSync(settingsPath, "utf-8")
    );

    const hooks = settings?.hooks?.PreToolUse ?? [];
    const missing: string[] = [];

    for (const entry of hooks) {
      for (const hook of entry.hooks ?? []) {
        if (hook.command?.startsWith("bun .collab/")) {
          // Extract the path after "bun "
          const hookPath = hook.command.replace("bun ", "");
          // Map .collab/hooks/X → hooks/X in templates
          const templatePath = hookPath.replace(".collab/", "");
          if (!existsSync(join(TEMPLATES_DIR, templatePath))) {
            missing.push(`${hook.command} → templates/${templatePath}`);
          }
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Settings.json references hooks that don't exist in templates:\n` +
        missing.join("\n")
      );
    }
  });
});
