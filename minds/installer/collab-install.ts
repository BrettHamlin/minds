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
  readFileSync,
  readdirSync,
  statSync,
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
//
// Priority: --local <path> flag > COLLAB_SRC env var > GitHub clone

const localIdx = process.argv.indexOf("--local");
const localPath = localIdx !== -1
  ? process.argv[localIdx + 1]
  : (process.env.COLLAB_SRC ?? null);

let tempDir: string;
if (localPath) {
  // Resolve to absolute path
  try {
    const { execSync: exec2 } = await import("child_process");
    tempDir = exec2(`cd "${localPath}" && pwd`, { encoding: "utf-8" }).trim();
  } catch {
    tempDir = localPath;
  }
  if (!existsSync(tempDir)) {
    console.error(`ERROR: Local path does not exist: ${tempDir}`);
    process.exit(1);
  }
  console.log(`Installing from local path: ${tempDir}`);
} else {
  tempDir = `/tmp/collab-install-${process.pid}`;
  console.log("Cloning collab from GitHub (dev branch)...");
  try {
    execSync(
      `git clone --depth 1 --branch dev https://github.com/BrettHamlin/collab "${tempDir}"`,
      { stdio: "inherit" }
    );
  } catch {
    console.error("ERROR: Failed to clone collab repository");
    process.exit(1);
  }
  console.log("Clone successful");
}

// ── 3. Directory structure ────────────────────────────────────────────────────

console.log("Creating directory structure...");
const dirs = [
  ".claude/commands",
  ".claude/skills",
  ".collab/bin",
  ".collab/config",
  ".collab/config/pipeline-variants",
  ".collab/config/test-fixtures",
  ".collab/handlers",
  ".collab/memory",
  ".collab/scripts/orchestrator",
  ".collab/scripts/orchestrator/commands",
  ".collab/transport",
  ".collab/state/pipeline-registry",
  ".collab/state/pipeline-groups",
  ".collab/lib",
  ".collab/hooks",
  ".specify/scripts",
  ".specify/templates",
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
  // collab.install.ts lives in minds/templates/commands/ (standalone template copy)
  const srcDir = cmd === "collab.install.ts"
    ? join(tempDir, "minds/templates/commands")
    : join(tempDir, "src/commands");
  const src = join(srcDir, cmd);
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
    `#!/usr/bin/env bash\nexec bun run "${join(tempDir, "minds/cli/index.ts")}" "$@"\n`
  );
  console.log("  (dev mode: bun-run wrapper installed)");
} else {
  const cliSrc = join(tempDir, "minds/cli/index.ts");
  if (existsSync(cliSrc)) {
    try {
      execSync(
        `cd "${tempDir}" && bun build minds/cli/index.ts --compile --outfile "${binaryPath}"`,
        { shell: true, stdio: "inherit" }
      );
    } catch {
      console.log("  Warning: CLI binary build failed — skipping");
    }
  } else {
    console.log("  Warning: minds/cli/index.ts not found in source — binary not built");
  }
}

if (existsSync(binaryPath)) {
  chmodSync(binaryPath, 0o755);
  console.log("CLI binary installed: .collab/bin/collab");
}

// ── 6. Runtime files ──────────────────────────────────────────────────────────

console.log("Installing runtime files...");

// Signal handlers (standalone copies from minds/templates/handlers/)
const handlersSrc = join(tempDir, "minds/templates/handlers");
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

