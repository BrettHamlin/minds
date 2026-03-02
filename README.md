# Collab

A structured workflow system that orchestrates how teams build software — from spec to ship.

## The Problem

Building software involves multiple perspectives: product thinking, design, engineering, QA. In practice, these perspectives either get skipped ("just build it") or happen informally in scattered conversations that never make it back into the spec. The result: incomplete specs, missed edge cases, and features that don't match what was intended.

**The core insight:** The problem isn't that teams lack talent — it's that there's no structured handoff between perspectives. A PM thinks about user value, a designer thinks about interaction, a QA engineer thinks about failure modes, an engineer thinks about feasibility. Each perspective catches things the others miss, but only if the workflow actually ensures each one happens.

## What Collab Does

Collab provides two things:

1. **Multi-persona spec creation** — Get the right people (or AI agents acting as specialized personas) together in a structured process to define what to build. Each persona contributes from their expertise. The system asks the right questions, captures the answers, and synthesizes them into a complete spec.

2. **Pipeline execution** — Take that spec and execute it through a deterministic, gate-checked pipeline: clarify requirements, generate a plan, break it into tasks, analyze for consistency, implement, and verify with adversarial QA. Each phase produces artifacts that feed the next. Gates ensure quality before advancing.

The first half answers **"what are we building and why?"** with input from every perspective that matters. The second half answers **"build it correctly"** with structured phases, automated verification, and rollback on failure.

## Architecture

Collab is a three-layer system:

```
Layer 1 — Declarative (pipeline.json / .pipeline DSL)
  What phases exist, what signals they emit, how they connect.
  Change the workflow by editing config, not code.

Layer 2 — Execution (TypeScript orchestrator scripts)
  Generic interpreters that read Layer 1 and execute it.
  Deterministic: same inputs always produce same outputs.

Layer 3 — Judgment (AI model instructions)
  Gate evaluation, feedback synthesis, escalation decisions.
  Only the parts that require contextual reasoning.
```

The key principle: **deterministic code handles mechanics, AI handles judgment.** Scripts dispatch phases, validate signals, resolve transitions. The AI evaluates whether a plan is good enough, whether analysis findings are critical, whether QA passed.

## Components

### Pipeline Engine (`src/`)

The orchestrator that drives workflows through phases. Runs in tmux — an orchestrator pane manages an agent pane, communicating via a signal protocol.

- **Commands** — Slash commands for each phase (`/collab.clarify`, `/collab.plan`, `/collab.implement`, etc.)
- **Handlers** — Deterministic signal emitters that bridge agent output to orchestrator input
- **Scripts** — Layer 2 TypeScript: phase dispatch, transition resolution, registry management, gate checking
- **Shared library** — TmuxClient, signal parsing, registry I/O, error handling
- **Skills** — AI behavior definitions (BlindQA, SpecCreator, SpecCritique)

### Pipelang DSL (`pipelang/`)

A domain-specific language for defining pipelines. Compiles `.pipeline` files to `pipeline.json`.

```
phase(plan)
    .command("/collab.plan")
    .signals(PLAN_COMPLETE, PLAN_ERROR)
    .on(PLAN_COMPLETE, gate: plan_review)
    .on(PLAN_ERROR, to: plan)

gate(plan_review)
    .prompt(.file(".collab/config/gates/plan.md"))
    .on(APPROVED, to: tasks)
    .on(REVISION_NEEDED, to: plan, feedback: .enrich, maxRetries: 3, onExhaust: .skip)
```

Includes a full LSP server and VS Code extension for syntax highlighting, autocompletion, go-to-definition, rename, and real-time diagnostics.

### CLI Installer (`cli/`)

npm package that installs Collab into any git repository.

```bash
npx collab-workflow init
```

Scaffolds commands, handlers, scripts, config, and skills into the target repo. Supports `init`, `update`, and `status` commands.

## Pipeline Phases

The default pipeline (`collab.pipeline`) defines this workflow:

```
clarify → plan → [plan_review gate] → tasks → analyze → [analyze_review gate] → implement → blindqa → done
```

