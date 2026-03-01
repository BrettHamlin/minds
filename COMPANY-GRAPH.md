# Collab — Company Graph & Ideal State

> "The system IS the graph of algorithms. AI runs the graph. Industries become use cases within it."
> — Daniel Miessler, "The Great Transition"

Collab is unique: it's both a product that should be structured as a graph AND a tool
that builds graphs for others. When Collab runs a pipeline, it IS Miessler's thesis —
automated, measurable, AI-driven workflows executing a graph of algorithms.

This document defines Collab as a graph of operations with measurable nodes,
an ideal state to continuously migrate toward, and a restructuring plan.

---

## Part 1: The Operations Graph

### Layer 1: Pipeline Execution

The core value chain. Each pipeline run takes a Linear ticket and produces a verified feature branch.

```
Ticket Intake → Clarify → Plan → Plan Review Gate → Tasks → Analyze
       → Analyze Review Gate → Implement → BlindQA → Done
```

#### Node 1.1: Ticket Intake
| Field | Value |
|-------|-------|
| Function | Accept a Linear ticket ID and initialize a pipeline run |
| Inputs | Ticket ID (e.g., BRE-233), pipeline.json config |
| Outputs | Initialized registry, spawned agent pane, validated schema |
| Current | `orchestrator-init.sh` — validates pipeline.json against v3 schema, spawns tmux agent pane, creates registry file |
| Metrics | Init success rate, time to initialize, schema validation errors |
| SOP | `/collab.run <ticket-id>` → validate schema → spawn pane → create registry → dispatch first phase |
| Ideal State | <5s initialization; zero schema validation failures; automatic pipeline.json migration on version bumps |

#### Node 1.2: Clarify Phase
| Field | Value |
|-------|-------|
| Function | Resolve spec ambiguities before any work begins |
| Inputs | Ticket spec (from Linear), `.claude/commands/collab.clarify.md` |
| Outputs | Clarified spec with all ambiguities resolved; `CLARIFY_COMPLETE` signal |
| Current | AI agent reads ticket, identifies ambiguities, asks questions via AskUserQuestion tool. Signal emitted via `emit-clarify-signal.ts` handler |
| Metrics | Questions asked per ticket, clarify duration, rework rate (did clarify prevent later issues?) |
| SOP | Agent reads spec → identifies ambiguities → asks questions → receives answers → emits CLARIFY_COMPLETE |
| Ideal State | <2 questions on well-written specs; zero rework from missed ambiguities; ambiguity patterns fed back to spec templates |

#### Node 1.3: Plan Phase
| Field | Value |
|-------|-------|
| Function | Generate an implementation plan from the clarified spec |
| Inputs | Clarified spec, codebase context |
| Outputs | Architecture decisions, file changes, approach; enters plan_review gate |
| Current | AI agent creates implementation plan via `/collab.plan`. Non-deterministic — AI reasons about architecture |
| Metrics | Plan quality score (gate pass rate on first attempt), plan duration, plan revision count |
| SOP | Agent reads clarified spec → explores codebase → generates plan → emits PLAN_COMPLETE |
| Ideal State | >80% first-attempt gate pass rate; plans reusable as architectural documentation; plan patterns learned from past runs |

#### Node 1.4: Plan Review Gate
| Field | Value |
|-------|-------|
| Function | Evaluate plan against ticket acceptance criteria before proceeding |
| Inputs | Generated plan, ticket acceptance criteria, gate evaluation prompt (`.collab/config/gates/`) |
| Outputs | PASS (advance to tasks) or FAIL (retry plan) |
| Current | Orchestrator evaluates gate using AI judgment (Layer 3). Full context reasoning |
| Metrics | Pass rate, failure reasons, retry count before pass, false passes (plan passed gate but caused issues later) |
| SOP | Plan submitted → gate prompt loaded → AI evaluates → PASS/FAIL decision → advance or retry |
| Ideal State | >90% correlation between gate pass and successful implementation; zero false passes that cause rework in implement phase |

