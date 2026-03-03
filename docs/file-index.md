# File Index

**Last verified**: 2026-02-21
**Total files**: 167 (excluding node_modules, .git, dist, bun.lock, .DS_Store)

## How to Use This Index

Search by tag to find files related to a concept. Each entry has:
- **Path**: Relative path from repo root
- **Responsibility**: What this file does (1 sentence)
- **Subsystem**: Which part of collab it belongs to
- **Tags**: Searchable keywords

---

## Index by Directory

### Root

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `CLAUDE.md` | Auto-generated development guidelines merged from all feature plans | config | claude, guidelines, auto-generated |
| `README.md` | Top-level project description covering the original "Relay" Slack-first spec platform vision | docs | readme, relay, overview, slack |
| `architecture.md` | Three-layer pipeline architecture documentation (Declarative / Execution / Judgment) | docs | architecture, pipeline, layers, design |
| `KNOWN-ISSUES.md` | Tracked issues from end-to-end validation runs with severity and status | docs | issues, bugs, validation, known-issues |
| `package.json` | Root Node.js package definition with Express server dependencies and scripts | build | npm, dependencies, express, drizzle |
| `package-lock.json` | NPM dependency lockfile for deterministic installs | build | npm, lockfile |
| `tsconfig.json` | Root TypeScript compiler configuration targeting ES2022 | build | typescript, compiler, config |
| `vitest.config.ts` | Root Vitest test runner configuration with V8 coverage | tests | vitest, testing, coverage |
| `drizzle.config.ts` | Drizzle Kit configuration for PostgreSQL schema migrations | db | drizzle, migrations, database, config |
| `.env.example` | Example environment variables for server, database, Slack, and OpenRouter | config | env, environment, secrets, example |
| `.eslintrc.json` | ESLint configuration with TypeScript parser | build | eslint, linting, code-style |
| `.gitignore` | Git ignore rules including .claude/, .collab/, specs/ as local-only directories | config | git, ignore |

---

### scripts/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `scripts/install.sh` | Legacy local install script that copies from src/ to .claude/ within the collab repo itself | build | install, legacy, local, copy |

---

### src/commands/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/commands/collab.run.md` | Orchestrator command: spawns tmux agents, drives the full 7-phase pipeline by processing signals | orchestrator | orchestrator, pipeline, tmux, signals, run |
| `src/commands/collab.specify.md` | Specification creation command: extracts Linear ticket, creates feature branch/worktree, generates spec.md | workflow | specify, spec, linear, feature-creation |
| `src/commands/collab.clarify.md` | Clarification command: detects and reduces spec ambiguity using AskUserQuestion for orchestrator compat | workflow | clarify, ambiguity, questions, signals |
| `src/commands/collab.plan.md` | Planning command: generates implementation plan from spec using plan template | workflow | plan, implementation, design |
| `src/commands/collab.tasks.md` | Task generation command: breaks plan into dependency-ordered tasks.md | workflow | tasks, task-generation, dependencies |
| `src/commands/collab.analyze.md` | Analysis command: cross-artifact consistency check across spec/plan/tasks with severity ratings | workflow | analyze, consistency, quality, severity |
| `src/commands/collab.implement.md` | Implementation command: executes all tasks from tasks.md with verify-and-complete signal emission | workflow | implement, execution, tasks, tdd |
| `src/commands/collab.blindqa.md` | Blind QA command: adversarial verification with zero implementation context, retry loop | workflow | blindqa, verification, adversarial, qa |
| `src/commands/collab.checklist.md` | Checklist generation command: creates "unit tests for English" requirement quality checklists | workflow | checklist, requirements, quality |
| `src/commands/collab.constitution.md` | Constitution command: creates/updates project principles template with placeholder token filling | workflow | constitution, principles, governance |
| `src/commands/collab.spec-critique.md` | Spec critique command: adversarial spec analysis to find gaps before implementation | workflow | spec-critique, adversarial, pre-implementation |
| `src/commands/collab.taskstoissues.md` | Task-to-issues command: converts tasks.md entries into GitHub issues with dependencies | workflow | tasks, github-issues, conversion |
| `src/commands/collab.cleanup.md` | Cleanup command: removes branch/worktree, tmux pane, registry, and spec directories | workflow | cleanup, branch, worktree, teardown |
| `src/commands/collab.install.md` | Install command (markdown instructions): describes how to install collab from GitHub into any repo | build | install, distribution, github |
| `src/commands/collab.install.ts` | Install command (TypeScript): clones collab from GitHub, copies all files to target repo's .claude/.collab/.specify/ | build | install, distribution, github, typescript |

