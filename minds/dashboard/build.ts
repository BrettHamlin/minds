import { join } from "path";
import { copyFileSync, mkdirSync } from "fs";

const distDir = join(import.meta.dir, "dist");
mkdirSync(distDir, { recursive: true });

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

// Copy HTML
copyFileSync(
  join(import.meta.dir, "src/index.html"),
  join(distDir, "index.html"),
);

console.log("Build complete:", result.outputs.map((o) => o.path).join(", "));
