#!/usr/bin/env bun
// collab.install.ts - Install collab core runtime into the current git repository
//
// Usage:
//   bun .claude/commands/collab.install.ts
//
// Environment variables (testing / local development):
//   COLLAB_SRC         Skip the git clone and use this local directory as source
//   COLLAB_SKIP_BUILD  Install a bun-run wrapper instead of a compiled binary
//
// What this installs (core only — pipeline commands come from /pipelines install):
//   .claude/commands/   5 core command files
//   .collab/bin/collab  CLI binary (or bun-run wrapper when COLLAB_SKIP_BUILD=1)
//   .collab/handlers/   Signal-handler TypeScript files
//   .collab/scripts/    Orchestrator + utility scripts
//   .collab/state/      initialized installed-pipelines.json

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  readdirSync,
} from "fs";
import { join } from "path";

// ── 1. Prerequisites ──────────────────────────────────────────────────────────

if (!existsSync(".git")) {
  console.error(
    "ERROR: Not in a git repository. Run this command from the root of your project."
  );
  process.exit(1);
}

let repoRoot: string;
try {
  repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
} catch {
  console.error("ERROR: Failed to determine repository root");
  process.exit(1);
}

console.log(`Installing collab into: ${repoRoot}`);

// ── 2. Resolve source directory (clone or use local) ─────────────────────────

let sourceDir: string;
let cloned = false;

if (process.env.COLLAB_SRC) {
  sourceDir = process.env.COLLAB_SRC;
  console.log(`Using local source: ${sourceDir}`);
} else {
  sourceDir = `/tmp/collab-install-${process.pid}`;
  console.log("Cloning collab (dev branch)...");
  try {
    execSync(
      `git clone --depth 1 --branch dev https://github.com/BrettHamlin/collab "${sourceDir}"`,
      { stdio: "inherit" }
    );
  } catch {
    console.error("ERROR: Failed to clone collab repository");
    process.exit(1);
  }
  console.log("Clone successful");
  cloned = true;
}

// ── 3. Directory structure ────────────────────────────────────────────────────

console.log("Creating directory structure...");
const dirs = [
  ".claude/commands",
  ".claude/skills",
  ".collab/bin",
  ".collab/config",
  ".collab/handlers",
  ".collab/memory",
  ".collab/scripts/orchestrator",
  ".collab/state/pipeline-registry",
  ".collab/state/pipeline-groups",
];
for (const d of dirs) {
  mkdirSync(join(repoRoot, d), { recursive: true });
}
console.log("Directories created");

// ── 4. Core commands (5 files only) ──────────────────────────────────────────
//
// Pipeline workflow commands (specify, plan, implement, etc.) are NOT installed
// here — they come from the registry via: /pipelines install <name>

const CORE_COMMANDS = [
  "collab.run.md",
  "collab.install.md",
  "collab.cleanup.md",
  "collab.install.ts",
  "pipelines.md",
];

console.log("Installing core commands...");
for (const cmd of CORE_COMMANDS) {
  const src = join(sourceDir, "src/commands", cmd);
  if (existsSync(src)) {
    copyFileSync(src, join(repoRoot, ".claude/commands", cmd));
  } else {
    console.log(`  Warning: ${cmd} not found in source — skipping`);
  }
}
chmodSync(join(repoRoot, ".claude/commands/collab.install.ts"), 0o755);
console.log(`Core commands installed (${CORE_COMMANDS.length} files)`);

// ── 5. collab CLI binary ──────────────────────────────────────────────────────

console.log("Building collab CLI binary...");
const binaryPath = join(repoRoot, ".collab/bin/collab");

if (process.env.COLLAB_SKIP_BUILD) {
  // Dev/test mode: install a bun-run wrapper so tests don't need a full compile
  writeFileSync(
    binaryPath,
    `#!/usr/bin/env bash\nexec bun run "${join(sourceDir, "src/cli/index.ts")}" "$@"\n`
  );
  console.log("  (dev mode: bun-run wrapper installed)");
} else {
  const cliSrc = join(sourceDir, "src/cli/index.ts");
  if (existsSync(cliSrc)) {
    try {
      execSync(
        `cd "${sourceDir}" && bun build src/cli/index.ts --compile --outfile "${binaryPath}"`,
        { shell: true, stdio: "inherit" }
      );
    } catch {
      console.log("  Warning: CLI binary build failed — skipping");
    }
  } else {
    console.log("  Warning: src/cli/index.ts not found in source — binary not built");
  }
}

if (existsSync(binaryPath)) {
  chmodSync(binaryPath, 0o755);
  console.log("CLI binary installed: .collab/bin/collab");
}

// ── 6. Runtime files ──────────────────────────────────────────────────────────

console.log("Installing runtime files...");

// Signal handlers
const handlersSrc = join(sourceDir, "src/handlers");
if (existsSync(handlersSrc)) {
  execSync(
    `find "${handlersSrc}" -name "*.ts" -exec cp {} "${join(repoRoot, ".collab/handlers/")}" \\;`,
    { shell: true }
  );
  execSync(
    `find "${join(repoRoot, ".collab/handlers")}" -name "*.ts" -exec chmod +x {} \\;`,
    { shell: true }
  );
}

// Orchestrator scripts (exclude *.test.ts)
const orchestratorSrc = join(sourceDir, "src/scripts/orchestrator");
if (existsSync(orchestratorSrc)) {
  execSync(
    `find "${orchestratorSrc}" \\( -name "*.sh" -o -name "*.ts" \\) ! -name "*.test.ts" -exec cp {} "${join(repoRoot, ".collab/scripts/orchestrator/")}" \\;`,
    { shell: true }
  );
  execSync(
    `find "${join(repoRoot, ".collab/scripts/orchestrator")}" \\( -name "*.sh" -o -name "*.ts" \\) -exec chmod +x {} \\;`,
    { shell: true }
  );
}

