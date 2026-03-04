---
description: Orchestrator-compatible spec clarification using AskUserQuestion for signal emission
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

Detect and reduce ambiguity in the active feature specification. In autonomous pipeline mode, auto-resolve using recommended options. In interactive mode, use AskUserQuestion tool for orchestrator compatibility.

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

3. **Load Spec**
   Read the spec file from `FEATURE_SPEC`.

4. **Ambiguity Scan**
   Analyze spec across taxonomy categories:
   - Functional Scope (out-of-scope, user roles)
   - Data Model (primary keys, relationships, scale)
   - UX Flow (error/loading states)
   - Non-Functional (performance, observability)
   - Integration (API contracts, failure modes)
   - Edge Cases (concurrency, validation)
   - Terminology (enum values, canonical terms)

   Mark each: Clear / Partial / Missing

5. **Generate Questions** (max 3 for orchestrated mode)

   For each critical ambiguity:
   - Create 2-4 distinct options
   - Identify recommended option using best practices
   - Make recommendation the first option
   - Add "(Recommended)" to its description

6. **Ask Questions / Auto-Resolve**

   ### 6a. AUTONOMOUS MODE (when `AUTONOMOUS_MODE=true`)

   > **Only enter this path when `AUTONOMOUS_MODE=true`. Skip to Step 6b otherwise.**

   In autonomous mode, DO NOT call AskUserQuestion. Instead, auto-resolve each question:

   For each generated question:
   - Select the **recommended option** (the first option, marked with "(Recommended)")
   - Record the decision: `[AUTONOMOUS] Selected recommended: <option label>`
   - Proceed directly to integration (Step 7)

   This ensures the pipeline does not stall waiting for interactive input.

   ### 6b. INTERACTIVE MODE (when `AUTONOMOUS_MODE=false`)

   For EACH question:

   a) **FIRST: Emit CLARIFY_QUESTION signal to orchestrator**

   Run this Bash command BEFORE calling AskUserQuestion:
   ```bash
   bun .collab/handlers/emit-question-signal.ts question "<question text>§<label1> (Recommended)§<label2>§<label3>"
   ```

   Encode the question text and all option labels separated by `§`. Always put the recommended option first (matching the AskUserQuestion order). Labels only — no descriptions. Example:
   ```bash
   bun .collab/handlers/emit-question-signal.ts question "What step size?§2px§4px§Custom"
   ```

   This is MANDATORY in orchestrated mode. The orchestrator reads the question and options directly from the signal detail — no screen capture needed. Without this signal, the orchestrator waits indefinitely.

   b) **THEN: Call AskUserQuestion tool**
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
           label: "<option C>",
           description: "<trade-offs of this option>"
         },
         {
           label: "Custom answer",
           description: "Provide your own answer (will prompt for short text)"
         }
       ]
     }]
   }
   ```

   **IMPORTANT**: Always include "Custom answer" option so user can provide their own response if predefined options don't fit.

7. **Integrate Each Answer**

   After EACH answer:
   - Create/update `## Clarifications` section
   - Add `### Session YYYY-MM-DD` if new session
   - Append: `- Q: <question> → A: <answer>`
   - Update relevant sections (e.g., add enum to Database Schema)
   - **Save spec file immediately** (atomic write)

8. **Validation**
   - One bullet per answer in Clarifications section
   - Max 3 questions asked total
   - No contradictory statements remain
   - Terminology consistent across sections

9. **Emit Completion Signal**
   ```bash
   bun .collab/handlers/emit-question-signal.ts complete "Clarification phase finished"
   ```
   **CRITICAL**: This signal emission is MANDATORY for orchestrated workflows. Without it, the orchestrator will wait indefinitely.

10. **Report Completion**
   - Number of questions answered
   - Sections updated
   - Path to updated spec
   - Suggest `/collab.plan` as next command

## Signal Flow

**Autonomous mode:** Steps 1-4 are skipped entirely. Agent auto-selects recommended options and proceeds directly to integration.

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
