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

Detect and reduce ambiguity in the active feature specification using AskUserQuestion tool for orchestrator compatibility.

## Execution Steps

1. **Prerequisites Check**
   ```bash
   .specify/scripts/bash/check-prerequisites.sh --json --paths-only
   ```
   Parse JSON to get `FEATURE_DIR` and `FEATURE_SPEC`.

2. **Load Spec**
   Read the spec file from `FEATURE_SPEC`.

3. **Ambiguity Scan**
   Analyze spec across taxonomy categories:
   - Functional Scope (out-of-scope, user roles)
   - Data Model (primary keys, relationships, scale)
   - UX Flow (error/loading states)
   - Non-Functional (performance, observability)
   - Integration (API contracts, failure modes)
   - Edge Cases (concurrency, validation)
   - Terminology (enum values, canonical terms)

   Mark each: Clear / Partial / Missing

4. **Generate Questions** (max 3 for orchestrated mode)

   For each critical ambiguity:
   - Create 2-4 distinct options
   - Identify recommended option using best practices
   - Make recommendation the first option
   - Add "(Recommended)" to its description

5. **Ask Questions Using AskUserQuestion Tool**

   For EACH question:

   a) **FIRST: Emit CLARIFY_QUESTION signal to orchestrator**

   Run this Bash command BEFORE calling AskUserQuestion:
   ```bash
   bun .collab/handlers/emit-question-signal.ts question "<question text>"
   ```

   This is MANDATORY in orchestrated mode. The orchestrator must receive the signal so it knows to capture the screen and navigate the UI. Without this signal, the orchestrator waits indefinitely.

   b) **THEN: Call AskUserQuestion tool**
   ```
   {
     questions: [{
       question: "<clear question text>",
       header: "<category name>",  // e.g., "Notification Types"
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

6. **Integrate Each Answer**

   After EACH answer:
   - Create/update `## Clarifications` section
   - Add `### Session YYYY-MM-DD` if new session
   - Append: `- Q: <question> → A: <answer>`
   - Update relevant sections (e.g., add enum to Database Schema)
   - **Save spec file immediately** (atomic write)

7. **Validation**
   - One bullet per answer in Clarifications section
   - Max 3 questions asked total
   - No contradictory statements remain
   - Terminology consistent across sections

8. **Emit Completion Signal**
   ```bash
   bun .collab/handlers/emit-question-signal.ts complete "Clarification phase finished"
   ```
   **CRITICAL**: This signal emission is MANDATORY for orchestrated workflows. Without it, the orchestrator will wait indefinitely.

9. **Report Completion**
   - Number of questions answered
   - Sections updated
   - Path to updated spec
   - Suggest `/collab.plan` as next command

## Signal Flow

1. Agent emits `CLARIFY_QUESTION` via `bun .collab/handlers/emit-question-signal.ts question "..."`
2. Orchestrator receives signal → captures agent screen, reads options
3. Agent calls AskUserQuestion
4. Orchestrator navigates tmux to select answer (based on "Recommended" option)
5. Agent receives answer, integrates into spec
6. Repeat for remaining questions
7. After all questions: Agent explicitly calls `emit-question-signal.ts complete` to emit `CLARIFY_COMPLETE`

## Key Differences from Standard Clarify

- **Uses AskUserQuestion tool** (signal-emitting) instead of custom formatting
- **Max 3 questions** instead of 5 (orchestrated workflows are faster)
- **Recommendations in option descriptions** (orchestrator can auto-select)
- **Works in orchestrated pipeline** (proper signal protocol)