// Non-orchestrator scripts (top-level of src/scripts/, exclude *.test.ts)
const scriptsSrc = join(sourceDir, "src/scripts");
if (existsSync(scriptsSrc)) {
  execSync(
    `find "${scriptsSrc}" -maxdepth 1 \\( -name "*.sh" -o -name "*.ts" \\) ! -name "*.test.ts" -exec cp {} "${join(repoRoot, ".collab/scripts/")}" \\;`,
    { shell: true }
  );
  execSync(
    `find "${join(repoRoot, ".collab/scripts")}" -maxdepth 1 \\( -name "*.sh" -o -name "*.ts" \\) -exec chmod +x {} \\;`,
    { shell: true }
  );
}

// Pipeline config (always overwrite to keep runtime in sync with source)
const pipelineConfigSrc = join(sourceDir, "src/config/pipeline.json");
if (existsSync(pipelineConfigSrc)) {
  copyFileSync(pipelineConfigSrc, join(repoRoot, ".collab/config/pipeline.json"));
} else {
  console.log("  Warning: src/config/pipeline.json not found in source — skipping");
}

// Pipeline variant configs (always overwrite to keep runtime in sync with source)
mkdirSync(join(repoRoot, ".collab/config/pipeline-variants"), { recursive: true });
const variantsDir = join(sourceDir, "src/config/pipeline-variants");
if (existsSync(variantsDir)) {
  execSync(
    `find "${variantsDir}" -name "*.json" -exec cp {} "${join(repoRoot, ".collab/config/pipeline-variants/")}" \\;`,
    { shell: true }
  );
  console.log("Pipeline variant configs installed");
} else {
  console.log("  Warning: src/config/pipeline-variants not found in source — skipping");
}

// Default command configs (scaffold only — skip if user has customized)
const commandConfigs = [
  { src: "src/config/defaults/run-tests.json", dest: ".collab/config/run-tests.json" },
  { src: "src/config/defaults/visual-verify.json", dest: ".collab/config/visual-verify.json" },
  { src: "src/config/defaults/deploy-verify.json", dest: ".collab/config/deploy-verify.json" },
];
let configScaffoldCount = 0;
for (const cfg of commandConfigs) {
  const destPath = join(repoRoot, cfg.dest);
  const srcPath = join(sourceDir, cfg.src);
  if (!existsSync(destPath) && existsSync(srcPath)) {
    copyFileSync(srcPath, destPath);
    configScaffoldCount++;
  }
}
if (configScaffoldCount > 0) {
  console.log(`Command configs scaffolded: ${configScaffoldCount} defaults installed`);
} else {
  console.log("Command configs: all exist, preserving");
}

console.log("Runtime files installed");

// ── 7. Initialize state ───────────────────────────────────────────────────────

const statePath = join(repoRoot, ".collab/state/installed-pipelines.json");
if (!existsSync(statePath)) {
  writeFileSync(statePath, "{}");
  console.log("State initialized: .collab/state/installed-pipelines.json");
} else {
  console.log("State file exists — preserving");
}

// Preserve-on-install: .claude/settings.json (only write if absent)
const settingsPath = join(repoRoot, ".claude/settings.json");
if (!existsSync(settingsPath)) {
  const settingsSrc = join(sourceDir, "src/claude-settings.json");
  if (existsSync(settingsSrc)) {
    copyFileSync(settingsSrc, settingsPath);
    console.log("Settings initialized: .claude/settings.json");
  }
} else {
  console.log("Settings file exists — preserving");
}

// Preserve-on-install: constitution (only write if absent)
const constitutionPath = join(repoRoot, ".collab/memory/constitution.md");
if (!existsSync(constitutionPath)) {
  const constitutionSrcs = [
    join(sourceDir, ".specify/templates/constitution-template.md"),
    join(sourceDir, "src/config/constitution-template.md"),
  ];
  const constitutionSrc = constitutionSrcs.find((p) => existsSync(p));
  if (constitutionSrc) {
    copyFileSync(constitutionSrc, constitutionPath);
  } else {
    writeFileSync(constitutionPath, "# Project Constitution\n\nAdd your project principles here.\n");
  }
  console.log("Constitution initialized: .collab/memory/constitution.md");
} else {
  console.log("Constitution file exists — preserving");
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

if (cloned) {
  try {
    execSync(`rm -rf "${sourceDir}"`, { shell: true });
  } catch {
    // Non-fatal — /tmp cleaned by OS
  }
}

// ── 8. Success message ────────────────────────────────────────────────────────

console.log("");
console.log("Collab installation complete!");
console.log("");
console.log("Next steps:");
console.log("  1. Browse available pipelines:  /pipelines browse");
console.log("  2. Install a workflow pipeline: /pipelines install specify");
console.log("  3. Run autonomous workflow:     /collab.run BRE-XXX");
console.log("");
console.log("Core Commands (installed):");
console.log("  /collab.run              - Autonomous full pipeline orchestration");
console.log("  /collab.cleanup          - Clean up completed feature (branch/worktree)");
console.log("  /pipelines               - Browse and install workflow pipelines");
console.log("");
console.log("Workflow Commands (install via /pipelines install):");
console.log("  /collab.specify          - Create feature specification");
console.log("  /collab.plan             - Generate implementation plan");
console.log("  /collab.run-tests        - Execute test suite");
console.log("  /collab.visual-verify    - Visual verification");
console.log("  /collab.verify-execute   - Verification checklist execution");
console.log("  /collab.pre-deploy-confirm - Pre-deploy human gate");
console.log("  /collab.deploy-verify    - Post-deploy smoke verification");
console.log("");
console.log(`Installed in: ${repoRoot}`);