---

### src/scripts/orchestrator/

Bash scripts (Layer 2 execution interpreters):

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/scripts/orchestrator/orchestrator-init.sh` | Validates pipeline schema, resolves worktree, spawns agent pane, creates registry entry | orchestrator | init, schema-validation, tmux, registry, spawn |
| `src/scripts/orchestrator/phase-dispatch.sh` | Reads phase command from pipeline.json, checks coordination holds, sends command to agent pane | orchestrator | dispatch, phase, coordination, tmux |
| `src/scripts/orchestrator/transition-resolve.sh` | Looks up matching transition row for (phase, signal) pair in pipeline.json | orchestrator | transition, signal, lookup, routing |
| `src/scripts/orchestrator/signal-validate.sh` | Parses and validates signal strings against registry (nonce, phase correctness) | orchestrator | signal, validation, nonce, parsing |
| `src/scripts/orchestrator/registry-read.sh` | Reads and outputs JSON registry for a given ticket ID | orchestrator | registry, read, json, state |
| `src/scripts/orchestrator/registry-update.sh` | Applies atomic field=value updates to ticket registry files (tmp + mv pattern) | orchestrator | registry, update, atomic-write, state |
| `src/scripts/orchestrator/phase-advance.sh` | Determines next phase in sequence from pipeline.json (pure function, no side effects) | orchestrator | phase, advance, sequence, next |
| `src/scripts/orchestrator/status-table.sh` | Scans all registries and renders formatted ASCII status table | orchestrator | status, display, table, monitoring |
| `src/scripts/orchestrator/goal-gate-check.sh` | Verifies goal_gate requirements before terminal phase advance (always/if_triggered) | orchestrator | goal-gate, terminal, verification, blindqa |
| `src/scripts/orchestrator/held-release-scan.sh` | Scans registries for held agents and releases those with satisfied dependencies | orchestrator | held, release, coordination, dependencies |
| `src/scripts/orchestrator/coordination-check.sh` | Validates coordination.json files for circular dependencies and unknown ticket references | orchestrator | coordination, validation, cycles, references |
| `src/scripts/orchestrator/group-manage.sh` | Creates and manages coordination groups linking multiple tickets for synchronized operations | orchestrator | groups, coordination, multi-ticket, deploy-gate |

TypeScript equivalents (Bash-to-TS conversion):

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/scripts/orchestrator/Tmux.ts` | Tmux interaction CLI: send-keys, capture-pane, split, list, pane-exists | orchestrator | tmux, cli, automation, pane |
| `src/scripts/orchestrator/orchestrator-utils.ts` | Shared utilities for repo root detection, JSON file I/O, and registry paths | orchestrator | utils, shared, repo-root, json |
| `src/scripts/orchestrator/goal-gate-check.ts` | TypeScript implementation of goal gate checking logic (exportable, testable functions) | orchestrator | goal-gate, typescript, testable |
| `src/scripts/orchestrator/signal-validate.ts` | TypeScript implementation of signal parsing and validation | orchestrator | signal, validation, typescript, testable |
| `src/scripts/orchestrator/transition-resolve.ts` | TypeScript implementation of transition resolution lookup | orchestrator | transition, typescript, testable |
| `src/scripts/orchestrator/registry-update.ts` | TypeScript implementation of atomic registry updates with phase_history append | orchestrator | registry, update, typescript, testable |
| `src/scripts/orchestrator/held-release-scan.ts` | TypeScript implementation of held agent release scanning | orchestrator | held, release, typescript, testable |

TypeScript tests:

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/scripts/orchestrator/goal-gate-check.test.ts` | Unit tests for goal gate checking logic | tests | goal-gate, unit-test, bun-test |
| `src/scripts/orchestrator/signal-validate.test.ts` | Unit tests for signal parsing and validation | tests | signal, validation, unit-test, bun-test |
| `src/scripts/orchestrator/transition-resolve.test.ts` | Unit tests for transition resolution | tests | transition, unit-test, bun-test |
| `src/scripts/orchestrator/registry-update.test.ts` | Unit tests for registry update operations | tests | registry, update, unit-test, bun-test |
| `src/scripts/orchestrator/held-release-scan.test.ts` | Unit tests for held agent release scanning | tests | held, release, unit-test, bun-test |

---

### src/scripts/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/scripts/verify-and-complete.sh` | Verifies phase completion (tasks done, tests pass) and emits completion signal to orchestrator | orchestrator | verify, complete, signal, phase-end |
| `src/scripts/webhook-notify.ts` | Sends phase change notifications to OpenClaw webhook (forwards to Discord) | orchestrator | webhook, notification, discord, openclaw |

