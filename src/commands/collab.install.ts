#!/usr/bin/env bun
// collab.install.ts - Install collab workflow system into current repository
// Description: Install collab workflow system into the current repository from GitHub

import { execSync } from "child_process";
import { existsSync, readdirSync, mkdirSync, copyFileSync, chmodSync, statSync } from "fs";
import { join } from "path";

// Check if we're in a git repository
if (!existsSync(".git")) {
  console.log("ERROR: Not in a git repository. Run this command from the root of your project.");
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

// Support --local <path> to install from a local directory instead of cloning
const localIdx = process.argv.indexOf("--local");
const localPath = localIdx !== -1 ? process.argv[localIdx + 1] : null;

let tempDir: string;
if (localPath) {
  tempDir = join(process.cwd(), localPath).startsWith("/")
    ? localPath
    : join(process.cwd(), localPath);
  // Resolve to absolute path
  try {
    const { execSync: exec2 } = await import("child_process");
    tempDir = exec2(`cd "${localPath}" && pwd`, { encoding: "utf-8" }).trim();
  } catch {
    // If cd fails, use as-is
    tempDir = localPath;
  }
  if (!existsSync(tempDir)) {
    console.log(`ERROR: Local path does not exist: ${tempDir}`);
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
    console.log("ERROR: Failed to clone collab repository");
    process.exit(1);
  }
  console.log("Clone successful");
}

// Create directory structure
console.log("Creating directory structure...");
const dirs = [
  ".claude/commands",
  ".claude/skills",
  ".collab/handlers",
  ".collab/memory",
  ".collab/scripts/orchestrator",
  ".collab/scripts/orchestrator/commands",
  ".collab/transport",
  ".collab/config/pipeline-variants",
  ".collab/state/pipeline-registry",
  ".collab/state/pipeline-groups",
  ".specify/scripts",
  ".specify/templates",
];
for (const d of dirs) {
  mkdirSync(join(repoRoot, d), { recursive: true });
}
console.log("Directories created");

// Copy collab files
console.log("Copying collab files...");

// Copy commands
console.log("  -> Commands...");
execSync(
  `find "${tempDir}/src/commands" -name "*.md" -exec cp {} "${repoRoot}/.claude/commands/" \\;`,
  { shell: true }
);
copyFileSync(
  join(tempDir, "src/commands/collab.install.ts"),
  join(repoRoot, ".claude/commands/collab.install.ts")
);
chmodSync(join(repoRoot, ".claude/commands/collab.install.ts"), 0o755);
const commandCount = readdirSync(join(repoRoot, ".claude/commands"))
  .filter((f) => f.startsWith("collab.") && f.endsWith(".md")).length;

// Copy skills
console.log("  -> Skills...");
let skillCount = 0;
const skillsSrc = join(tempDir, "src/skills");
if (existsSync(skillsSrc)) {
  execSync(`cp -r "${skillsSrc}"/* "${repoRoot}/.claude/skills/"`, { shell: true });
  skillCount = readdirSync(join(repoRoot, ".claude/skills"))
    .filter((f) => {
      try {
        return statSync(join(repoRoot, ".claude/skills", f)).isDirectory();
      } catch { return false; }
    }).length;
} else {
  console.log("  Warning: No skills directory found in source");
}

// Copy handlers
console.log("  -> Handlers...");
execSync(
  `find "${tempDir}/src/handlers" -name "*.ts" -exec cp {} "${repoRoot}/.collab/handlers/" \\;`,
  { shell: true }
);
execSync(
  `find "${repoRoot}/.collab/handlers" -name "*.ts" -exec chmod +x {} \\;`,
  { shell: true }
);
const handlerCount = readdirSync(join(repoRoot, ".collab/handlers"))
  .filter((f) => f.endsWith(".ts")).length;

// Copy orchestrator scripts (preserve commands/ subdirectory structure)
console.log("  -> Orchestrator scripts...");
execSync(
  `cd "${tempDir}/src/scripts/orchestrator" && find . \\( -name "*.sh" -o -name "*.ts" \\) ! -name "*.test.ts" -exec sh -c 'mkdir -p "${repoRoot}/.collab/scripts/orchestrator/$(dirname "$1")" && cp "$1" "${repoRoot}/.collab/scripts/orchestrator/$1"' _ {} \\;`,
  { shell: true }
);
execSync(
  `find "${repoRoot}/.collab/scripts/orchestrator" -name "*.ts" -exec chmod +x {} \\;`,
  { shell: true }
);
const orchestratorScriptCount = execSync(
  `find "${repoRoot}/.collab/scripts/orchestrator" \\( -name "*.sh" -o -name "*.ts" \\) ! -name "*.test.ts" 2>/dev/null | wc -l`,
  { encoding: "utf-8", shell: true }
).trim();

// Copy transport scripts (bus-server, bridges, etc.)
console.log("  -> Transport scripts...");
const transportSrc = join(tempDir, "transport");
if (existsSync(transportSrc)) {
  execSync(
    `find "${transportSrc}" -maxdepth 1 -name "*.ts" ! -name "*.test.ts" -exec cp {} "${repoRoot}/.collab/transport/" \\;`,
    { shell: true }
  );
  execSync(
    `find "${repoRoot}/.collab/transport" -name "*.ts" -exec chmod +x {} \\;`,
    { shell: true }
  );
  console.log("  -> Transport scripts copied");
} else {
  console.log("  Warning: No transport directory found in source");
}

// Copy non-orchestrator collab scripts
console.log("  -> Collab scripts...");
execSync(
  `find "${tempDir}/src/scripts" -maxdepth 1 \\( -name "*.sh" -o -name "*.ts" \\) -exec cp {} "${repoRoot}/.collab/scripts/" \\;`,
  { shell: true }
);
execSync(
  `find "${repoRoot}/.collab/scripts" -maxdepth 1 \\( -name "*.sh" -o -name "*.ts" \\) -exec chmod +x {} \\;`,
  { shell: true }
);

// Install .claude/settings.json (create only if not present)
const settingsPath = join(repoRoot, ".claude/settings.json");
if (!existsSync(settingsPath)) {
  console.log("  -> Claude settings (initializing)...");
  copyFileSync(join(tempDir, "src/claude-settings.json"), settingsPath);
} else {
  console.log("  -> Claude settings (already exists, skipping)");
}

// Copy workflow scripts
console.log("  -> Workflow scripts...");
execSync(`cp -r "${tempDir}/.specify/scripts"/* "${repoRoot}/.specify/scripts/"`, { shell: true });
execSync(
  `find "${repoRoot}/.specify/scripts/bash" -name "*.sh" -exec chmod +x {} \\;`,
  { shell: true }
);
const scriptCount = execSync(
  `find "${repoRoot}/.specify/scripts/bash" -name "*.sh" 2>/dev/null | wc -l`,
  { encoding: "utf-8", shell: true }
).trim();

// Copy templates
console.log("  -> Templates...");
execSync(`cp -r "${tempDir}/.specify/templates"/* "${repoRoot}/.specify/templates/"`, { shell: true });
const templateCount = execSync(
  `find "${repoRoot}/.specify/templates" -name "*.md" 2>/dev/null | wc -l`,
  { encoding: "utf-8", shell: true }
).trim();

// Copy constitution if it doesn't exist
const constitutionPath = join(repoRoot, ".collab/memory/constitution.md");
if (!existsSync(constitutionPath)) {
  console.log("  -> Constitution (initializing)...");
  copyFileSync(
    join(tempDir, ".specify/templates/constitution-template.md"),
    constitutionPath
  );
} else {
  console.log("  -> Constitution (already exists, skipping)");
}

// pipeline.json + v3 schema files
mkdirSync(join(repoRoot, ".collab/config"), { recursive: true });
copyFileSync(
  join(tempDir, "src/config/pipeline.json"),
  join(repoRoot, ".collab/config/pipeline.json")
);
console.log("  -> pipeline.json updated");

// Schema files
execSync(`cp "${tempDir}/src/config/"*.schema.json "${repoRoot}/.collab/config/"`, { shell: true });
console.log("  -> schema files updated");

// Pipeline variant configs
mkdirSync(join(repoRoot, ".collab/config/pipeline-variants"), { recursive: true });
const variantsDir = join(tempDir, "src/config/pipeline-variants");
if (existsSync(variantsDir)) {
  execSync(
    `find "${variantsDir}" -name "*.json" -exec cp {} "${repoRoot}/.collab/config/pipeline-variants/" \\;`,
    { shell: true }
  );
  const variantCount = readdirSync(join(repoRoot, ".collab/config/pipeline-variants"))
    .filter((f) => f.endsWith(".json")).length;
  console.log(`  -> Pipeline variants: ${variantCount} configs`);
} else {
  console.log("  -> Pipeline variants: none found in source");
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
  const srcPath = join(tempDir, cfg.src);
  if (!existsSync(destPath) && existsSync(srcPath)) {
    copyFileSync(srcPath, destPath);
    configScaffoldCount++;
  }
}
if (configScaffoldCount > 0) {
  console.log(`  -> Command configs: ${configScaffoldCount} defaults scaffolded`);
} else {
  console.log("  -> Command configs: already exist, skipping");
}

// Orchestrator contexts
mkdirSync(join(repoRoot, ".collab/config/orchestrator-contexts"), { recursive: true });
execSync(
  `cp -r "${tempDir}/src/config/orchestrator-contexts/"* "${repoRoot}/.collab/config/orchestrator-contexts/"`,
  { shell: true }
);
console.log("  -> orchestrator-contexts updated");

// Display templates
mkdirSync(join(repoRoot, ".collab/config/displays"), { recursive: true });
execSync(
  `cp -r "${tempDir}/src/config/displays/"* "${repoRoot}/.collab/config/displays/"`,
  { shell: true }
);
console.log("  -> displays updated");

// Other config files: skip if present
const verifyConfigPath = join(repoRoot, ".collab/config/verify-config.json");
if (!existsSync(verifyConfigPath)) {
  mkdirSync(join(repoRoot, ".collab/config/gates"), { recursive: true });
  copyFileSync(
    join(tempDir, "src/config/verify-config.json"),
    verifyConfigPath
  );
  copyFileSync(
    join(tempDir, "src/config/verify-patterns.json"),
    join(repoRoot, ".collab/config/verify-patterns.json")
  );
  execSync(
    `cp "${tempDir}/src/config/gates/"*.md "${repoRoot}/.collab/config/gates/"`,
    { shell: true }
  );
  console.log("  -> Config files scaffolded");
} else {
  console.log("  -> Config files already exist, skipping");
}

console.log("Files copied");

// Set permissions
console.log("Setting permissions...");
execSync(
  `find "${repoRoot}/.collab/scripts/orchestrator" -name "*.sh" -exec chmod +x {} \\;`,
  { shell: true }
);
console.log("Permissions set");

// Verify installation
console.log("Verifying installation...");

if (existsSync(join(repoRoot, ".claude/commands/collab.install.md"))) {
  console.log("  collab.install.md present (/collab.install command available)");
}

if (existsSync(join(repoRoot, ".claude/commands/collab.install.ts"))) {
  console.log("  collab.install.ts present (update via: bun .claude/commands/collab.install.ts)");
}

if (existsSync(join(repoRoot, ".claude/commands/collab.specify.md"))) {
  console.log("  Command files present");
}

const skillsDir = join(repoRoot, ".claude/skills");
if (existsSync(skillsDir) && readdirSync(skillsDir).length > 0) {
  console.log("  Skills present");
}

if (existsSync(join(repoRoot, ".collab/handlers/emit-question-signal.ts"))) {
  console.log("  Handlers present");
}

console.log("Verification complete");

// Clean up (skip when --local was used — don't delete the source directory)
if (!localPath) {
  console.log("Cleaning up...");
  try {
    execSync(`rm -rf "${tempDir}"`, { shell: true });
  } catch {
    console.log("  Temp files in /tmp will be auto-cleaned by system");
  }
  console.log("Cleanup complete");
}

// Report installation summary
console.log("");
console.log("Collab installation complete!");
console.log("");
console.log("Installation Summary:");
console.log(`  Commands:       ${commandCount} files -> .claude/commands/`);
console.log(`  Skills:         ${skillCount} dirs -> .claude/skills/`);
console.log(`  Handlers:       ${handlerCount} files -> .collab/handlers/`);
console.log(`  Orchestrator:   ${orchestratorScriptCount} scripts -> .collab/scripts/orchestrator/`);
console.log(`  Workflow:       ${scriptCount} scripts -> .specify/scripts/bash/`);
console.log(`  Templates:      ${templateCount} files -> .specify/templates/`);
console.log(`  Memory:         .collab/memory/constitution.md`);
console.log(`  Config:          .collab/config/verify-config.json, pipeline.json, verify-patterns.json`);
console.log(`  Variants:       pipeline-variants/*.json -> .collab/config/pipeline-variants/`);
console.log(`  Command Cfgs:   ${configScaffoldCount} defaults -> .collab/config/`);
console.log("");
console.log(`Installed in: ${repoRoot}`);
console.log("");
console.log("Available Commands:");
console.log("  /collab.run        - Autonomous full pipeline orchestration");
console.log("  /collab.specify    - Create feature specification");
console.log("  /collab.clarify    - Clarify ambiguities in spec");
console.log("  /collab.plan       - Generate implementation plan");
console.log("  /collab.tasks      - Break plan into tasks");
console.log("  /collab.analyze    - Analyze spec/plan/tasks consistency");
console.log("  /collab.implement  - Execute implementation");
console.log("  /collab.checklist  - Generate quality checklist");
console.log("  /collab.constitution - Manage project principles");
console.log("  /collab.taskstoissues - Convert tasks to GitHub issues");
console.log("  /collab.blindqa    - Blind verification testing");
console.log("  /collab.run-tests      - Execute test suite");
console.log("  /collab.visual-verify  - Visual verification");
console.log("  /collab.verify-execute - Verification checklist execution");
console.log("  /collab.pre-deploy-confirm - Pre-deploy human gate");
console.log("  /collab.deploy-verify  - Post-deploy smoke verification");
console.log("  /collab.cleanup    - Clean up completed feature (branch/worktree)");
console.log("");
console.log("Next Steps:");
console.log("  1. Run /collab.run BRE-XXX for fully autonomous workflow");
console.log("  2. Or run /collab.specify to create feature spec manually");
console.log("  3. Customize .collab/memory/constitution.md for your project");
console.log("");
console.log("To update collab, run: bun .claude/commands/collab.install.ts");
