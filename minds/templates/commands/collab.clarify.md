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
bun .gravitas/handlers/emit-signal.ts complete "Clarification phase finished"
```

This applies in every scenario: normal completion, after follow-up messages from the orchestrator, after any retry. Any response that represents "this phase is done" must end with this signal.

---

## Goal

Detect and reduce ambiguity in the active feature specification. Uses the shared batch question/answer protocol from `src/lib/pipeline/questions.ts`:

- **Interactive mode** (`@interactive` enabled, default): Uses AskUserQuestion for each finding.
- **Non-interactive mode** (`@interactive(off)`): Collects ALL questions upfront into a `FindingsBatch`, writes to `findings/clarify-round-N.json`, emits a questions signal, then polls for `resolutions/clarify-round-N.json`.

Both modes share the same analysis and resolution-application code.

## Execution Steps

1. **Prerequisites Check**
   ```bash
   bun .gravitas/scripts/resolve-feature.ts
   ```
   Parse JSON to get `FEATURE_DIR` and `FEATURE_SPEC`.

2. **Detect Execution Mode**

   Where `{ticket_id}` is extracted from `$ARGUMENTS` or from the `BRANCH` name (e.g., branch `BRE-246-content-curator` → ticket_id `BRE-246`).

   Run the mode resolution script:
   ```bash
   MODE_JSON=$(bun .gravitas/scripts/resolve-execution-mode.ts {ticket_id} --phase clarify)
   ```

   Parse JSON to extract:
   - `AUTONOMOUS_MODE` = `MODE_JSON.autonomous` (true if registry active with clarify as current step)
   - `INTERACTIVE_MODE` = `MODE_JSON.interactive` (true only when interactive.enabled=true in pipeline config, or manual run)

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

6b. **Memory Query** (before generating questions)

   For each ambiguity detected in step 6, before generating a question, check prior decisions:

   ```bash
   bun minds/memory/lib/search-cli.ts --mind clarify --query "<ambiguity description>"
   ```

   Parse the output and apply the following rules:
   - **High score (> 0.7) + content contains `Q:` and `A:` matching the ambiguity** → **Skip the question.** Cite the prior decision in the spec update instead (e.g., "Prior decision (BRE-XXX): Q: ... → A: ...").
   - **Moderate score (0.3–0.7)** → **Keep the question** but use the memory content as evidence to strengthen the recommendation. Reference it in the option description.
   - **No results or score < 0.3** → Proceed as before (codebase-grounded recommendation from `CODEBASE_CONTEXT`).

   This step reduces redundant questions across pipeline runs.

7. **Generate Questions** (max 3 for orchestrated mode)

   For each critical ambiguity (not skipped in step 6b):
   - Create 2-4 distinct options
   - **Ground the recommended option using this priority order:**
     1. **Prior clarification decision from memory** (strongest — explicit human choice from a prior run; cite the source decision)
     2. **Codebase convention from scan** (current — pattern observed in `CODEBASE_CONTEXT`; cite the file/line)
     3. **Generic best practice** (weakest — fallback only when no project-specific evidence exists)
   - For **Refactor** tickets: recommendations should preserve existing patterns unless the ticket explicitly calls for changing them.
   - For **New Feature** tickets: recommendations should extend the patterns found in analogous features.
   - Make recommendation the first option
   - Add "(Recommended)" to its description

8. **Ask Questions / Resolve**

   Use a `QuestionCollector` (from `.gravitas/lib/pipeline/questions.ts`) to collect ALL findings first, then call `resolveAndApply()`.

   **Decision tree (check in this order):**
   1. `AUTONOMOUS_MODE=true` AND `INTERACTIVE_MODE=false` → **8a** (non-interactive batch — orchestrator resolves)
   2. `AUTONOMOUS_MODE=false` AND `INTERACTIVE_MODE=true` → **8b** (interactive — human resolves via AskUserQuestion)
   3. `AUTONOMOUS_MODE=true` AND `INTERACTIVE_MODE=true` → **8c** (auto-resolve fallback — only when pipeline config explicitly sets `interactive.enabled: true`)

   **The common orchestrated case is 8a.** When pipeline.json has no `interactive` field, `INTERACTIVE_MODE=false`, so autonomous pipelines always use the batch protocol.

   ### 8a. NON-INTERACTIVE MODE (when `INTERACTIVE_MODE=false`)

   > **This is the DEFAULT for orchestrated pipelines (AUTONOMOUS_MODE=true).** Enter this path when `INTERACTIVE_MODE=false`.

   **Re-entry detection:** Before collecting questions, check if resolutions already exist from a previous round:

   ```bash
   RESOLUTIONS_PATH=$(bun .gravitas/scripts/orchestrator/resolve-path.ts {ticket_id} resolutions clarify 1)
   ```

   If `$RESOLUTIONS_PATH` exists (use `test -f "$RESOLUTIONS_PATH"`), this is a **re-dispatch** from the orchestrator. Read the resolutions file at that path, apply them to the spec (update sections, add clarifications), then skip to emitting the completion signal. Do NOT re-collect questions or re-emit the questions signal.

   **First entry (no resolutions):** Collect ALL questions, write them using the CLI, and **end your response**. Do NOT poll or wait for resolutions — the orchestrator will:
   1. Receive the questions signal
   2. Gather context, synthesize answers, write resolutions
   3. Re-dispatch `/gravitas.clarify` to this agent pane

   **Write findings using the CLI** (this writes the correct schema and emits the signal automatically):

   ```bash
   cat <<'EOF' | bun .gravitas/scripts/emit-findings.ts --phase clarify --round 1 --stdin
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

   After the CLI runs, output: "Emitted questions batch with {N} questions. Waiting for orchestrator to resolve." then **END RESPONSE** — do not wait, do not poll.

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