// Orchestrator scripts (standalone copies from minds/templates/orchestrator/, preserve commands/ subdirectory)
const orchSrc = join(tempDir, "minds/templates/orchestrator");
if (existsSync(orchSrc)) {
  // Copy top-level scripts
  for (const f of readdirSync(orchSrc)) {
    const fp = join(orchSrc, f);
    if (statSync(fp).isDirectory()) continue;
    if (!f.endsWith(".ts") && !f.endsWith(".sh")) continue;
    if (f.endsWith(".test.ts")) continue;
    copyFileSync(fp, join(repoRoot, ".collab/scripts/orchestrator", f));
  }
  // Copy subdirectories (e.g. commands/)
  for (const dir of readdirSync(orchSrc)) {
    const dirPath = join(orchSrc, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    const destDir = join(repoRoot, ".collab/scripts/orchestrator", dir);
    mkdirSync(destDir, { recursive: true });
    for (const f of readdirSync(dirPath)) {
      if (!f.endsWith(".ts") && !f.endsWith(".sh")) continue;
      if (f.endsWith(".test.ts")) continue;
      copyFileSync(join(dirPath, f), join(destDir, f));
    }
  }
  execSync(
    `find "${join(repoRoot, ".collab/scripts/orchestrator")}" \\( -name "*.sh" -o -name "*.ts" \\) -exec chmod +x {} \\;`,
    { shell: true }
  );
}

// Non-orchestrator scripts (standalone copies from minds/templates/scripts/)
const scriptsSrc = join(tempDir, "minds/templates/scripts");
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

// Shared library files (standalone copies from minds/templates/lib-pipeline/ → .collab/lib/pipeline/)
const libPipelineSrc = join(tempDir, "minds/templates/lib-pipeline");
if (existsSync(libPipelineSrc)) {
  const destDir = join(repoRoot, ".collab/lib/pipeline");
  mkdirSync(destDir, { recursive: true });
  for (const file of readdirSync(libPipelineSrc)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    copyFileSync(join(libPipelineSrc, file), join(destDir, file));
  }
  execSync(
    `find "${join(repoRoot, ".collab/lib")}" -name "*.ts" -exec chmod +x {} \\;`,
    { shell: true }
  );
}

// Transport scripts (from minds/transport/, excluding dev-only server.ts)
const transportSrc = join(tempDir, "minds/transport");
if (existsSync(transportSrc)) {
  // Clear stale transport files before copying fresh ones
  execSync(`rm -f "${repoRoot}/.collab/transport/"*.ts`, { stdio: "ignore" });
  for (const f of readdirSync(transportSrc)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "server.ts") continue;
    if (statSync(join(transportSrc, f)).isDirectory()) continue;
    copyFileSync(join(transportSrc, f), join(repoRoot, ".collab/transport", f));
  }
  execSync(
    `find "${join(repoRoot, ".collab/transport")}" -name "*.ts" -exec chmod +x {} \\;`,
    { shell: true }
  );
}

// Specify scripts (create-new-feature.ts and related)
const specifySrc = join(tempDir, "src/.specify/scripts");
if (existsSync(specifySrc)) {
  for (const f of readdirSync(specifySrc)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    copyFileSync(join(specifySrc, f), join(repoRoot, ".specify/scripts", f));
  }
  execSync(
    `find "${join(repoRoot, ".specify/scripts")}" -name "*.ts" -exec chmod +x {} \\;`,
    { shell: true }
  );
  console.log("Specify scripts installed");
}

// Specify templates (spec-template.md, etc.)
// Check both src/.specify/templates/ and minds/templates/specify-templates/
const specifyTplSources = [
  join(tempDir, "src/.specify/templates"),
  join(tempDir, "minds/templates/specify-templates"),
];
for (const tplSrc of specifyTplSources) {
  if (!existsSync(tplSrc)) continue;
  for (const f of readdirSync(tplSrc)) {
    const dest = join(repoRoot, ".specify/templates", f);
    if (!existsSync(dest)) {
      copyFileSync(join(tplSrc, f), dest);
    }
  }
}
if (readdirSync(join(repoRoot, ".specify/templates")).length > 0) {
  console.log("Specify templates installed");
}

// Hooks (Claude Code settings.json references these)
const hooksSrc = join(tempDir, "src/hooks");
if (existsSync(hooksSrc)) {
  for (const f of readdirSync(hooksSrc)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const srcPath = join(hooksSrc, f);
    if (statSync(srcPath).isFile()) {
      copyFileSync(srcPath, join(repoRoot, ".collab/hooks", f));
    }
  }
  execSync(
    `find "${join(repoRoot, ".collab/hooks")}" -name "*.ts" -exec chmod +x {} \\;`,
    { shell: true }
  );
  console.log("Hooks installed");
}