#### Node 1.5: Tasks Phase
| Field | Value |
|-------|-------|
| Function | Break plan into dependency-ordered tasks |
| Inputs | Approved plan |
| Outputs | Task list with dependencies, ordering, and acceptance criteria |
| Current | AI agent decomposes plan via `/collab.tasks`. Non-deterministic — AI reasons about dependencies |
| Metrics | Tasks per ticket, dependency accuracy, task granularity (too big = risky, too small = overhead) |
| SOP | Agent reads approved plan → decomposes into tasks → establishes dependencies → emits TASKS_COMPLETE |
| Ideal State | Tasks map 1:1 to commits; dependency graph is acyclic; task estimates correlate with actual implementation time |

#### Node 1.6: Analyze Phase
| Field | Value |
|-------|-------|
| Function | Cross-artifact consistency check (spec ↔ plan ↔ tasks ↔ existing code) |
| Inputs | Spec, plan, tasks, current codebase |
| Outputs | Findings with severity (CRITICAL/WARNING/INFO); enters analyze_review gate |
| Current | AI agent performs semantic analysis via `/collab.analyze`. Checks for contradictions, missing coverage, architectural conflicts |
| Metrics | Findings per run, critical finding rate, false positive rate, issues caught that would have been bugs |
| SOP | Agent reads all artifacts → cross-references → identifies inconsistencies → classifies severity → emits ANALYZE_COMPLETE |
| Ideal State | Zero false positives on CRITICAL findings; catches >90% of issues that would have caused implementation rework |

#### Node 1.7: Analyze Review Gate
| Field | Value |
|-------|-------|
| Function | Enforce CRITICAL fixes before allowing implementation to proceed |
| Inputs | Analysis findings, severity classifications |
| Outputs | PASS (no critical issues) or FAIL (critical issues need fix cycle) |
| Current | Orchestrator evaluates. Fix cycle: if CRITICAL findings, agent must resolve before re-analysis |
| Metrics | Pass rate, fix cycle count, critical vs false-critical ratio |
| SOP | Findings submitted → gate evaluates severity → CRITICAL blocks → fix cycle runs → re-analyze → re-gate |
| Ideal State | Fix cycles resolve in ≤2 iterations; zero false-critical blocks; gate never passes a genuine critical issue |

#### Node 1.8: Implement Phase
| Field | Value |
|-------|-------|
| Function | Execute all tasks — write code, run tests, produce working feature |
| Inputs | Approved task list, codebase |
| Outputs | Code changes committed to feature branch; tests passing |
| Current | AI agent executes tasks in dependency order via `/collab.implement`. Mixed: deterministic task execution with AI for code generation and debug decisions |
| Metrics | Implementation time, tasks completed vs planned, test pass rate, lines changed, commit count |
| SOP | Agent reads tasks → executes in order → writes code → runs tests → fixes failures → emits IMPLEMENT_COMPLETE |
| Ideal State | All tasks completed; all tests pass; code review quality ≥ human engineer; zero test-breaking commits |

#### Node 1.9: BlindQA Phase
| Field | Value |
|-------|-------|
| Function | Independent blind verification — test the implementation WITHOUT knowing how it was built |
| Inputs | Ticket spec (original), running application |
| Outputs | QA results (pass/fail with evidence); fix loop if failures (up to 3 retries) |
| Current | Separate AI agent with NO implementation context. Uses Playwright for web verification. Emits via `emit-blindqa-signal.ts`. Fix loop: failures → implement fix → re-verify |
| Metrics | First-pass QA pass rate, bugs found, fix loop iterations, false failures, Playwright reliability |
| SOP | Blind agent reads spec only → creates test plan → executes tests (Playwright for web) → emits BLINDQA_PASS or BLINDQA_FAIL |
| Ideal State | >70% first-pass rate; catches all user-facing regressions; zero false failures; Playwright tests stable |

#### Node 1.10: Pipeline Completion
| Field | Value |
|-------|-------|
| Function | Finalize pipeline run — cleanup, reporting, ticket update |
| Inputs | All phase results, registry state |
| Outputs | Updated Linear ticket, feature branch ready for review |
| Current | Goal gate checks terminal conditions. Registry updated. Ticket status may be updated |
| Metrics | End-to-end pipeline duration, total cost, success rate (completed without human intervention) |
| SOP | Goal gate verified → registry finalized → ticket updated → agent pane cleanup |
| Ideal State | <60min for standard tickets; zero human interventions required; ticket auto-updated with implementation summary |