---

### src/handlers/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/handlers/pipeline-signal.ts` | Shared signal utilities: signal building, registry lookup, nonce matching, phase-to-signal mapping | handlers | signal, shared, utilities, nonce |
| `src/handlers/emit-question-signal.ts` | Emits CLARIFY_QUESTION and CLARIFY_COMPLETE signals deterministically (replaces hook dependency) | handlers | clarify, signal, emission, deterministic |
| `src/handlers/emit-blindqa-signal.ts` | Emits BLINDQA_* signals (start, pass, fail) deterministically | handlers | blindqa, signal, emission, deterministic |
| `src/handlers/emit-spec-critique-signal.ts` | Emits SPEC_CRITIQUE_* signals (start, pass, warn, fail) deterministically | handlers | spec-critique, signal, emission, deterministic |
| `src/handlers/resolve-tokens.ts` | Pipeline v3 token expression resolver: substitutes {{TICKET_ID}}, {{PHASE}}, etc. in templates | handlers | tokens, templates, resolution, pipeline-v3 |

---

### src/hooks/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/hooks/question-signal.hook.ts` | PreToolUse:AskUserQuestion hook that emits PHASE_QUESTION signal to orchestrator pane | handlers | hook, question, pretooluse, signal |

---

### src/config/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/config/pipeline.json` | Declarative pipeline definition: 7 phases, transitions, gates, goal gates (v3 schema) | config | pipeline, phases, transitions, gates, v3 |
| `src/config/pipeline.v3.schema.json` | JSON Schema for pipeline.json v3 format (validated at orchestrator startup) | config | schema, validation, pipeline, v3 |
| `src/config/coordination.schema.json` | JSON Schema for per-ticket coordination.json (wait_for dependency declarations) | config | schema, coordination, dependencies |
| `src/config/verify-config.json` | Test command configuration for verify phase (command, timeout, working_dir) | config | verify, test-command, timeout |
| `src/config/verify-patterns.json` | Test output patterns for verify phase (currently empty array) | config | verify, patterns, test-output |
| `src/config/gates/plan.md` | Gate prompt template for plan review: evaluates plan against spec requirements | config | gate, plan-review, prompt, template |
| `src/config/gates/plan-review-prompt.md` | Plan review gate prompt with evaluation criteria (requirements coverage, data model, AC alignment) | config | gate, plan-review, criteria |
| `src/config/gates/analyze.md` | Gate prompt template for analyze review: evaluates analysis findings for remediation | config | gate, analyze-review, prompt, template |
| `src/config/gates/analyze-review-prompt.md` | Analyze review gate prompt with remediation/escalation response options | config | gate, analyze-review, remediation |
| `src/config/displays/blindqa-header.md` | Display template for BlindQA phase header shown to orchestrator | config | display, blindqa, header, template |
| `src/config/orchestrator-contexts/blindqa.md` | Orchestrator behavioral context for BlindQA: skeptical overseer mode rules | config | context, blindqa, skeptical, behavioral |

---

### src/db/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/db/schema.ts` | Drizzle ORM schema: 7 tables (specs, channels, spec_roles, role_members, questions, answers, sessions) with relations | db | schema, drizzle, tables, relations, postgresql |
| `src/db/index.ts` | Database client setup: Drizzle ORM + pg Pool connection with DATABASE_URL | db | client, connection, pool, drizzle |

---

### src/routes/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/routes/middleware.ts` | Express middleware: request ID generation, global error handler for AppError subclasses | server | middleware, error-handling, request-id |
| `src/routes/specfactory.ts` | SpecFactory API route handlers: start session, analyze description, channel names, QA flow | server | routes, api, specfactory, workflow |
| `src/routes/spec.ts` | Spec viewing API routes: GET /api/spec/:id with format parameter | server | routes, api, spec, viewing |

---

