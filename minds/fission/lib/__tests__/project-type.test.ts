/**
 * project-type.test.ts — Tests for project type detection.
 *
 * Each test creates a temp directory with specific marker files
 * and verifies that detectProjectType() returns the correct type.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { detectProjectType } from "../project-type.js";
import type { ProjectType } from "../project-type.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "fission-project-type-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Write a package.json with the given deps/devDeps/fields. */
function writePackageJson(
  opts: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
    main?: string;
    exports?: unknown;
  } = {},
): void {
  writeFileSync(join(tempDir, "package.json"), JSON.stringify(opts, null, 2));
}

/** Create a file at the given relative path (creates parent dirs). */
function touch(relativePath: string, content: string = ""): void {
  const fullPath = join(tempDir, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content);
}

/* ------------------------------------------------------------------ */
/*  Frontend-web detection                                             */
/* ------------------------------------------------------------------ */

describe("frontend-web", () => {
  test("detects React dependency", () => {
    writePackageJson({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } });
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });

  test("detects Vue dependency", () => {
    writePackageJson({ dependencies: { vue: "^3.0.0" } });
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });

  test("detects Next.js dependency", () => {
    writePackageJson({ dependencies: { next: "^14.0.0", react: "^18.0.0" } });
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });

  test("detects Nuxt dependency", () => {
    writePackageJson({ dependencies: { nuxt: "^3.0.0" } });
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });

  test("detects Angular dependency", () => {
    writePackageJson({ dependencies: { "@angular/core": "^17.0.0" } });
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });

  test("detects Svelte dependency", () => {
    writePackageJson({ dependencies: { svelte: "^4.0.0" } });
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });

  test("detects frontend framework in devDependencies", () => {
    writePackageJson({ devDependencies: { svelte: "^4.0.0" } });
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });

  test("detects root index.html", () => {
    touch("index.html", "<html></html>");
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });
});

/* ------------------------------------------------------------------ */
/*  Backend-api detection                                              */
/* ------------------------------------------------------------------ */

describe("backend-api", () => {
  test("detects Express dependency", () => {
    writePackageJson({ dependencies: { express: "^4.0.0" } });
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Fastify dependency", () => {
    writePackageJson({ dependencies: { fastify: "^4.0.0" } });
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Hono dependency", () => {
    writePackageJson({ dependencies: { hono: "^4.0.0" } });
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects NestJS dependency", () => {
    writePackageJson({ dependencies: { "@nestjs/core": "^10.0.0" } });
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Go backend with gin", () => {
    touch("go.mod", "module example.com/myapp\n\nrequire github.com/gin-gonic/gin v1.9.0\n");
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Go backend with net/http import in go.mod", () => {
    // go.mod won't contain net/http (it's stdlib), but source files will.
    // For go.mod-based detection, we check for web framework deps.
    touch("go.mod", "module example.com/myapp\n\nrequire github.com/labstack/echo/v4 v4.11.0\n");
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Rust backend with actix-web", () => {
    touch(
      "Cargo.toml",
      '[package]\nname = "myapp"\nversion = "0.1.0"\n\n[dependencies]\nactix-web = "4"\n',
    );
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Rust backend with axum", () => {
    touch(
      "Cargo.toml",
      '[package]\nname = "myapp"\nversion = "0.1.0"\n\n[dependencies]\naxum = "0.7"\n',
    );
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Python backend with FastAPI", () => {
    touch(
      "pyproject.toml",
      '[project]\nname = "myapp"\ndependencies = ["fastapi>=0.100.0", "uvicorn"]\n',
    );
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Python backend with Django in setup.py", () => {
    touch("setup.py", "from setuptools import setup\nsetup(install_requires=['django>=4.0'])\n");
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Spring Boot in build.gradle", () => {
    touch(
      "build.gradle",
      "plugins {\n  id 'org.springframework.boot' version '3.2.0'\n}\n",
    );
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });

  test("detects Spring Boot in pom.xml", () => {
    touch(
      "pom.xml",
      '<project>\n  <parent>\n    <groupId>org.springframework.boot</groupId>\n  </parent>\n</project>\n',
    );
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });
});

/* ------------------------------------------------------------------ */
/*  iOS detection                                                      */
/* ------------------------------------------------------------------ */

