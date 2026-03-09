import { join } from "path";
import { copyFileSync, mkdirSync } from "fs";

const distDir = join(import.meta.dir, "dist");
mkdirSync(distDir, { recursive: true });

// Step 1: Bundle React app with Bun (outputs index.js and index.css)
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "src/index.tsx")],
  outdir: distDir,
  target: "browser",
  minify: process.env.NODE_ENV === "production",
  naming: {
    entry: "index.[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

// Step 2: Compile Tailwind CSS (overwrites Bun's raw CSS output with compiled Tailwind)
const cssInput = join(import.meta.dir, "src/index.css");
const cssOutput = join(distDir, "index.css");

const tailwind = Bun.spawnSync(["npx", "tailwindcss", "-i", cssInput, "-o", cssOutput, "--minify"], {
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
});

if (tailwind.exitCode !== 0) {
  console.error("Tailwind build failed");
  process.exit(1);
}

// Copy HTML
copyFileSync(
  join(import.meta.dir, "src/index.html"),
  join(distDir, "index.html"),
);

console.log("Build complete:", result.outputs.map((o) => o.path).join(", "), cssOutput);