### src/services/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/services/spec.ts` | Spec service: creation, state transitions, content generation (Drizzle ORM queries) | server | service, spec, lifecycle, drizzle |
| `src/services/session.ts` | Session service: workflow session state management with 24-hour expiry | server | service, session, state, expiry |
| `src/services/question.ts` | Question service: manages Blind QA questions (create, count, list with answers) | server | service, question, blindqa, drizzle |
| `src/services/answer.ts` | Answer service: manages Blind QA answer submissions with validation | server | service, answer, submission, validation |
| `src/services/blind-qa.ts` | Blind QA orchestrator: manages question generation loop and completion detection | server | service, blindqa, orchestration, loop |
| `src/services/channel.ts` | Channel service: manages Slack channels and DB records (supports skipSlack mode for CLI) | server | service, channel, slack, database |
| `src/services/role.ts` | Role service: manages team roles and member assignments | server | service, role, team, members |
| `src/services/llm.ts` | LLM service: OpenRouter integration with Claude Sonnet for analysis, channel names, questions, specs | server | service, llm, openrouter, claude, ai |
| `src/services/spec-generator.ts` | Spec generation service: creates formatted specification documents from Q&A pairs | server | service, spec, generation, markdown |
| `src/services/session-cleanup.ts` | Session cleanup: periodic job to abandon expired sessions and transition their specs | server | service, cleanup, expiry, scheduled |

---

### src/lib/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/lib/errors.ts` | Custom error classes: AppError, NotFoundError, ValidationError, ConflictError, LLMError with error codes | server | errors, classes, error-codes, http |
| `src/lib/validation.ts` | Input validation helpers: UUID, description length, Slack channel name, option index | server | validation, uuid, input, sanitization |
| `src/lib/markdown.ts` | Markdown to HTML conversion utility using marked library | server | markdown, html, conversion |
| `src/lib/slack-retry.ts` | Slack API retry logic with exponential backoff (3 attempts, 2x multiplier) | server | retry, backoff, slack, resilience |

---

### src/plugins/slack/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/plugins/slack/client.ts` | Slack Bolt app initialization with Socket Mode for development | server | slack, bolt, client, socket-mode |
| `src/plugins/slack/blocks.ts` | Block Kit message builders for Slack UI modals, questions, channel selection | server | slack, block-kit, ui, modals |
| `src/plugins/slack/commands.ts` | Slack slash command handler for /specfactory command | server | slack, slash-command, handler |
| `src/plugins/slack/interactions.ts` | Slack interactive component handlers: modals, button actions, answer submissions | server | slack, interactions, modals, buttons |

---

### src/plugins/ (Empty)

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/plugins/jira/` | Empty placeholder directory for future Jira ticketing plugin | server | jira, placeholder, empty |
| `src/plugins/linear/` | Empty placeholder directory for future Linear ticketing plugin | server | linear, placeholder, empty |

---

### src/index.ts

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/index.ts` | Express server entrypoint: plugin type resolution, conditional Slack import, route mounting | server | entrypoint, express, server, startup |

---

### src/skills/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/skills/BlindQA/SKILL.md` | BlindQA skill definition: adversarial blind verification with workflow routing | skills | blindqa, skill, adversarial |
| `src/skills/BlindQA/BlindQAPrinciples.md` | BlindQA principles: core tenets for adversarial verification approach | skills | blindqa, principles, adversarial |
| `src/skills/BlindQA/Workflows/BlindVerify.md` | BlindVerify workflow: step-by-step blind verification execution | skills | blindqa, workflow, verify |
| `src/skills/SpecCreator/SKILL.md` | SpecCreator skill definition: Linear ticket spec creation and enhancement system | skills | spec-creator, skill, linear |
| `src/skills/SpecCreator/Workflows/Create.md` | Create workflow: new specification creation from Linear ticket | skills | spec-creator, workflow, create |
| `src/skills/SpecCreator/Workflows/Update.md` | Update workflow: enhance existing Linear ticket specification | skills | spec-creator, workflow, update |
| `src/skills/SpecCritique/SKILL.md` | SpecCritique skill definition: adversarial spec analysis before implementation | skills | spec-critique, skill, adversarial |
| `src/skills/SpecCritique/Workflows/Critique.md` | Critique workflow: step-by-step spec analysis execution | skills | spec-critique, workflow, critique |

---

