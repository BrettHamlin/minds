---
description: Orchestrator-compatible spec clarification using AskUserQuestion for signal emission
---

## User Input

```text
$ARGUMENTS
```

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

   a) **FIRST: Send CLARIFY_QUESTION signal to orchestrator**

   Run this Bash command to emit the signal BEFORE calling AskUserQuestion:
   ```bash
   bun ~/.claude/hooks/handlers/emit-question-signal.ts "<question text>"
   ```

   This is MANDATORY. The signal must be sent before the question appears on screen so the orchestrator can capture it.

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

   **CRITICAL**: Signal MUST be sent via Bash before AskUserQuestion is called. This is deterministic and under our control.

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

8. **Report Completion**
   - Number of questions answered
   - Sections updated
   - Path to updated spec
   - Suggest `/relay.plan` as next command

## Signal Flow

1. Agent calls AskUserQuestion
2. PreToolUse hook fires → emits `[SIGNAL:BRE-X:nonce] CLARIFY_QUESTION | <question>`
3. Orchestrator receives signal
4. Orchestrator captures screen, reads options
5. Orchestrator navigates tmux to select answer (based on "Recommended" option)
6. Agent receives answer, integrates into spec
7. Repeat for remaining questions
8. After all questions: Stop hook emits `CLARIFY_COMPLETE`

## Key Differences from Standard Clarify

- **Uses AskUserQuestion tool** (signal-emitting) instead of custom formatting
- **Max 3 questions** instead of 5 (orchestrated workflows are faster)
- **Recommendations in option descriptions** (orchestrator can auto-select)
- **Works in orchestrated pipeline** (proper signal protocol)
