---
description: iOS verify phase — navigate to the feature on simulator, verify spec criteria, emit VERIFY_PASS/FAIL/BLOCKED/QUESTION signal.
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-237)

## Goal

Verify the iOS feature described in the ticket spec by navigating the running simulator and checking exact acceptance criteria. Reads build metadata written by the iosbuild phase. Emits a deterministic signal to the orchestrator.

## Execution Steps

### 1. Validate Input

Parse `ticket_id` from `$ARGUMENTS`. If missing, output "Usage: /collab.iosverify <ticket-id>" and stop.

### 2. Verify Registry State

```bash
REGISTRY_PATH=$(bun .collab/scripts/orchestrator/resolve-path.ts ${ticket_id} registry)
test -f "$REGISTRY_PATH" || { echo "Not in orchestrated mode"; exit 1; }
```

Check current_step is "iosverify":
```bash
cat "$REGISTRY_PATH" | grep '"current_step".*"iosverify"' || echo "Warning: not in iosverify phase"
```

### 3. Read Build Output Artifact

```bash
cat .collab/state/build-output-${ticket_id}.json
```

**Required fields from build output:**
- `simulator_udid` — the booted simulator to verify against
- `bundle_id` — the app bundle to launch
- `app_name` — for logging

**If the file is missing or result != "success":**
```bash
bun .collab/handlers/emit-verify-signal.ts blocked "build-output-${ticket_id}.json missing or build did not succeed. Run iosbuild first."
```
Stop.

### 4. Read Verification Config from Spec

```bash
cat specs/${ticket_id}/spec.md
```

Look for an `## iOS Verification` section with:
- `feature_name` — human-readable feature description (required)
- `navigation_path` — ordered list of UI steps to reach the feature (required)
  - Example: `["Map tab", "(i) info button", "Settings"]`
- `verification_spec` — exact criteria to check (required)
  - Example: `{ "element": "Tracking", "expected_value": "On", "help": "Change tracking options" }`

**If any required verification field is missing:**
```bash
bun .collab/handlers/emit-verify-signal.ts needs_clarification "Verification spec incomplete. Add '## iOS Verification' section to specs/${ticket_id}/spec.md§Spec has correct iOS Verification section (Recommended)§Skip verification"
```
Stop.

### 5. Invoke IosVerify Skill

Use the Skill tool to invoke the IosVerify Verify workflow, passing:

```
Skill: IosVerify
Args:
  feature_name: {feature_name}
  navigation_path: {navigation_path}
  verification_spec: {verification_spec}
  simulator_udid: {simulator_udid}
  bundle_id: {bundle_id}
```

The skill handles: app launch, navigation (fuzzy/semantic), arrival confirmation, exact verification, and returns one of:
- `pass` — all criteria met with evidence
- `fail` — one or more criteria failed with detail
- `blocked` — could not reach verification state (simulator issue, crash, etc.)
- `needs_clarification` — spec is incomplete or ambiguous

### 6. Emit Signal Based on Result

**On `pass`:**
```bash
bun .collab/handlers/emit-verify-signal.ts pass "{summary of what was verified with evidence}"
```

**On `fail`:**
```bash
bun .collab/handlers/emit-verify-signal.ts fail "{which criteria failed and why}"
```
Pipeline routes back to implement phase for the agent to fix the code.

**On `blocked`:**
```bash
bun .collab/handlers/emit-verify-signal.ts blocked "{reason verification was blocked, e.g. simulator crash}"
```
Pipeline retries iosverify.

**On `needs_clarification`:**
```bash
bun .collab/handlers/emit-verify-signal.ts needs_clarification "Question text§Option A (Recommended)§Option B"
```
Orchestrator answers, then iosverify is re-dispatched.

## Signal Protocol

- **VERIFY_PASS** — Feature verified. Pipeline advances to done.
- **VERIFY_FAIL** — Feature broken. Pipeline routes back to implement.
- **VERIFY_BLOCKED** — Infrastructure issue. Pipeline retries iosverify.
- **VERIFY_QUESTION** — Orchestrator Q&A. Pipeline stays at iosverify while orchestrator answers.

## Spec Section Format

Add this to the ticket spec (`specs/{ticket_id}/spec.md`) for iOS tickets:

```markdown
## iOS Verification

**feature_name:** Location tracking dot visible on map

**navigation_path:**
1. Map tab
2. (tap map to dismiss any overlays)

**verification_spec:**
- element: the location marker dot (AXGenericElement with "Shows more info" help text)
- expected: visible at approximately screen center
- evidence: screenshot showing dot position
```

## Design Notes

- `simulator_udid` and `bundle_id` come from build-output artifact — iosverify never re-derives them.
- The spec is the source of truth for navigation path and acceptance criteria.
- IosVerify skill handles all idb interactions; this command only orchestrates and signals.
- On VERIFY_FAIL → implement: the agent gets the failure detail in the signal and can read build/verify logs to understand what needs fixing.
