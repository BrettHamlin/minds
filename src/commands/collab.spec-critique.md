---
description: Orchestrator-compatible spec validation with deterministic signal emission and iterative loop
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-191)

## Goal

Execute adversarial specification analysis to find gaps, ambiguities, and missing details BEFORE implementation. Emit deterministic signals to orchestrator for pipeline integration. Loop until zero HIGH severity issues remain.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, error and exit.

### 2. Detect Execution Mode

Check if autonomous (orchestrated) mode is active:

```bash
REGISTRY_FILE=".collab/state/pipeline-registry/${ticket_id}.json"
AUTONOMOUS_MODE=false

if [ -f "$REGISTRY_FILE" ]; then
  current_step=$(jq -r '.current_step // ""' "$REGISTRY_FILE")
  if echo "$current_step" | grep -qi "spec.critique\|spec_critique"; then
    AUTONOMOUS_MODE=true
    echo "[spec-critique] Autonomous mode detected (registry step: $current_step)"
  fi
fi
```

Use Glob to find the registry file if the path is uncertain (e.g., `Glob(".collab/state/pipeline-registry/${ticket_id}.json")`).

**`AUTONOMOUS_MODE=true`** → pipeline orchestrator launched this skill; nobody is watching; **DO NOT use AskUserQuestion**. Proceed to Step 4a.

**`AUTONOMOUS_MODE=false`** → interactive (standalone) invocation; user is present. Proceed to Step 4b.

### 3. Emit SPEC_CRITIQUE_START Signal

Run:
```bash
bun .collab/handlers/emit-spec-critique-signal.ts start "Starting spec analysis for ${ticket_id}"
```

This is MANDATORY before analysis begins so orchestrator can track progress.

---

### 4a. AUTONOMOUS MODE — Analyze Without User Interaction

> **Only enter this path when `AUTONOMOUS_MODE=true`. Skip to Step 4b otherwise.**

In autonomous mode the skill must complete analysis and emit a terminal signal without waiting for user input. Follow these steps:

#### 4a-1. Fetch Linear Ticket

```
Use Linear MCP tool:
mcp__plugin_linear_linear__get_issue({ id: ticket_id })

Extract:
- Title
- Description (full spec text)
- Type (Feature/Bug/Research)
```

#### 4a-2. Analyze Specification (All 7 Categories)

Perform adversarial analysis across every category:

1. **Functional Scope** — out-of-scope items, user roles/permissions, actors/stakeholders
2. **Data Model** (if applicable) — primary keys, relationships, data scale/volume
3. **UX Flow** — error states, loading states, edge cases
4. **Non-Functional** — performance targets, observability/monitoring, rate limits
5. **Integration** — API contracts, failure modes, retry logic
6. **Edge Cases** — concurrency, validation, boundary conditions
7. **Terminology** — enum values, ambiguous terms, consistency

Rank each issue:
- **HIGH**: Blocking — spec cannot proceed without resolution
- **MEDIUM**: Important but not blocking
- **LOW**: Nice to have

#### 4a-3. Auto-Resolve Issues (No AskUserQuestion)

For each identified issue, apply the auto-resolution strategy:

**Strategy A — Recommended option available:**
- Identify the option that would be recommended to a user (the most common, safe, or conservative choice for the domain)
- Record the decision: `"[AUTONOMOUS] Picked recommended option: <option description>"`
- Mark the issue as RESOLVED

**Strategy B — No clear recommended option:**
- Document the ambiguity in the analysis output
- Record: `"[UNRESOLVED] Ambiguity documented: <issue description>. No safe default. Requires human clarification."`
- HIGH issues that remain UNRESOLVED count toward blocking

**Strategy C — Issue is informational (MEDIUM/LOW only):**
- Document it in the output without blocking
- Record: `"[NOTED] <issue description>"`

**Auto-resolution rules:**
- Never leave a HIGH issue silently; either resolve it with Strategy A or mark it UNRESOLVED with Strategy B
- Prefer Strategy A when the spec domain (e.g., REST API, CLI tool, data pipeline) has an obvious safe default
- Use Strategy B when the question is fundamentally about business intent (e.g., "Which user roles have access?") — these cannot be inferred safely

#### 4a-4. Produce Autonomous Analysis Report

Write a structured report to stdout (and optionally to `.collab/state/${ticket_id}-spec-critique.md`):

```markdown
## Autonomous SpecCritique Report — ${ticket_id}

**Mode:** AUTONOMOUS (pipeline-driven)
**Timestamp:** ${ISO_TIMESTAMP}

### Summary
- HIGH severity: ${HIGH_COUNT} found → ${HIGH_RESOLVED} auto-resolved, ${HIGH_UNRESOLVED} unresolved
- MEDIUM severity: ${MEDIUM_COUNT}
- LOW severity: ${LOW_COUNT}

### HIGH Issues

1. **[Category]** Issue description
   - Resolution: [AUTONOMOUS] Picked recommended option: ... | [UNRESOLVED] Ambiguity documented: ...

### MEDIUM Issues

1. **[Category]** Issue description — [NOTED]

### LOW Issues

1. **[Category]** Issue description — [NOTED]

### Verdict

${VERDICT: HARDENED | BLOCKED | WARNING}
```

#### 4a-5. Determine Autonomous Verdict