---

### Layer 2: Orchestration Engine

The infrastructure that makes the pipeline work.

```
Signal Protocol → Transition Engine → Registry Management → Gate Evaluation
       → Agent Lifecycle → Coordination → Error Recovery
```

#### Node 2.1: Signal Protocol
| Field | Value |
|-------|-------|
| Function | Parse, validate, and route signals between agents and orchestrator |
| Inputs | Raw signal string from agent pane |
| Outputs | Parsed signal (ticket_id, nonce, type, detail) |
| Current | `signal-validate.ts` — validates format `[SIGNAL:{TICKET}:{NONCE}] TYPE \| detail`. Suffix-based routing: `_COMPLETE` → advance, `_QUESTION` → answer, `_ERROR` → retry |
| Metrics | Signals processed/run, parse failure rate, signal latency (time from emit to process) |
| SOP | Agent emits signal → orchestrator captures from tmux → `signal-validate.ts` parses → routes by suffix |
| Ideal State | Zero parse failures; <1s signal latency; signal history logged for debugging |

#### Node 2.2: Transition Engine
| Field | Value |
|-------|-------|
| Function | Determine next phase based on current phase and signal type |
| Inputs | Current phase, signal suffix, pipeline.json transitions |
| Outputs | Next phase to dispatch (or gate to evaluate) |
| Current | `transition-resolve.ts` — reads pipeline.json transitions array, matches on `from` + `signal` |
| Metrics | Transition success rate, ambiguous transition rate, fallback rate |
| SOP | Signal parsed → extract current phase + suffix → lookup in transitions → return target phase |
| Ideal State | Zero ambiguous transitions; pipeline.json transitions are complete (every valid state covered) |

#### Node 2.3: Registry Management
| Field | Value |
|-------|-------|
| Function | Track pipeline state — current phase, history, timestamps, errors |
| Inputs | Phase transitions, signal events |
| Outputs | Registry file (JSON) with full run history |
| Current | `registry-update.ts` / `registry-read.sh` — JSON file per run stored in `.collab/registry/` |
| Metrics | Registry read/write latency, corruption rate, state consistency |
| SOP | Phase change → registry-update → new entry with timestamp, phase, signal, detail |
| Ideal State | Registry is the complete audit trail; queryable for analytics; no corruption |

#### Node 2.4: Agent Lifecycle
| Field | Value |
|-------|-------|
| Function | Spawn, monitor, and cleanup Claude Code agent panes |
| Inputs | Phase to execute, ticket context |
| Outputs | Running agent in tmux pane |
| Current | `orchestrator-init.sh` spawns agent pane. `phase-dispatch.sh` sends commands. Orchestrator monitors for signals |
| Metrics | Agent spawn time, agent crash rate, orphaned pane rate, memory usage |
| SOP | Phase dispatched → command sent to agent pane via tmux send-keys → monitor for signal → cleanup on completion |
| Ideal State | <3s agent spawn; zero orphaned panes; automatic cleanup on pipeline abort |

#### Node 2.5: Coordination
| Field | Value |
|-------|-------|
| Function | Manage dependencies between multiple concurrent pipeline runs |
| Inputs | `coordination.json` — ticket dependencies |
| Outputs | Hold/release decisions for dependent tickets |
| Current | `held-release-scan.ts` checks if blocking tickets are complete before releasing held tickets |
| Metrics | Concurrent runs, coordination conflicts, held duration, dependency accuracy |
| SOP | Ticket starts → check coordination.json for dependencies → hold if blocked → release when blocker completes |
| Ideal State | Parallel runs for independent tickets; zero deadlocks; automatic dependency detection from ticket relations |

#### Node 2.6: Error Recovery
| Field | Value |
|-------|-------|
| Function | Handle failures — signal errors, phase failures, agent crashes |
| Inputs | Error signals, agent timeouts, unexpected states |
| Outputs | Retry decision or escalation |
| Current | `_ERROR` / `_FAILED` signals → retry same phase. Fix loops in implement and blindqa (up to 3 retries). Known issues tracked in KNOWN-ISSUES.md |
| Metrics | Error rate by phase, retry success rate, escalation rate (human intervention needed) |
| SOP | Error detected → classify (transient vs fatal) → retry if transient → escalate if fatal or max retries exceeded |
| Ideal State | <5% error rate; >80% retry success; zero unhandled errors; automatic root cause classification |