// Pipeline config (always overwrite to keep runtime in sync with source)
const pipelineConfigSrc = join(tempDir, "minds/templates/pipeline.json");
if (existsSync(pipelineConfigSrc)) {
  copyFileSync(pipelineConfigSrc, join(repoRoot, ".collab/config/pipeline.json"));
} else {
  console.log("  Warning: minds/templates/pipeline.json not found in source — skipping");
}

// Schema files
try {
  execSync(
    `find "${join(tempDir, "minds/templates")}" -maxdepth 1 -name "*.schema.json" -exec cp {} "${join(repoRoot, ".collab/config/")}" \\;`,
    { shell: true }
  );
} catch {
  // Non-fatal if no schema files
}

// Pipeline variant configs (always overwrite to keep runtime in sync with source)
const variantsDir = join(tempDir, "minds/templates/pipeline-variants");
if (existsSync(variantsDir)) {
  execSync(
    `find "${variantsDir}" -name "*.json" -exec cp {} "${join(repoRoot, ".collab/config/pipeline-variants/")}" \\;`,
    { shell: true }
  );
  console.log("Pipeline variant configs installed");
} else {
  console.log("  Warning: minds/templates/pipeline-variants not found in source — skipping");
}

// Scan installed variant configs and install any referenced commands missing from
// .claude/commands/. Commands listed in pipeline phase "command" fields (e.g.,
// "/collab.spec-critique") must be present for the pipeline to dispatch correctly.
const installedVariantsDir = join(repoRoot, ".collab/config/pipeline-variants");
const variantCommandsSrc = join(tempDir, "src/commands");
if (existsSync(installedVariantsDir) && existsSync(variantCommandsSrc)) {
  const referencedCommands = new Set<string>();
  for (const vf of readdirSync(installedVariantsDir).filter((f) => f.endsWith(".json"))) {
    try {
      const config = JSON.parse(readFileSync(join(installedVariantsDir, vf), "utf-8"));
      for (const phase of Object.values(config.phases ?? {})) {
        const cmd = (phase as Record<string, unknown>).command;
        if (typeof cmd === "string" && cmd.startsWith("/")) {
          const cmdName = cmd.slice(1); // strip leading "/"
          const cmdFile = cmdName.endsWith(".md") ? cmdName : `${cmdName}.md`;
          referencedCommands.add(cmdFile);
        }
      }
    } catch {
      // Skip malformed variant configs
    }
  }
  let variantCmdsInstalled = 0;
  for (const cmdFile of referencedCommands) {
    const dest = join(repoRoot, ".claude/commands", cmdFile);
    if (existsSync(dest)) continue; // already installed (e.g. from a pack)
    const src = join(variantCommandsSrc, cmdFile);
    if (!existsSync(src)) continue; // not available in source
    copyFileSync(src, dest);
    variantCmdsInstalled++;
  }
  if (variantCmdsInstalled > 0) {
    console.log(`Variant commands installed: ${variantCmdsInstalled} command(s) from pipeline variant configs`);
  }
}

// Test fixture configs (always overwrite to keep runtime in sync with source)
const testFixturesDir = join(tempDir, "minds/templates/test-fixtures");
if (existsSync(testFixturesDir)) {
  execSync(
    `find "${testFixturesDir}" -name "*.json" -exec cp {} "${join(repoRoot, ".collab/config/test-fixtures/")}" \\;`,
    { shell: true }
  );
  console.log("Test fixture configs installed");
} else {
  console.log("  Warning: minds/templates/test-fixtures not found in source — skipping");
}

// Default command configs (scaffold only — skip if user has customized)
const commandConfigs = [
  { src: "minds/templates/defaults/run-tests.json", dest: ".collab/config/run-tests.json" },
  { src: "minds/templates/defaults/visual-verify.json", dest: ".collab/config/visual-verify.json" },
  { src: "minds/templates/defaults/deploy-verify.json", dest: ".collab/config/deploy-verify.json" },
];
let configScaffoldCount = 0;
for (const cfg of commandConfigs) {
  const destPath = join(repoRoot, cfg.dest);
  const srcPath = join(tempDir, cfg.src);
  if (!existsSync(destPath) && existsSync(srcPath)) {
    copyFileSync(srcPath, destPath);
    configScaffoldCount++;
  }
}
if (configScaffoldCount > 0) {
  console.log(`Command configs scaffolded: ${configScaffoldCount} defaults installed`);
}

