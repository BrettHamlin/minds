# BRE-696: Universal E2E Test Pipeline Stage + Installer Scaffolding

## @installer Tasks

- [ ] T001 @installer Add test command entry to CLAUDE_COMMANDS in minds/installer/core.ts
- [ ] T002 @installer Add compare-design command entry to CLAUDE_COMMANDS in minds/installer/core.ts
- [ ] T003 @installer Create scaffoldE2eTests() function in minds/installer/core.ts that creates test directory structure and writes template CLAUDE.md in target repo during init
- [ ] T004 @installer Create CLAUDE.md template content in minds/installer/core.ts with scenario-based format including server startup blanks, mind label table populated from registry, test creation templates, visual comparison instructions
- [ ] T005 @installer [P] Add ensurePlaywrightDep() in minds/installer/core.ts to detect and add playwright test dependency to target repo package.json if missing
- [ ] T006 @installer [P] Add checkBaselineTag() in minds/installer/core.ts to check for v1.0.0 git tag and log suggestion if missing
- [ ] T007 @installer [P] Create empty registry.json in target test directory during scaffoldE2eTests() with mind-to-test-file mapping schema
- [ ] T008 @installer Write tests in minds/installer/__tests__/e2e-scaffolding.test.ts verifying directory creation, CLAUDE.md content, registry.json, playwright detection, command entries

## @commands Tasks (owns: minds/commands/**)

- [ ] T009 @commands Create minds/commands/test.md slash command template with argument parsing for mind filters and visual flag, server startup, test execution via run-tests script, registry lookup, visual comparison, cleanup, structured report output
- [ ] T010 @commands [P] Create minds/commands/compare-design.md slash command template for visual comparison between two URLs or a URL and a local mock file

## @supervisor Tasks (owns: minds/lib/supervisor/**)

- [ ] T011 @supervisor Create E2E test stage executor at minds/lib/supervisor/stages/e2e-tests.ts that reads registry.json for test files, runs each via run-tests script, returns ok with empty findings or error with failure details — produces: executeE2eTests at minds/lib/supervisor/stages/e2e-tests.ts
- [ ] T012 @supervisor Add e2e-tests stage to CODE_PIPELINE in minds/lib/supervisor/pipeline-templates.ts after contract-check and before llm-review
- [ ] T013 @supervisor Register e2e-tests executor in minds/lib/supervisor/stages/index.ts by adding to ALL_EXECUTORS map and re-exporting
- [ ] T014 @supervisor Add e2eTestsPass boolean to check results in minds/lib/supervisor/supervisor-checks.ts populated from E2E test execution output
- [ ] T015 @supervisor [P] Write tests in minds/lib/supervisor/__tests__/e2e-tests-stage.test.ts verifying stage reads registry, runs tests, returns findings on failure, gracefully skips when no registry exists

## Cross-Mind Contracts

| Producer | Interface | Consumer |
|----------|-----------|----------|
| @installer | CLAUDE_COMMANDS entries | (target repo .claude/commands/) |
| @installer | registry.json schema | @supervisor (reads at runtime) |
| @commands | minds/commands/test.md | @installer (copies to target) |
| @commands | minds/commands/compare-design.md | @installer (copies to target) |
| @supervisor | executeE2eTests() | pipeline-templates, stages/index |