---

### Layer 3: AI Judgment

The non-deterministic intelligence layer.

```
Gate Evaluation → Question Answering → Severity Assessment
       → Architecture Reasoning → Code Generation → Test Creation
```

#### Node 3.1: Gate Evaluation
| Field | Value |
|-------|-------|
| Function | AI judges whether a phase output meets quality criteria |
| Inputs | Phase output, gate prompt, acceptance criteria |
| Outputs | PASS/FAIL with reasoning |
| Current | Orchestrator loads gate prompt from `.collab/config/gates/`, evaluates with full context |
| Metrics | Gate accuracy (correlation with downstream success), false pass rate, false fail rate |
| SOP | Gate triggered → load gate prompt → provide phase output as context → AI evaluates → binary decision |
| Ideal State | Gate decisions correlate >90% with final implementation quality; reasoning is logged and reviewable |

#### Node 3.2: Question Answering
| Field | Value |
|-------|-------|
| Function | Orchestrator answers agent questions during pipeline execution |
| Inputs | `_QUESTION` signal with options (§-delimited) |
| Outputs | Selected answer sent to agent pane |
| Current | Orchestrator reads question from signal detail, uses AI judgment to select best answer, sends via tmux send-keys |
| Metrics | Questions per run, answer quality (did the answer lead to correct outcome?), answering latency |
| SOP | Question signal received → parse options → AI selects best answer → send to agent pane |
| Ideal State | Correct answer on first attempt; answers logged for learning; common questions pre-answered via config |

#### Node 3.3: Code Generation Quality
| Field | Value |
|-------|-------|
| Function | AI writes production-quality code during implement phase |
| Inputs | Task description, codebase context, test requirements |
| Outputs | Working code committed to feature branch |
| Current | Claude Code generates code, runs tests, iterates on failures |
| Metrics | Code review pass rate, bug density, test coverage of generated code, style conformance |
| SOP | Task read → codebase explored → code written → tests run → iterate on failures → commit |
| Ideal State | Code review pass rate >80%; zero critical bugs; generated code indistinguishable from human code |

---

### Layer 4: Platform & Infrastructure

```
Installation → Configuration → Documentation → Testing → Release
```

#### Node 4.1: Installation & Distribution
| Field | Value |
|-------|-------|
| Function | Install Collab into any repository |
| Inputs | Target repository |
| Outputs | `.collab/` and `.claude/commands/` directories populated |
| Current | `scripts/install.sh` copies from `src/` to runtime directories. Also available via `collab.install` skill |
| Metrics | Install success rate, time to install, post-install validation pass rate |
| SOP | Run install script → copy config, scripts, commands → validate pipeline.json → ready |
| Ideal State | One-command install; auto-detect repo type and customize; version management for upgrades |

#### Node 4.2: Pipeline Configuration
| Field | Value |
|-------|-------|
| Function | Customize pipeline for different project types and team preferences |
| Inputs | Team preferences, project requirements |
| Outputs | Customized pipeline.json |
| Current | Single pipeline.json with fixed 7-phase flow. Customization requires manual editing |
| Metrics | Configuration errors, customization requests, pipeline variants in use |
| SOP | Copy default pipeline.json → edit phases/transitions/gates as needed |
| Ideal State | Template library for common project types; validated customization via schema; no-code pipeline builder |

#### Node 4.3: Relay Platform (Slack)
| Field | Value |
|-------|-------|
| Function | Slack-first spec creation and team coordination |
| Inputs | Feature description from PM |
| Outputs | Structured spec with roles, channel, and blind QA questions |
| Current | Partially implemented — Express server, PostgreSQL schema (7 tables), Slack Bolt integration scaffolded. Session workflow defined but not fully wired |
| Metrics | Specs created, time to complete spec, spec quality score, team engagement |
| SOP | PM runs /relay → provides description → bot analyzes → suggests channel names → assigns roles → runs blind QA → completes spec |
| Ideal State | <15min from feature idea to structured spec; specs consistently reduce implementation rework by >50% |

---

### Layer 5: Internal Operations

How the Collab project itself is developed, tested, and maintained.

