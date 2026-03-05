---
description: Orchestrator-compatible spec clarification using shared question/answer protocol (interactive or batch)
---

## User Input

```text
$ARGUMENTS
```

## Orchestrator Signal Contract (ALWAYS ACTIVE)

> **This applies throughout your entire execution — not just at the end.**

Whenever you have **finished all clarification work for this phase**, emit:

```bash
bun .collab/handlers/emit-question-signal.ts complete "Clarification phase finished"
```

This applies in every scenario: normal completion, after follow-up messages from the orchestrator, after any retry. Any response that represents "this phase is done" must end with this signal.

---

## Goal

Detect and reduce ambiguity in the active feature specification. Uses the shared batch question/answer protocol from `src/lib/pipeline/questions.ts`:

- **Interactive mode** (`@interactive` enabled, default): Uses AskUserQuestion for each finding.
- **Non-interactive mode** (`@interactive(off)`): Collects ALL questions upfront into a `FindingsBatch`, writes to `findings/clarify-round-N.json`, emits `CLARIFY_QUESTIONS` signal, then polls for `resolutions/clarify-round-N.json`.

Both modes share the same analysis and resolution-application code.

## Execution Steps

1. **Prerequisites Check**
   ```bash
   bun .collab/scripts/resolve-feature.ts
   ```
   Parse JSON to get `FEATURE_DIR` and `FEATURE_SPEC`.

2. **Detect Execution Mode**

   Check if autonomous (orchestrated) mode is active by reading the registry file directly:

   Use the **Read** tool on the absolute path:
   ```
   Read: {repo_root}/.collab/state/pipeline-registry/{ticket_id}.json
   ```

   Where `{repo_root}` is the git repository root (use `git rev-parse --show-toplevel` via Bash if needed), and `{ticket_id}` is extracted from `$ARGUMENTS` or from the `BRANCH` name (e.g., branch `BRE-246-content-curator` → ticket_id `BRE-246`).

   **IMPORTANT**: Do NOT use Glob or shell `find` to locate the registry. In pipeline worktrees, `.collab` is a symlink — Glob may not traverse it. Use the **Read** tool directly on the known path.

   If the file exists and `current_step` contains `clarify`, set `AUTONOMOUS_MODE=true`. Otherwise `AUTONOMOUS_MODE=false`.

   **Interactive mode detection:**

   When `AUTONOMOUS_MODE=true`: read the pipeline config to check for an `interactive` field:
   ```bash
   INTERACTIVE_RAW=$(bun .collab/scripts/orchestrator/commands/pipeline-config-read.ts interactive 2>/dev/null || echo "")
   ```
   - If `interactive.enabled` is explicitly `true` → `INTERACTIVE_MODE=true`
   - If `interactive.enabled` is `false` OR the `interactive` field is absent → `INTERACTIVE_MODE=false` (default non-interactive)

   When `AUTONOMOUS_MODE=false` (manual run): `INTERACTIVE_MODE=true` (default — user expects AskUserQuestion prompts).

   **IMPORTANT:** The absence of `interactive` in pipeline.json means non-interactive. This is the standard for orchestrated pipelines — the orchestrator handles all questions via the batch protocol.

3. **Load Spec**
   Read the spec file from `FEATURE_SPEC`.

4. **Ticket Type Classification**

   Read the spec description and classify the ticket type. Look for signal words:

   | Type | Signals | Scan Strategy |
   |------|---------|---------------|
   | **Refactor** | "refactor", "restructure", "migrate", "consolidate", "extract", "decouple" | Deep-scan the specific code being refactored — its patterns, dependencies, callers. **Existing code is truth.** Preserve patterns unless the ticket explicitly changes them. |
   | **New Feature** | "add", "implement", "create", "new", "support" | Find analogous existing features — how does this repo already handle similar things? **Extend existing patterns.** |
   | **Bug Fix** | "fix", "broken", "regression", "error", "incorrect" | Scan the broken code path and surrounding module patterns. **Match surrounding code.** |
   | **Enhancement** | "improve", "optimize", "update", "enhance", "upgrade" | Scan current implementation, its tests, and performance characteristics. **Evolve existing patterns.** |

   If ambiguous, default to **New Feature** (broadest scan).

   Record: `TICKET_TYPE = <type>` and `SCAN_STRATEGY = <strategy summary>`.