describe("ios-mobile", () => {
  test("detects Package.swift", () => {
    touch("Package.swift", "// swift-tools-version:5.9\n");
    // Package.swift alone could be a library — but for mobile detection,
    // we also check for xcodeproj. Package.swift alone = swift library.
    // We need xcodeproj or xcworkspace for iOS.
    touch("MyApp.xcodeproj/project.pbxproj", "");
    expect(detectProjectType(tempDir)).toBe("ios-mobile");
  });

  test("detects xcworkspace", () => {
    touch("MyApp.xcworkspace/contents.xcworkspacedata", "");
    expect(detectProjectType(tempDir)).toBe("ios-mobile");
  });

  test("detects Podfile", () => {
    touch("Podfile", "platform :ios, '16.0'\n");
    expect(detectProjectType(tempDir)).toBe("ios-mobile");
  });
});

/* ------------------------------------------------------------------ */
/*  Android detection                                                  */
/* ------------------------------------------------------------------ */

describe("android-mobile", () => {
  test("detects Android application plugin in build.gradle", () => {
    touch(
      "build.gradle",
      "apply plugin: 'com.android.application'\n\nandroid {\n  compileSdk 34\n}\n",
    );
    expect(detectProjectType(tempDir)).toBe("android-mobile");
  });

  test("detects Android application plugin in build.gradle.kts", () => {
    touch(
      "build.gradle.kts",
      'plugins {\n  id("com.android.application")\n}\n',
    );
    expect(detectProjectType(tempDir)).toBe("android-mobile");
  });

  test("detects AndroidManifest.xml", () => {
    touch("app/src/main/AndroidManifest.xml", "<manifest/>");
    expect(detectProjectType(tempDir)).toBe("android-mobile");
  });
});

/* ------------------------------------------------------------------ */
/*  CLI detection                                                      */
/* ------------------------------------------------------------------ */

describe("cli", () => {
  test("detects bin field in package.json", () => {
    writePackageJson({ bin: { mycli: "./dist/cli.js" } });
    expect(detectProjectType(tempDir)).toBe("cli");
  });

  test("detects bin field as string in package.json", () => {
    writePackageJson({ bin: "./dist/cli.js" });
    expect(detectProjectType(tempDir)).toBe("cli");
  });

  test("detects Go CLI with cmd/ directory", () => {
    touch("go.mod", "module example.com/mycli\n");
    touch("cmd/mycli/main.go", "package main\n");
    expect(detectProjectType(tempDir)).toBe("cli");
  });

  test("detects Rust CLI with [[bin]] section", () => {
    touch(
      "Cargo.toml",
      '[package]\nname = "mycli"\nversion = "0.1.0"\n\n[[bin]]\nname = "mycli"\npath = "src/main.rs"\n',
    );
    expect(detectProjectType(tempDir)).toBe("cli");
  });
});

/* ------------------------------------------------------------------ */
/*  Library detection                                                  */
/* ------------------------------------------------------------------ */

describe("library", () => {
  test("detects library with main field and no framework deps", () => {
    writePackageJson({
      main: "./dist/index.js",
      dependencies: { lodash: "^4.0.0" },
    });
    expect(detectProjectType(tempDir)).toBe("library");
  });

  test("detects library with exports field", () => {
    writePackageJson({
      exports: { ".": "./dist/index.js" },
    });
    expect(detectProjectType(tempDir)).toBe("library");
  });

  test("detects Rust library with [lib] section", () => {
    touch(
      "Cargo.toml",
      '[package]\nname = "mylib"\nversion = "0.1.0"\n\n[lib]\nname = "mylib"\n',
    );
    expect(detectProjectType(tempDir)).toBe("library");
  });
});

/* ------------------------------------------------------------------ */
/*  Fallback / edge cases                                              */
/* ------------------------------------------------------------------ */

describe("unknown and edge cases", () => {
  test("returns unknown for empty directory", () => {
    expect(detectProjectType(tempDir)).toBe("unknown");
  });

  test("handles malformed package.json gracefully", () => {
    touch("package.json", "this is not valid JSON {{{");
    expect(detectProjectType(tempDir)).toBe("unknown");
  });

  test("frontend takes priority over backend when both deps present", () => {
    // If both react and express are deps, frontend-web wins because
    // it's likely a full-stack app where the package.json is frontend-centric.
    writePackageJson({
      dependencies: { react: "^18.0.0", express: "^4.0.0" },
    });
    expect(detectProjectType(tempDir)).toBe("frontend-web");
  });

  test("cli takes priority over library when both bin and main present", () => {
    writePackageJson({
      bin: { mycli: "./dist/cli.js" },
      main: "./dist/index.js",
    });
    expect(detectProjectType(tempDir)).toBe("cli");
  });

  test("backend-api takes priority over library when server deps present", () => {
    writePackageJson({
      main: "./dist/index.js",
      dependencies: { express: "^4.0.0" },
    });
    expect(detectProjectType(tempDir)).toBe("backend-api");
  });
});