### src/.specify/scripts/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/.specify/scripts/create-new-feature.ts` | Creates feature branch/worktree with spec directory structure and metadata.json | workflow | feature-creation, branch, worktree, metadata |
| `src/.specify/scripts/create-new-feature.test.ts` | Tests for ticket ID extraction regex patterns and feature creation (replaces test-ticket-extraction.sh) | tests | ticket-id, extraction, regex, bun-test |

---

### src/config/ (additional)

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/claude-settings.json` | Empty JSON object template for .claude/settings.json initialization | config | claude, settings, template |

---

### src/README.md

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `src/README.md` | Source directory documentation (uses legacy "relay." command naming, partially outdated) | docs | readme, source, structure |

---

### cli/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `cli/package.json` | CLI package definition: @collab/specfactory-cli with commander, clack/prompts deps | cli | npm, package, dependencies |
| `cli/README.md` | CLI readme: quickstart, installation, usage examples | cli | readme, docs, quickstart |
| `cli/tsconfig.json` | CLI TypeScript config targeting NodeNext module resolution | cli | typescript, config |
| `cli/vitest.config.ts` | CLI Vitest config with 30s timeout and thread pool | cli | vitest, testing, config |
| `cli/src/index.ts` | CLI entrypoint: Commander setup with flags, main workflow orchestration, SIGINT handling | cli | entrypoint, commander, flags, workflow |
| `cli/src/client.ts` | HTTP client for SpecFactory backend API with retry, timeouts, error formatting | cli | client, http, retry, api |
| `cli/src/output.ts` | JSON envelope formatter for structured CLI output (success/error/meta) | cli | output, json, envelope, formatting |
| `cli/src/prompts.ts` | Terminal prompts using @clack/prompts: description input, channel selection, QA questions | cli | prompts, terminal, clack, interactive |
| `cli/src/retry.ts` | Exponential backoff retry logic for transient HTTP errors (429, 5xx, ECONNREFUSED) | cli | retry, backoff, http, resilience |
| `cli/src/session.ts` | Session ID generation: cli-{username}-{epoch_seconds} format | cli | session, id, generation |

---

### cli/tests/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `cli/tests/contract/analyze.test.ts` | Contract test: analyzeDescription API endpoint | tests | contract, analyze, api |
| `cli/tests/contract/channel-names.test.ts` | Contract test: getChannelNames API endpoint | tests | contract, channel, api |
| `cli/tests/contract/channel-select.test.ts` | Contract test: selectChannel API endpoint | tests | contract, channel-select, api |
| `cli/tests/contract/questions-answer.test.ts` | Contract test: submitAnswer API endpoint | tests | contract, answer, api |
| `cli/tests/contract/questions-next.test.ts` | Contract test: getNextQuestion API endpoint | tests | contract, question, api |
| `cli/tests/contract/start-session.test.ts` | Contract test: startSession API endpoint | tests | contract, session, api |
| `cli/tests/unit/client.test.ts` | Unit test: HTTP client methods and error handling | tests | unit, client, http |
| `cli/tests/unit/output.test.ts` | Unit test: JSON envelope formatter | tests | unit, output, json |
| `cli/tests/unit/prompts.test.ts` | Unit test: terminal prompt functions | tests | unit, prompts, terminal |
| `cli/tests/unit/retry.test.ts` | Unit test: exponential backoff retry logic | tests | unit, retry, backoff |
| `cli/tests/unit/session.test.ts` | Unit test: session ID generation | tests | unit, session, id |

---

### collab/attractor/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `collab/attractor/main.go` | Attractor entrypoint: flag parsing, stdin/pipe input modes, signal processing loop | attractor | main, entrypoint, go, signal-loop |
| `collab/attractor/go.mod` | Go module definition: github.com/bretthamlin/collab/attractor (Go 1.22, zero external deps) | attractor | go-mod, module, dependencies |
| `collab/attractor/README.md` | Attractor readme: build, test, run instructions, no-API-call verification | attractor | readme, docs, build |
| `collab/attractor/signal_bridge.go` | Signal parser: regex-based wire format parsing ([SIGNAL:ID:NONCE] TYPE \| DETAIL) | attractor | signal, parser, regex, bridge |
| `collab/attractor/signal_bridge_test.go` | Tests for signal parsing | attractor | test, signal, parsing |
| `collab/attractor/dotgen.go` | DOT graph generator: creates Graphviz DOT from pipeline.json for visualization | attractor | dot, graph, visualization, graphviz |
| `collab/attractor/dotgen_test.go` | Tests for DOT graph generation | attractor | test, dot, graph |
| `collab/attractor/integration_test.go` | Integration tests for full signal processing pipeline | attractor | test, integration, pipeline |

---

### collab/attractor/engine/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `collab/attractor/engine/types.go` | Core types: CollabSignal, Handler interface, Outcome, Status enum | attractor | types, interface, handler, signal |
| `collab/attractor/engine/engine.go` | ExecutionEngine: handler registration, dispatch, pass-through routing | attractor | engine, dispatch, routing, handlers |
| `collab/attractor/engine/engine_test.go` | Tests for execution engine | attractor | test, engine, dispatch |

---

### collab/attractor/handlers/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `collab/attractor/handlers/registry.go` | RegisterAll: wires all signal-type to handler mappings and pass-through routes | attractor | registry, wiring, handlers, setup |
| `collab/attractor/handlers/ai_gate.go` | AIGateHandler: assembles review prompts and forwards to orchestrator pane | attractor | ai-gate, review, prompt, handler |
| `collab/attractor/handlers/ai_gate_test.go` | Tests for AI gate handler | attractor | test, ai-gate |
| `collab/attractor/handlers/verify.go` | VerifyHandler: runs test command, parses output, reports pass/fail | attractor | verify, test-command, handler |
| `collab/attractor/handlers/verify_test.go` | Tests for verify handler | attractor | test, verify |
| `collab/attractor/handlers/deployment.go` | DeploymentHandler: triggers deployment with retry logic (max 3 retries) | attractor | deployment, retry, handler |
| `collab/attractor/handlers/deployment_test.go` | Tests for deployment handler | attractor | test, deployment |
| `collab/attractor/handlers/group_manager.go` | GroupManagerHandler: coordinates grouped tickets for synchronized operations | attractor | group, coordination, handler |

---

### collab/attractor/internal/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `collab/attractor/internal/registry/registry.go` | Registry data type: mirrors pipeline-registry JSON schema with read/write operations | attractor | registry, types, json, state |
| `collab/attractor/internal/runner/runner.go` | Commander interface: abstracts shell subprocess execution for testability (ExecCommander prod impl) | attractor | runner, commander, subprocess, testability |

---

### drizzle/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `drizzle/0000_smart_doctor_doom.sql` | Initial database migration: creates all 7 tables, enums, indexes, and foreign keys | db | migration, sql, initial, tables |
| `drizzle/meta/_journal.json` | Drizzle migration journal tracking applied migrations | db | migration, journal, meta |
| `drizzle/meta/0000_snapshot.json` | Drizzle schema snapshot for migration diffing | db | migration, snapshot, meta |

---

### tests/fixtures/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `tests/fixtures/goal-gate-block.json` | Test fixture: FR-005/SC-006 goal gate blocking and satisfaction scenarios | tests | fixture, goal-gate, scenarios |
| `tests/fixtures/transitions/conditional-priority.json` | Test fixture: FR-014 conditional transition row priority evaluation | tests | fixture, transitions, conditional |
| `tests/fixtures/integration/pipeline.test.json` | Test fixture: SC-003 synthetic 3-phase pipeline integration test | tests | fixture, integration, pipeline |
| `tests/fixtures/integration/coordination-test/scenario.json` | Test fixture: SC-004 two-ticket coordination (FREE/HELD) release scenario | tests | fixture, coordination, held, release |
| `tests/fixtures/integration/coordination-test/HELD/coordination.json` | Test fixture: coordination.json for HELD ticket (wait_for FREE:implement) | tests | fixture, coordination, dependency |

---

### specs/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `specs/WORKFLOW-DECISIONS.md` | Design decision record for Relay workflow ambiguity resolutions | docs | decisions, workflow, design-record |
| `specs/001-pm-workflow-slack/spec.md` | Feature spec: PM Workflow Slack integration | docs | spec, pm-workflow, slack |
| `specs/001-pm-workflow-slack/plan.md` | Implementation plan for PM Workflow Slack | docs | plan, pm-workflow |
| `specs/001-pm-workflow-slack/tasks.md` | Task list for PM Workflow Slack | docs | tasks, pm-workflow |
| `specs/001-pm-workflow-slack/data-model.md` | Data model for PM Workflow Slack | docs | data-model, pm-workflow |
| `specs/001-pm-workflow-slack/research.md` | Research notes for PM Workflow Slack | docs | research, pm-workflow |
| `specs/001-pm-workflow-slack/quickstart.md` | Quickstart guide for PM Workflow Slack | docs | quickstart, pm-workflow |
| `specs/001-pm-workflow-slack/checklists/requirements.md` | Requirements checklist for PM Workflow Slack | docs | checklist, pm-workflow |
| `specs/001-pm-workflow-slack/contracts/specfactory-api.yaml` | API contract for SpecFactory endpoints | docs | contract, api, openapi |
| `specs/001-specfactory-cli/spec.md` | Feature spec: SpecFactory CLI plugin | docs | spec, cli, specfactory |
| `specs/001-specfactory-cli/plan.md` | Implementation plan for SpecFactory CLI | docs | plan, cli |
| `specs/001-specfactory-cli/tasks.md` | Task list for SpecFactory CLI | docs | tasks, cli |
| `specs/001-specfactory-cli/data-model.md` | Data model for SpecFactory CLI | docs | data-model, cli |
| `specs/001-specfactory-cli/research.md` | Research notes for SpecFactory CLI | docs | research, cli |
| `specs/001-specfactory-cli/quickstart.md` | Quickstart guide for SpecFactory CLI | docs | quickstart, cli |
| `specs/001-specfactory-cli/checklists/requirements.md` | Requirements checklist for SpecFactory CLI | docs | checklist, cli |
| `specs/001-specfactory-cli/contracts/specfactory-api.yaml` | API contract for SpecFactory CLI endpoints | docs | contract, api |
| `specs/002-living-spec-workflow/spec.md` | Feature spec: Living Spec Workflow (multi-phase team workflow) | docs | spec, living-spec, multi-phase |
| `specs/001-attractor-ai-gates/metadata.json` | Feature metadata: BRE-216, worktree path, branch, creation date | docs | metadata, attractor, bre-216 |
| `specs/001-pattern-analyzer/metadata.json` | Feature metadata: BRE-202, worktree path, branch, creation date | docs | metadata, pattern-analyzer, bre-202 |
| `specs/001-pattern-analyzer-cli/metadata.json` | Feature metadata: BRE-202, worktree path, branch, creation date | docs | metadata, pattern-analyzer-cli, bre-202 |
| `specs/001-pipeline-v3-schema/metadata.json` | Feature metadata: BRE-228, worktree path, branch, creation date | docs | metadata, pipeline-v3, bre-228 |

---

### .specify/templates/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.specify/templates/spec-template.md` | Template for feature specification documents with user scenarios, AC, constraints | templates | template, spec, specification |
| `.specify/templates/plan-template.md` | Template for implementation plans with summary, tech context, phases | templates | template, plan, implementation |
| `.specify/templates/tasks-template.md` | Template for task lists with ID, priority, story grouping format | templates | template, tasks, task-list |
| `.specify/templates/checklist-template.md` | Template for quality checklists ("unit tests for English") | templates | template, checklist, quality |
| `.specify/templates/constitution-template.md` | Template for project constitution with principle placeholders | templates | template, constitution, principles |
| `.specify/templates/agent-file-template.md` | Template for CLAUDE.md agent context file with tech stack, commands, code style | templates | template, agent, claude-md |