```
if (HIGH_UNRESOLVED > 0):
  verdict = BLOCKED
  → Continue to Step 5, Case B
elif (HIGH_COUNT === 0 AND MEDIUM_COUNT === 0 AND LOW_COUNT === 0):
  verdict = HARDENED (clean)
  → Continue to Step 5, Case A
elif (HIGH_RESOLVED === HIGH_COUNT AND MEDIUM_COUNT + LOW_COUNT > 0):
  verdict = WARNING
  → Continue to Step 5, Case C
else:
  verdict = HARDENED (all HIGH resolved, MEDIUM/LOW acceptable)
  → Continue to Step 5, Case A
```

**Jump to Step 5 (skip Step 4b).**

---

### 4b. INTERACTIVE MODE — Invoke SpecCritique Skill

> **Only enter this path when `AUTONOMOUS_MODE=false`.**

Use the Skill tool to invoke SpecCritique:

```
Skill: SpecCritique
Args: ${ticket_id}

This will invoke the Critique workflow which will:
1. Fetch Linear ticket
2. Analyze spec for gaps across all categories
3. Identify HIGH/MEDIUM/LOW severity issues
4. Ask clarifying questions via AskUserQuestion for HIGH issues
5. Update spec with answers
6. Re-analyze until zero HIGH issues remain
7. Return final report
```

Parse the returned report to determine verdict (HARDENED / BLOCKED / WARNING), then continue to Step 5.

---

### 5. Evaluate Result

Parse the analysis output for verdict:

**Case A: HARDENED (zero HIGH issues)**
- All HIGH severity issues resolved (or none found)
- `result_signal=pass`
- `result_message="Spec hardened - ${issue_count} issues resolved"`

**Case B: BLOCKED (HIGH issues remain unresolved)**
- HIGH severity issues still present / could not be auto-resolved
- `result_signal=fail`
- `result_message="${high_issue_count} HIGH issues remain unresolved"`

**Case C: WARNING (only MEDIUM/LOW issues)**
- No HIGH issues, but MEDIUM or LOW issues present
- `result_signal=warn`
- `result_message="Spec usable but has ${medium_issue_count} MEDIUM, ${low_issue_count} LOW issues"`

---

### 6. MANDATORY Signal Emission

> **This step is UNCONDITIONAL. It runs regardless of verdict, mode, or any earlier error.**
> **The skill MUST NOT return before this step executes.**

Emit the terminal signal using the verdict determined in Step 5:

```bash
bun .collab/handlers/emit-spec-critique-signal.ts ${result_signal} "${result_message}"
```

Where `${result_signal}` is one of: `pass`, `warn`, `fail`.

If Step 5 was never reached due to an unexpected error, emit an error signal:
```bash
bun .collab/handlers/emit-spec-critique-signal.ts fail "Unexpected error during spec analysis - manual review required"
```

Then report the error details.

---

### 7. Output Summary

After signal emission, print the final status:

**Success (pass):**
```
✅ Spec analysis PASSED - all HIGH issues resolved
Mode: ${AUTONOMOUS_MODE ? "autonomous" : "interactive"}
Signal emitted: SPEC_CRITIQUE_PASS
```

**Warning (warn):**
```
⚠️ Spec analysis PASSED with warnings - MEDIUM/LOW issues remain
Mode: ${AUTONOMOUS_MODE ? "autonomous" : "interactive"}
Signal emitted: SPEC_CRITIQUE_WARN
```

**Failure (fail):**
```
❌ Spec analysis FAILED - HIGH issues remain
Mode: ${AUTONOMOUS_MODE ? "autonomous" : "interactive"}
Signal emitted: SPEC_CRITIQUE_FAIL
Unresolved issues: [list]
```

---

## Signal Protocol Summary

1. **SPEC_CRITIQUE_START** - Sent at beginning of analysis
2. **SPEC_CRITIQUE_PASS** - Sent when all HIGH issues resolved (or none found)
3. **SPEC_CRITIQUE_WARN** - Sent when only MEDIUM/LOW issues remain
4. **SPEC_CRITIQUE_FAIL** - Sent when HIGH issues remain unresolved

**Orchestrator Integration:**
- Orchestrator waits for SPEC_CRITIQUE_PASS or SPEC_CRITIQUE_WARN or SPEC_CRITIQUE_FAIL signal
- On PASS/WARN: Advance to next phase (planning)
- On FAIL: Halt pipeline, require manual intervention

## Example Invocations

**Autonomous mode (orchestrated):**
```
collab.spec-critique BRE-246
→ Registry found: current_step=spec_critique → AUTONOMOUS_MODE=true
→ Emit START
→ Fetch ticket, analyze, auto-resolve HIGH issues
→ Emit PASS/WARN/FAIL (always)
```

**Interactive mode (standalone):**
```
collab.spec-critique BRE-191
→ No registry match → AUTONOMOUS_MODE=false
→ Emit START
→ Invoke SpecCritique skill (with AskUserQuestion loop)
→ Emit PASS/WARN/FAIL (always)
```

## Design Rationale

This command follows the proven `collab.blindqa` pattern:
- **Deterministic signals** via explicit echo/bun calls (not hooks)
- **Orchestration boundary** separated from skill logic
- **Mode-aware execution** prevents AskUserQuestion blocking in headless pipeline runs
- **Unconditional signal emission** in Step 6 ensures orchestrator is never left waiting
- **SpecCritique skill stays clean** for standalone use (interactive mode unchanged)

Implements adapter pattern separating infrastructure (signaling) from domain (spec analysis).
