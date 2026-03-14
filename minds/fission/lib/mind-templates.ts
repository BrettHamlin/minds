/**
 * mind-templates.ts — MIND.md templates for non-code minds (build + verify).
 *
 * BRE-623: Provides project-type-specific instructions for build and verify minds.
 */

import type { ProjectType } from "./project-type.js";

/* ------------------------------------------------------------------ */
/*  Build instructions per project type                                */
/* ------------------------------------------------------------------ */

const BUILD_INSTRUCTIONS: Record<string, string> = {
  "frontend-web": `## Build Commands

- \`npm run build\` — Production build
- \`npm run dev\` — Development server

## Build Artifacts

- \`dist/\` or \`build/\` — Compiled assets
- \`.next/\` — Next.js build output (if applicable)

## Credentials

- \`{{DEPLOY_TOKEN}}\` — Deployment token for CDN/hosting
- \`{{API_BASE_URL}}\` — Backend API endpoint for production builds`,

  "backend-api": `## Build Commands

- \`go build ./...\` — Go build (if Go project)
- \`npm run build\` — TypeScript/Node build (if Node project)
- \`cargo build --release\` — Rust build (if Rust project)
- \`./gradlew build\` — Gradle build (if JVM project)

## Build Artifacts

- \`bin/\` or \`target/\` — Compiled binaries
- \`dist/\` — Transpiled output (Node/TS)

## Credentials

- \`{{DEPLOY_TOKEN}}\` — Deployment token
- \`{{DATABASE_URL}}\` — Production database connection string`,

  "ios-mobile": `## Build Commands

- \`xcodebuild -workspace *.xcworkspace -scheme <scheme> -sdk iphoneos\` — Release build
- \`pod install\` — Install CocoaPods dependencies (if using Podfile)

## Build Artifacts

- \`build/\` — Xcode build products
- \`*.ipa\` — Distributable archive

## Credentials

- \`{{APPLE_SIGNING_IDENTITY}}\` — Code signing identity
- \`{{PROVISIONING_PROFILE}}\` — Provisioning profile UUID`,

  "android-mobile": `## Build Commands

- \`./gradlew assembleRelease\` — Release APK
- \`./gradlew bundleRelease\` — Release AAB (App Bundle)

## Build Artifacts

- \`app/build/outputs/apk/\` — APK files
- \`app/build/outputs/bundle/\` — AAB files

## Credentials

- \`{{KEYSTORE_PATH}}\` — Signing keystore location
- \`{{KEYSTORE_PASSWORD}}\` — Keystore password
- \`{{PLAY_STORE_KEY}}\` — Google Play upload key`,

  "library": `## Build Commands

- \`npm run build\` — TypeScript compilation (if TS library)
- \`cargo build --release\` — Rust build (if Rust crate)
- \`go build ./...\` — Go build (if Go module)

## Build Artifacts

- \`dist/\` — Compiled output
- \`target/release/\` — Rust release binary

## Credentials

- \`{{NPM_TOKEN}}\` — npm publish token (if publishing)
- \`{{CARGO_REGISTRY_TOKEN}}\` — Cargo publish token (if Rust)`,

  "cli": `## Build Commands

- \`npm run build\` — TypeScript compilation (if TS)
- \`go build -o bin/ ./cmd/...\` — Go binary build (if Go)
- \`cargo build --release\` — Rust build (if Rust)

## Build Artifacts

- \`bin/\` — Compiled CLI binaries
- \`dist/\` — Transpiled output

## Credentials

- \`{{NPM_TOKEN}}\` — npm publish token (if publishing to npm)
- \`{{HOMEBREW_TAP_TOKEN}}\` — Homebrew tap token (if distributing via Homebrew)`,
};

/* ------------------------------------------------------------------ */
/*  Verify instructions per project type                               */
/* ------------------------------------------------------------------ */

const VERIFY_INSTRUCTIONS: Record<string, string> = {
  "frontend-web": `## Test Commands

- \`npm test\` — Run unit and integration tests
- \`npm run test:e2e\` — Run end-to-end tests (Playwright/Cypress)
- \`npm run lint\` — Lint check

## Health Check

- Verify dev server responds at \`http://localhost:3000\` (or configured port)
- Verify production build serves correctly

## Credentials

- \`{{TEST_API_KEY}}\` — Test environment API key`,

  "backend-api": `## Test Commands

- \`npm test\` — Run tests (if Node project)
- \`go test ./...\` — Run tests (if Go project)
- \`cargo test\` — Run tests (if Rust project)
- \`./gradlew test\` — Run tests (if JVM project)

## Health Check

- Verify API responds at configured health endpoint
- Verify database connectivity in test environment

## Credentials

- \`{{TEST_DATABASE_URL}}\` — Test database connection string
- \`{{TEST_API_KEY}}\` — Test environment API key`,
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Generate MIND.md content for a build mind, tailored to the project type.
 */
export function buildMindMd(projectType: ProjectType): string {
  const instructions = BUILD_INSTRUCTIONS[projectType] ?? BUILD_INSTRUCTIONS["library"];

  return `# @build Mind Profile

## Domain

Build and deployment for this codebase.

## Pipeline Template

\`build\` — This mind uses the build pipeline template.

## Responsibilities

- Compile, bundle, and package the project for deployment
- Manage build artifacts and output directories
- Handle build-time configuration and environment variables

${instructions}

## Anti-Patterns

- Running tests (that is the verify mind's responsibility)
- Modifying source code (that is a domain mind's responsibility)
- Deploying without a successful build

## Review Focus

- Build completes without errors
- Artifacts are generated in expected locations
- No secrets are embedded in build output
`;
}

/**
 * Generate MIND.md content for a verify mind, tailored to the project type.
 */
export function verifyMindMd(projectType: ProjectType): string {
  const instructions = VERIFY_INSTRUCTIONS[projectType] ?? VERIFY_INSTRUCTIONS["backend-api"];

  return `# @verify Mind Profile

## Domain

Verification and testing for this codebase.

## Pipeline Template

\`test\` — This mind uses the test pipeline template.

## Responsibilities

- Run the full test suite (unit, integration, e2e)
- Verify build artifacts work correctly
- Validate health checks and endpoint availability
- Report test coverage and failures

${instructions}

## Anti-Patterns

- Modifying source code to fix tests (report failures, let domain minds fix)
- Skipping failing tests
- Running builds (that is the build mind's responsibility)

## Review Focus

- All tests pass
- Test coverage meets project standards
- Health checks return expected responses
`;
}