```
Development → Testing → Validation → Issue Tracking → Architecture Decisions
```

#### Node 5.1: Pipeline Validation
| Field | Value |
|-------|-------|
| Function | Validate that the pipeline orchestrator actually works end-to-end |
| Inputs | Test tickets, pipeline changes |
| Outputs | Validation results, known issues updates |
| Current | Manual validation runs (e.g., BRE-202). Known issues tracked in KNOWN-ISSUES.md |
| Metrics | Validation frequency, issues found per run, regression rate |
| SOP | Create test ticket → run pipeline → observe each phase → document issues → update KNOWN-ISSUES.md |
| Ideal State | Automated validation suite; CI runs pipeline on every merge; regression detected before release |

#### Node 5.2: Script Development
| Field | Value |
|-------|-------|
| Function | Develop and maintain Layer 2 scripts (deterministic execution) |
| Inputs | Pipeline.json schema changes, bug reports, feature requests |
| Outputs | Updated scripts in `.collab/scripts/orchestrator/` |
| Current | Bash + TypeScript (Bun). Edit in `src/`, install.sh copies to runtime |
| Metrics | Script error rate, script test coverage, time between edit and deploy |
| SOP | Edit in src/ → run tests → install.sh → validate |
| Ideal State | 100% script test coverage; scripts never need changes for new pipeline phases (fully generic) |

#### Node 5.3: Command Development
| Field | Value |
|-------|-------|
| Function | Develop and maintain Layer 3 commands (AI judgment instructions) |
| Inputs | Quality feedback, new phase requirements, model updates |
| Outputs | Updated `.claude/commands/collab.*.md` files |
| Current | 8 command files, one per phase. Instructions define AI behavior for each phase |
| Metrics | Command effectiveness (phase success rate), instruction clarity, model compatibility |
| SOP | Identify improvement → edit command in src/ → test with pipeline run → install.sh |
| Ideal State | Command changes A/B tested; effectiveness measured; model-version-specific tuning |

---

## Part 2: The Ideal State Document

### Mission

**Make AI-powered software development autonomous, measurable, and reliable — so any team can ship verified features from a ticket with zero human intervention during execution.**

### Ideal State Criteria

Binary-testable. YES or NO in 2 seconds.

#### Pipeline Quality
1. Pipeline completes end-to-end without human intervention for >70% of standard tickets
2. End-to-end duration is under 60 minutes for standard tickets
3. BlindQA catches all user-facing regressions (zero escapes to human review)
4. Gate pass/fail decisions correlate >90% with actual implementation quality
5. Generated code passes human code review >80% of the time

#### Measurement
6. Every pipeline phase has duration, success rate, and cost tracked
7. Total cost per pipeline run is calculated and visible
8. Gate accuracy (true positive / false positive) is measured
9. Phase-over-phase quality trends are visible (is the pipeline getting better?)

#### Reliability
10. Signal protocol has zero parse failures
11. Error recovery resolves >80% of failures without human intervention
12. Zero orphaned agent panes after pipeline completion or abort
13. Concurrent pipeline runs don't interfere with each other

#### Extensibility
14. Adding a new pipeline phase requires only pipeline.json + command file (zero script changes)
15. Pipeline can be installed in any repo in under 2 minutes
16. Custom pipeline configurations validated against schema before execution

#### Relay Platform
17. PM can go from feature idea to structured spec in under 15 minutes
18. Specs created through Relay reduce implementation rework by >50%
19. Living spec system captures and incorporates gaps found during implementation

### Current State (Snapshot — Mar 2026)

| Dimension | Current | Gap |
|-----------|---------|-----|
| Autonomy | Validated through implement; blindqa working with fix loops | Need >70% fully autonomous completion rate |
| Duration | Unknown — no timing instrumentation | No measurement at all |
| Cost | Unknown | No cost tracking |
| Gate accuracy | Unknown | No correlation tracking |
| Signal reliability | Improved (deterministic emission pattern) | Need zero parse failure verification |
| Error recovery | Fix loops exist (3 retries) | Need measurement of retry success rate |
| Metrics | None | Biggest gap — can't improve what you can't measure |
| Relay Platform | Schema + scaffolding complete | Slack integration not fully wired |
| Validation | Manual runs only | No automated validation suite |