5. **Codebase Pattern Scan**

   Using `TICKET_TYPE` and the spec's domain areas, perform a targeted codebase scan.

   a) **Detect primary language** from the repo (check `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, file extensions, etc.)

   b) **Probe for LSP server availability.** Run the appropriate check for the detected language:

   | Language | LSP Probe Command | What It Gives You |
   |----------|-------------------|-------------------|
   | TypeScript/JS | `npx --yes typescript-language-server --version 2>/dev/null` or check `node_modules/.bin/tsc` | Symbols, references, type hierarchy |
   | Go | `which gopls 2>/dev/null` | Call graph, interface implementations |
   | Rust | `which rust-analyzer 2>/dev/null` | Traits, impls, dependency tree |
   | Python | `which pyright 2>/dev/null \|\| which pylsp 2>/dev/null` | Type stubs, import graph |

   If the probe succeeds, set `LSP_AVAILABLE=true` and record the server binary path.
   If no LSP is available, set `LSP_AVAILABLE=false` — fall back to Grep/Glob (step 5d).

   c) **LSP-powered scan** (when `LSP_AVAILABLE=true`):

   Use the LSP server to get richer code intelligence than text search alone. Run LSP queries via CLI where possible:

   - **TypeScript:** Use `tsc --noEmit --listFiles` for dependency graph, or run a quick `ts-morph` script to extract exports/imports/types from relevant modules.
   - **Go:** Use `gopls references`, `gopls symbols`, or `gopls call_hierarchy` on key identifiers from the ticket.
   - **Rust:** Use `rust-analyzer` CLI commands for symbol lookup and trait implementations.
   - **Python:** Use `pyright --outputjson` for type analysis of relevant modules.

   **What to extract via LSP (when available):**
   - Symbol definitions and their callers/references (especially for Refactor tickets — who depends on this code?)
   - Type hierarchies and interface implementations (what contracts must be preserved?)
   - Import/export graphs (what's the module boundary?)
   - Unused exports or dead code (relevant for Enhancement tickets)

   **LSP queries should target the specific files/symbols relevant to the ticket**, not scan the entire repo. Use the ticket description to identify the entry points.

   d) **Grep/Glob scan** (fallback when `LSP_AVAILABLE=false`, or to supplement LSP results):

   - **Extract domains** from the ticket (e.g., "authentication", "API routes", "database models", "validation")
   - **Refactor:** Read the specific files/modules referenced in the ticket. Note current patterns: naming, error handling, test structure, module boundaries. These are constraints, not suggestions.
   - **New Feature:** Grep/Glob for analogous existing implementations (e.g., if adding a new API endpoint, find existing endpoints). Note: libraries used, file organization, naming conventions, test patterns, error handling approach.
   - **Bug Fix:** Read the code path mentioned in the ticket and its immediate dependencies. Note the module's local conventions.
   - **Enhancement:** Read the current implementation being enhanced. Note its patterns plus its test coverage approach.

   e) **Produce a `CODEBASE_CONTEXT` summary** (carry forward to Step 6):
      - Tech stack observed (frameworks, libraries, versions)
      - Naming conventions (files, functions, variables, tests)
      - Architectural patterns (e.g., repository pattern, middleware chain, event-driven)
      - Error handling approach (e.g., Result types, try/catch, error codes)
      - Test patterns (e.g., co-located tests, test directory, fixtures, mocks)
      - Any project-specific conventions (e.g., custom decorators, shared utilities)
      - **If LSP was used:** Type relationships, caller/callee graph, interface contracts discovered

   **Time-box:** Spend no more than 3-5 targeted queries (LSP or Grep/Glob). This is reconnaissance, not exhaustive analysis.

6. **Ambiguity Scan**
   Analyze spec across taxonomy categories:
   - Functional Scope (out-of-scope, user roles)
   - Data Model (primary keys, relationships, scale)
   - UX Flow (error/loading states)
   - Non-Functional (performance, observability)
   - Integration (API contracts, failure modes)
   - Edge Cases (concurrency, validation)
   - Terminology (enum values, canonical terms)

   Mark each: Clear / Partial / Missing

7. **Generate Questions** (max 3 for orchestrated mode)

   For each critical ambiguity:
   - Create 2-4 distinct options
   - **Ground the recommended option in `CODEBASE_CONTEXT`:** If the repo already has a convention for this decision, the recommendation MUST follow it. Cite the evidence (e.g., "This repo uses Zod for validation — see `src/middleware/validate.ts`").
   - Only fall back to generic best practices when no project convention exists for the decision.
   - For **Refactor** tickets: recommendations should preserve existing patterns unless the ticket explicitly calls for changing them.
   - For **New Feature** tickets: recommendations should extend the patterns found in analogous features.
   - Make recommendation the first option
   - Add "(Recommended)" to its description

8. **Ask Questions / Resolve**

   Use a `QuestionCollector` (from `.collab/lib/pipeline/questions.ts`) to collect ALL findings first, then call `resolveAndApply()`.

   **Decision tree (check in this order):**
   1. `AUTONOMOUS_MODE=true` AND `INTERACTIVE_MODE=false` → **8a** (non-interactive batch — orchestrator resolves)
   2. `AUTONOMOUS_MODE=false` AND `INTERACTIVE_MODE=true` → **8b** (interactive — human resolves via AskUserQuestion)
   3. `AUTONOMOUS_MODE=true` AND `INTERACTIVE_MODE=true` → **8c** (auto-resolve fallback — only when pipeline config explicitly sets `interactive.enabled: true`)

   **The common orchestrated case is 8a.** When pipeline.json has no `interactive` field, `INTERACTIVE_MODE=false`, so autonomous pipelines always use the batch protocol.

   ### 8a. NON-INTERACTIVE MODE (when `INTERACTIVE_MODE=false`)

   > **This is the DEFAULT for orchestrated pipelines (AUTONOMOUS_MODE=true).** Enter this path when `INTERACTIVE_MODE=false`.

   **Re-entry detection:** Before collecting questions, check if resolutions already exist from a previous round:

   ```bash
   ls {FEATURE_DIR}/specs/{FEATURE_SLUG}/resolutions/clarify-round-*.json 2>/dev/null
   ```

   If resolutions files exist, this is a **re-dispatch** from the orchestrator. Read the resolutions, apply them to the spec (update sections, add clarifications), then skip to emitting `CLARIFY_COMPLETE`. Do NOT re-collect questions or re-emit `CLARIFY_QUESTIONS`.

   **First entry (no resolutions):** Collect ALL questions, write them using the CLI, and **end your response**. Do NOT poll or wait for resolutions — the orchestrator will:
   1. Receive `CLARIFY_QUESTIONS`
   2. Gather context, synthesize answers, write resolutions
   3. Re-dispatch `/collab.clarify` to this agent pane

   **Write findings using the CLI** (this writes the correct schema and emits the signal automatically):

   ```bash
   cat <<'EOF' | bun .collab/scripts/emit-findings.ts --phase clarify --round 1 --stdin
   [
     {
       "question": "Your question text here",
       "why": "Why this matters for implementation",
       "specReferences": ["Section X mentions Y"],
       "codePatterns": ["src/foo.ts uses pattern Z"],
       "constraints": ["Must not break existing API"],
       "implications": ["Determines migration strategy"]
     }
   ]
   EOF
   ```

   All context fields (`why`, `specReferences`, `codePatterns`, `constraints`, `implications`) are optional.

   After the CLI runs, output: "Emitted CLARIFY_QUESTIONS with {N} questions. Waiting for orchestrator to resolve." then **END RESPONSE** — do not wait, do not poll.

   **Do NOT use AskUserQuestion in non-interactive mode.** The orchestrator reasons about answers using its full context stack (spec > constitution > prior resolutions > codebase patterns > agent context > coordination).

   ### 8b. INTERACTIVE MODE (when `AUTONOMOUS_MODE=false` and `INTERACTIVE_MODE=true`)

   Collect ALL questions first, then for each question call AskUserQuestion:

   ```
   {
     questions: [{
       question: "<clear question text>",
       header: "<category name>",
       multiSelect: false,
       options: [
         {
           label: "<option A>",
           description: "<why this is best> (Recommended)"
         },
         {
           label: "<option B>",
           description: "<trade-offs of this option>"
         },
         {
           label: "Custom answer",
           description: "Provide your own answer"
         }
       ]
     }]
   }
   ```

   Wrap each user answer into a `Resolution` object and apply after all questions answered.

   **IMPORTANT**: Always include "Custom answer" option so user can provide their own response.

   ### 8c. AUTONOMOUS MODE fallback (when `AUTONOMOUS_MODE=true` and `INTERACTIVE_MODE=true`)

   > **This path is ONLY reached when pipeline.json explicitly sets `interactive.enabled: true`.** If the `interactive` field is absent, `INTERACTIVE_MODE=false` and you use 8a instead.

   In autonomous mode with interactive explicitly enabled, DO NOT call AskUserQuestion. Instead, auto-resolve each question:

   For each generated question:
   - Select the **recommended option** (the first option, marked with "(Recommended)")
   - Record the decision: `[AUTONOMOUS] Selected recommended: <option label>`
   - Proceed directly to integration (Step 9)

   This ensures the pipeline does not stall waiting for interactive input.

9. **Integrate Each Answer**

   After EACH answer:
   - Create/update `## Clarifications` section
   - Add `### Session YYYY-MM-DD` if new session
   - Append: `- Q: <question> → A: <answer>`
   - Update relevant sections (e.g., add enum to Database Schema)
   - **Save spec file immediately** (atomic write)

10. **Validation**
   - One bullet per answer in Clarifications section
   - Max 3 questions asked total
   - No contradictory statements remain
   - Terminology consistent across sections

11. **Emit Completion Signal**
   ```bash
   bun .collab/handlers/emit-question-signal.ts complete "Clarification phase finished"
   ```
   **CRITICAL**: This signal emission is MANDATORY for orchestrated workflows. Without it, the orchestrator will wait indefinitely.

12. **Report Completion**
   - Number of questions answered
   - Sections updated
   - Path to updated spec
   - Suggest `/collab.plan` as next command

## Signal Flow

**Autonomous mode:** Steps 4-5 (classification + scan) still run. Steps 8a auto-selects recommended options (grounded in codebase context) and proceeds directly to integration.

**Interactive mode:**
1. Agent emits `CLARIFY_QUESTION` via `bun .collab/handlers/emit-question-signal.ts question "question§option1§option2§..."`
2. Orchestrator receives signal → reads question + options directly from signal `detail` field (no screen capture)
3. Agent calls AskUserQuestion
4. Orchestrator reasons with ticket context, navigates tmux to select best option
5. Agent receives answer, integrates into spec
6. Repeat for remaining questions
7. After all questions: Agent explicitly calls `emit-question-signal.ts complete` to emit `CLARIFY_COMPLETE`

## Key Differences from Standard Clarify

- **Uses AskUserQuestion tool** (signal-emitting) instead of custom formatting
- **Max 3 questions** instead of 5 (orchestrated workflows are faster)
- **Recommendations in option descriptions** (orchestrator can auto-select)
- **Works in orchestrated pipeline** (proper signal protocol)