console.log("Runtime files installed");

// ── 7. Initialize state ───────────────────────────────────────────────────────

const statePath = join(repoRoot, ".collab/state/installed-pipelines.json");
if (!existsSync(statePath)) {
  writeFileSync(statePath, JSON.stringify({ version: '1', installedAt: new Date().toISOString(), pipelines: {}, clis: {} }, null, 2));
  console.log("State initialized: .collab/state/installed-pipelines.json");
} else {
  console.log("State file exists — preserving");
}

// Merge-on-install: .claude/settings.json (merge collab keys, preserve user keys)
const settingsPath = join(repoRoot, ".claude/settings.json");
const settingsSrc = join(tempDir, "src/claude-settings.json");
if (existsSync(settingsSrc)) {
  const collabSettings = JSON.parse(readFileSync(settingsSrc, "utf8"));
  const existing = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8"))
    : {};
  // Deep-merge: collab keys win, but preserve user keys not in collab template
  const merged = { ...existing, ...collabSettings };
  // Deep-merge hooks: combine arrays rather than replace
  if (existing.hooks && collabSettings.hooks) {
    merged.hooks = { ...existing.hooks };
    for (const [event, hooks] of Object.entries(collabSettings.hooks as Record<string, unknown[]>)) {
      merged.hooks[event] = hooks; // collab hooks replace per-event (they're canonical)
    }
  }
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  console.log("Settings merged: .claude/settings.json");
}

// Auto-update installed packs so reinstalls pull latest versions from the registry
// Skip when COLLAB_SKIP_UPDATE=1 (testing — avoids network calls in unit tests)
const installedPipelinesPath = join(repoRoot, ".collab/state/installed-pipelines.json");
if (!process.env.COLLAB_SKIP_UPDATE && existsSync(installedPipelinesPath)) {
  try {
    const pipelinesState = JSON.parse(readFileSync(installedPipelinesPath, "utf-8"));
    const hasPipelines = Object.keys(pipelinesState.pipelines ?? {}).length > 0;
    if (hasPipelines) {
      const collabBin = join(repoRoot, ".collab/bin/collab");
      if (existsSync(collabBin)) {
        execSync(`"${collabBin}" pipelines update --yes`, {
          cwd: repoRoot,
          stdio: "inherit",
          shell: true,
          timeout: 30000, // 30s max to prevent hanging on slow networks
        });
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  Warning: pack update check failed: ${msg}`);
  }
}

// Preserve-on-install: constitution (only write if absent)
const constitutionPath = join(repoRoot, ".collab/memory/constitution.md");
if (!existsSync(constitutionPath)) {
  const constitutionSrcs = [
    join(tempDir, ".specify/templates/constitution-template.md"),
    join(tempDir, "minds/templates/constitution-template.md"),
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

// ── Generate Mind registry (.collab/minds.json) ─────────────────────────────
// Discovers all Minds from the collab source and writes a registry file so that
// collab.tasks and collab.implement can assign @mind tags and filter by Mind scope.

const mindsJsonDest = join(repoRoot, ".collab/minds.json");
try {
  const genScript = join(tempDir, "minds/generate-registry.ts");
  if (existsSync(genScript)) {
    execSync(`bun "${genScript}"`, {
      cwd: tempDir,
      stdio: "pipe",
      timeout: 60000,
    });
    const generatedPath = join(tempDir, ".collab/minds.json");
    if (existsSync(generatedPath)) {
      copyFileSync(generatedPath, mindsJsonDest);
      console.log("Mind registry generated: .collab/minds.json");
    }
  } else {
    console.log("  minds/generate-registry.ts not found — skipping mind registry");
  }
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`  Warning: minds.json generation skipped: ${msg}`);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

if (!localPath) {
  try {
    execSync(`rm -rf "${tempDir}"`, { shell: true });
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