9b. **Memory Write** (after integrating each answer)

   For each answered question, write the decision to the clarify Mind's daily log:

   ```bash
   bun minds/memory/lib/write-cli.ts --mind clarify --content "{TICKET_ID}: Q: <question> → A: <answer>. Reasoning: <why>. Codebase evidence: <files cited>."
   ```

   This enables future pipeline runs to skip redundant questions by finding prior decisions in step 6b.

10. **Validation**
   - One bullet per answer in Clarifications section
   - Max 3 questions asked total
   - No contradictory statements remain
   - Terminology consistent across sections

11. **Emit Completion Signal**
   ```bash
   bun .gravitas/handlers/emit-signal.ts complete "Clarification phase finished"
   ```
   **CRITICAL**: This signal emission is MANDATORY for orchestrated workflows. Without it, the orchestrator will wait indefinitely.

12. **Report Completion**
   - Number of questions answered
   - Sections updated
   - Path to updated spec
   - Suggest `/gravitas.plan` as next command

## Signal Flow

**Autonomous mode:** Steps 4-5 (classification + scan) still run. Steps 8a auto-selects recommended options (grounded in codebase context) and proceeds directly to integration.

**Interactive mode:**
1. Agent emits a question signal via `bun .gravitas/handlers/emit-signal.ts question "question§option1§option2§..."`
2. Orchestrator receives signal → reads question + options directly from signal `detail` field (no screen capture)
3. Agent calls AskUserQuestion
4. Orchestrator reasons with ticket context, navigates tmux to select best option
5. Agent receives answer, integrates into spec
6. Repeat for remaining questions
7. After all questions: Agent explicitly calls `emit-signal.ts complete` to emit a completion signal

## Key Differences from Standard Clarify

- **Uses AskUserQuestion tool** (signal-emitting) instead of custom formatting
- **Max 3 questions** instead of 5 (orchestrated workflows are faster)
- **Recommendations in option descriptions** (orchestrator can auto-select)
- **Works in orchestrated pipeline** (proper signal protocol)