---

### .specify/scripts/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.specify/scripts/create-new-feature.ts` | Runtime copy: creates feature branch/worktree (source of truth: src/.specify/) | workflow | feature-creation, runtime-copy |
| `.specify/scripts/bash/check-prerequisites.sh` | Consolidated prerequisite checking: paths, available docs, feature dir (NO src/ equivalent) | workflow | prerequisites, validation, paths |
| `.specify/scripts/bash/common.sh` | Shared functions: repo root detection, branch detection (NO src/ equivalent) | workflow | common, shared, utilities |
| `.specify/scripts/bash/setup-plan.sh` | Plan setup: creates plan.md from template (NO src/ equivalent) | workflow | plan, setup, template |
| `.specify/scripts/bash/update-agent-context.sh` | Agent context updater: parses plan.md and updates agent-specific config files (NO src/ equivalent) | workflow | agent-context, update, plan-parsing |

---

### .collab/config/ (Runtime — deployed by install)

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.collab/config/pipeline.json` | Runtime copy of pipeline v3 configuration | config | pipeline, runtime-copy |
| `.collab/config/pipeline.v3.schema.json` | Runtime copy of v3 schema | config | schema, runtime-copy |
| `.collab/config/coordination.schema.json` | Runtime copy of coordination schema | config | schema, runtime-copy |
| `.collab/config/verify-config.json` | Runtime copy of verify configuration | config | verify, runtime-copy |
| `.collab/config/verify-patterns.json` | Runtime copy of verify patterns (empty) | config | verify, runtime-copy |
| `.collab/config/pipeline.v2.json` | Deprecated v2 pipeline configuration (NO src/ equivalent, dead file) | config | pipeline, v2, deprecated, dead |
| `.collab/config/pipeline.v2.schema.json` | Deprecated v2 pipeline schema (NO src/ equivalent, dead file) | config | schema, v2, deprecated, dead |
| `.collab/config/gates/plan.md` | Runtime copy of plan review gate prompt | config | gate, runtime-copy |
| `.collab/config/gates/plan-review-prompt.md` | Runtime copy of plan review prompt | config | gate, runtime-copy |
| `.collab/config/gates/analyze.md` | Runtime copy of analyze review gate prompt | config | gate, runtime-copy |
| `.collab/config/gates/analyze-review-prompt.md` | Runtime copy of analyze review prompt | config | gate, runtime-copy |
| `.collab/config/displays/blindqa-header.md` | Runtime copy of BlindQA header display | config | display, runtime-copy |
| `.collab/config/orchestrator-contexts/blindqa.md` | Runtime copy of BlindQA orchestrator context | config | context, runtime-copy |

---

### .collab/scripts/ (Runtime — deployed by install)

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.collab/scripts/orchestrator/*.sh` | Runtime copies of all orchestrator bash scripts (12 files) | orchestrator | runtime-copy |
| `.collab/scripts/orchestrator/Tmux.ts` | Runtime copy of Tmux CLI utility | orchestrator | runtime-copy |
| `.collab/scripts/verify-and-complete.sh` | Runtime copy of verify-and-complete script | orchestrator | runtime-copy |
| `.collab/scripts/webhook-notify.ts` | Runtime copy of webhook notification script | orchestrator | runtime-copy |