| Phase | What happens |
|-------|-------------|
| **clarify** | Extract and clarify requirements from a Linear ticket |
| **plan** | Generate an implementation plan from the spec |
| **plan_review** | Gate: AI evaluates plan quality, approves or requests revision |
| **tasks** | Break the plan into dependency-ordered implementation tasks |
| **analyze** | Validate spec/plan/tasks consistency, find gaps |
| **analyze_review** | Gate: AI evaluates analysis findings, approve or force remediation |
| **implement** | Execute implementation tasks |
| **blindqa** | Adversarial QA — verify the implementation without seeing the code that was written |
| **done** | Terminal state |

Gates can retry with feedback enrichment, skip after max retries, or abort. Transitions support conditional routing (e.g., multi-ticket groups loop back through tasks).

## Signal Protocol

Agents communicate with the orchestrator by emitting signals:

```
[SIGNAL:BRE-233:ab12c] CLARIFY_COMPLETE | All questions answered
```

Signals are validated against the pipeline definition. Each phase declares its valid signals. The orchestrator matches `(phase, signal)` pairs to transitions and advances accordingly.

## Requirements

- **Bun** >= 1.0 (runtime for orchestrator scripts and handlers)
- **Node.js** >= 18 (for the CLI installer via npx)
- **tmux** (pipeline execution environment)
- **Claude Code** (AI agent that executes phase commands)
- **Git** (repository management)

## Development

```bash
# Run orchestrator tests (from repo root)
bun test

# Run pipelang tests
cd pipelang && bun test

# Run CLI tests
cd cli && bun test

# Compile pipeline DSL
cd pipelang && bun cli.ts compile collab.pipeline

# Build CLI for npm
cd cli && bun run build
```

## Project Status

**Shipped:**
- Pipeline engine — Production (validated with 3 consecutive E2E runs)
- Pipelang DSL + LSP — Complete (381 tests)
- CLI installer — Complete (54 tests, npm-ready)
- VS Code extension — Complete (syntax highlighting + LSP)

**Future work:**
- **Workflow-defined spec creation** — see below

## Workflow-Defined Spec Creation

The pipeline engine builds software from specs. The missing front half is: **how do you get a good spec in the first place?**

The answer is the same pattern — a declarative workflow. Instead of defining phases like `clarify → plan → implement`, you define a **spec creation workflow** that specifies which personas to assemble, what to ask each of them, and how to synthesize their input into a complete spec.

```
workflow(spec-creation)
    .channel("feature-${TICKET_ID}")

    .invite(engineer, count: 2, criteria: "most knowledge of affected codebase")
    .invite(designer, level: 5, count: 1)
    .invite(pm, specific: "beth-k")
    .invite(adversary)
    .invite(artist)

    .phase(discovery)
        .ask(pm, "What problem are we solving? Who is affected?")
        .ask(engineer, "What systems does this touch? What are the risks?")
        .ask(designer, "What's the interaction model? What existing patterns apply?")

    .phase(challenge)
        .ask(adversary, "What's wrong with this approach? What are we missing?")
        .ask(engineer, "Is this feasible in the proposed timeline?")
        .ask(artist, "What visual direction fits this feature?")

    .phase(synthesis)
        .synthesize(spec)
        .gate(pm_approval)

    .output(spec → collab.pipeline)
```

The personas, the questions, the number of people, the selection criteria — all declarative. Different features get different workflows:

- A **security-critical feature** invites a security engineer and adds a threat modeling phase
- A **UI feature** invites two designers and an accessibility specialist
- A **backend refactor** skips design and loads up on engineers
- A **new product** invites everyone and runs a longer discovery phase

The workflow runs in Slack. A bot creates a channel, invites the specified personas, and guides the conversation through each phase — asking role-specific questions, capturing answers, resolving conflicts (PM has final authority), and synthesizing everything into a versioned spec. The spec stays "living" — anyone can flag gaps mid-build, the PM approves changes, and the spec versions automatically.

What comes out is a complete, pressure-tested spec ready for the pipeline engine to consume. The same DSL, the same compiler, the same orchestrator — just targeting Slack channels instead of tmux panes.

## License

MIT