### The Migration

Priority order for gap-closing:
1. **Phase instrumentation** (ISC #6-9) — can't improve without measurement
2. **Pipeline reliability** (ISC #10-13) — must work before it can be measured
3. **Autonomy rate** (ISC #1-5) — the core value proposition
4. **Relay completion** (ISC #17-19) — the spec creation workflow
5. **Extensibility** (ISC #14-16) — making it usable for others

---

## Part 3: Restructuring Plan

### What Collab Already Gets Right

Collab's 3-layer architecture IS Miessler's pattern:
- **Layer 1 (pipeline.json)** = The graph definition
- **Layer 2 (scripts)** = Deterministic nodes executing the graph
- **Layer 3 (AI commands)** = Non-deterministic judgment at decision points

This is already the separation he describes. The restructuring is about adding what's missing.

### Structural Changes

#### 1. Pipeline Metrics System

**What:** Instrument every phase with timing, cost, and outcome tracking.

**Why:** ISC #6: "Every pipeline phase has duration, success rate, and cost tracked." Currently zero measurement exists.

**How:**
- Add timestamps to registry entries (phase start, phase end, duration)
- Track token usage per phase (from Claude API response)
- Calculate cost per phase (tokens × pricing)
- Aggregate into per-run metrics (total duration, total cost, phases passed/failed)
- Store metrics in registry file (already JSON, just add fields)

**Nodes affected:** All Layer 1 nodes, Node 2.3 (Registry)

#### 2. Gate Accuracy Tracking

**What:** Measure whether gate decisions correlate with outcomes.

**Why:** ISC #4: "Gate pass/fail decisions correlate >90% with actual implementation quality." A gate that always passes is useless.

**How:**
- When plan_review passes, track whether implement phase succeeds
- When analyze_review passes, track whether blindqa finds issues the analysis missed
- Calculate: true positives (gate passed, outcome good), false positives (gate passed, outcome bad)
- Surface gate accuracy over time

**Nodes affected:** Node 1.4 (Plan Review Gate), Node 1.7 (Analyze Review Gate), Node 3.1 (Gate Evaluation)

#### 3. Pipeline Run Dashboard

**What:** A view showing all pipeline runs with per-phase metrics.

**Why:** You should be able to look at Collab's history and see: which tickets ran, how long each phase took, where failures happened, total cost, autonomy rate.

**How:**
- Query registry files across all runs
- Aggregate into dashboard data (CLI table or web view)
- Show: ticket, phases completed, duration per phase, total cost, outcome (success/failure/escalation)
- Status table script (`status-table.sh`) already exists — extend it

**Nodes affected:** Node 2.3 (Registry), all Layer 1 nodes

#### 4. Signal Reliability Metrics

**What:** Track signal parse success/failure and latency.

**Why:** ISC #10: "Signal protocol has zero parse failures." Signals are the nervous system — if they fail, everything fails.

**How:**
- Log every signal parse attempt (success/failure, raw signal, error reason)
- Track signal latency (time from agent emit to orchestrator process)
- Alert on parse failure patterns

**Nodes affected:** Node 2.1 (Signal Protocol)

#### 5. Autonomy Rate Tracking

**What:** The single most important metric — what % of tickets complete without human intervention?

**Why:** ISC #1: "Pipeline completes end-to-end without human intervention for >70% of standard tickets."

**How:**
- Define "human intervention" events (orchestrator couldn't answer question, manual fix needed, pipeline aborted)
- Track per run: autonomous (yes/no), intervention count, intervention type
- Calculate rolling autonomy rate

**Nodes affected:** All nodes — this is the top-level KPI

#### 6. Relay Platform Completion

**What:** Finish the Slack-first spec creation workflow.

**Why:** ISC #17-19. The spec quality directly affects pipeline success rate.

**How:**
- Complete Slack plugin wiring (commands, interactions, blocks)
- Implement blind QA question flow
- Implement living spec versioning
- Connect to Linear for ticket creation from completed specs

**Nodes affected:** Node 4.3 (Relay Platform)

### Implementation Sequence

```
Phase 1: Instrument     → Registry timestamps, token/cost tracking per phase
Phase 2: Measure        → Pipeline run dashboard, signal metrics
Phase 3: Track          → Gate accuracy, autonomy rate
Phase 4: Relay          → Complete Slack spec creation workflow
Phase 5: Self-Improve   → Feedback loops from outcomes back to commands/prompts
```

---

## Part 4: The Miessler Alignment

| # | Transition | Collab Alignment | Status |
|---|-----------|-----------------|--------|
| 1 | Knowledge: private → public | Pipeline commands ARE codified knowledge (how to plan, implement, review) | Implemented |
| 2 | Products: standalone → API | Pipeline is invoked via CLI command — needs API/MCP exposure for external orchestration | Gap |
| 3 | Interface: human → agent | Already agent-first — agents consume commands, not humans | Implemented |
| 4 | Enterprise: humans → graph | pipeline.json IS the graph; 3-layer architecture separates config/execution/judgment | Implemented |
| 5 | Software: standardized → custom | pipeline.json is customizable per project; but no template library yet | Partial |
| 6 | Management: yolo → ideal state | This document defines ideal state; pipeline doesn't self-measure yet | In Progress |

### The Meta Insight

Collab is Miessler's thesis at two levels:

1. **As a product:** Collab itself should be structured as a graph with measurable nodes (this document)
2. **As a tool:** Collab CREATES graphs for others — every pipeline run constructs a graph of algorithms (clarify → plan → implement → verify) for a company's engineering workflow

When a company installs Collab, they're literally building the "graph of algorithms run by AI" that Miessler describes. The pipeline IS the graph. The commands ARE the SOPs. The gates ARE the verification criteria. The signal protocol IS the nervous system.

The missing piece is measurement. Once every node has metrics, Collab becomes a self-improving graph — exactly what Miessler envisions as the future of all companies.

---

## Appendix: Pipeline Graph (from pipeline.json)

```
                    ┌──────────┐
                    │  intake   │ (1.1)
                    └─────┬────┘
                          │
                    ┌─────▼────┐
                    │ clarify  │ (1.2)
                    └─────┬────┘
                          │ CLARIFY_COMPLETE
                    ┌─────▼────┐
                    │   plan   │ (1.3)
                    └─────┬────┘
                          │ PLAN_COMPLETE
                   ┌──────▼───────┐
                   │ plan_review  │ (1.4) GATE
                   │  PASS/FAIL   │
                   └──┬───────┬──┘
              FAIL ←──┘       └──→ PASS
              (retry plan)         │
                             ┌─────▼────┐
                             │  tasks   │ (1.5)
                             └─────┬────┘
                                   │ TASKS_COMPLETE
                             ┌─────▼────┐
                             │ analyze  │ (1.6)
                             └─────┬────┘
                                   │ ANALYZE_COMPLETE
                          ┌────────▼────────┐
                          │ analyze_review  │ (1.7) GATE
                          │   PASS/FAIL     │
                          └──┬──────────┬──┘
                   FAIL ←────┘          └────→ PASS
                   (fix cycle)                  │
                                          ┌─────▼──────┐
                                          │ implement  │ (1.8)
                                          └─────┬──────┘
                                                │ IMPLEMENT_COMPLETE
                                          ┌─────▼──────┐
                                          │  blindqa   │ (1.9)
                                          └─────┬──────┘
                                                │ BLINDQA_PASS
                                          ┌─────▼──────┐
                                          │    done    │ (1.10)
                                          └────────────┘

    ═══════════════════════════════════════════════════════
    ORCHESTRATION (Layer 2) — runs beneath pipeline
    ═══════════════════════════════════════════════════════
    │ Signal(2.1) │ Transition(2.2) │ Registry(2.3) │
    │ Agent(2.4)  │ Coordination(2.5)│ Recovery(2.6) │
    ═══════════════════════════════════════════════════════

    ═══════════════════════════════════════════════════════
    AI JUDGMENT (Layer 3) — reasoning at decision points
    ═══════════════════════════════════════════════════════
    │ Gates(3.1) │ Questions(3.2) │ CodeGen(3.3)    │
    ═══════════════════════════════════════════════════════
```

---

*This is a living document. Updated as pipeline evolves.*
*Metrics will be populated once Phase 1 (Instrument) is complete.*

*"You can't hill-climb without something to measure against." — Karpathy, via Miessler*