---

### .collab/handlers/ (Runtime — deployed by install)

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.collab/handlers/*.ts` | Runtime copies of all signal emission handlers (5 files) | handlers | runtime-copy |

---

### .collab/hooks/ (Runtime — deployed by install)

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.collab/hooks/question-signal.hook.ts` | Runtime copy of PreToolUse question signal hook | handlers | runtime-copy, hook |

---

### .collab/state/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.collab/state/pipeline-registry/BRE-QA.json` | Test/debug registry entry with synthetic data (nonce: "testnonc", pane: "%test") | config | state, test-data, registry, debug |

---

### .collab/memory/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.collab/memory/constitution.md` | Project constitution with 6 principles (Source Directory Authority, Script Invocation, etc.) | config | constitution, principles, governance |

---

### .claude/commands/ (Runtime — deployed by install)

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.claude/commands/collab.*.md` | Runtime copies of all 15 command files from src/commands/ | workflow | runtime-copy, commands |
| `.claude/commands/collab.install.ts` | Runtime copy of install TypeScript script | build | runtime-copy, install |

---

### .claude/skills/ (Runtime — deployed by install)

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.claude/skills/BlindQA/` | Runtime copy of BlindQA skill (SKILL.md, BlindQAPrinciples.md, Workflows/) | skills | runtime-copy |
| `.claude/skills/SpecCreator/` | Runtime copy of SpecCreator skill (SKILL.md, Workflows/) | skills | runtime-copy |
| `.claude/skills/SpecCritique/` | Runtime copy of SpecCritique skill (SKILL.md, Workflows/) | skills | runtime-copy |

---

### .claude/settings.json

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `.claude/settings.json` | Empty JSON object for Claude Code settings | config | claude, settings, empty |

---

### docs/

| File | Responsibility | Subsystem | Tags |
|------|---------------|-----------|------|
| `docs/README.md` | Documentation index with progressive disclosure levels (L1-L4) | docs | index, progressive-disclosure |
| `docs/L1-architecture.md` | L1 architecture overview: two systems, three layers, 7 phases, component inventory | docs | architecture, overview, l1 |
