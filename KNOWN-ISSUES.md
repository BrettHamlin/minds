# Known Issues - Collab Autonomous Orchestration System

**Last Updated**: 2026-02-16
**Validation Run**: BRE-202 (Codebase Pattern Analyzer CLI Tool)

This document tracks issues discovered during end-to-end validation of the autonomous orchestration workflow. Issues are prioritized by severity and impact on workflow completion.

---

## Critical Issues

### 1. Signal Emission Not Automatic After Implementation Phase ✅ FIXED

**Severity**: Critical (blocks workflow progression)  
**Phase**: Implement  
**File**: `src/commands/collab.implement.md`  
**Status**: ✅ **RESOLVED** (2026-02-17, commit 7df91b6)

**Problem**:
After the agent completes all implementation tasks and all tests pass, the workflow does not automatically emit the `IMPLEMENT_COMPLETE` signal. The controller remains stuck at "Waiting for signal..." indefinitely.

**Root Cause**:
The implementation phase instructions in `collab.implement.md` included signal emission as step 10, but agents treated this as optional or informational rather than as a required execution step.

**Solution Implemented**:
Created `.collab/scripts/verify-and-complete.sh` script that:
- Verifies all tasks in tasks.md are marked complete [X]
- Automatically emits the completion signal to orchestrator
- Fails fast with clear error if conditions not met

Updated `collab.implement.md` to:
- Reference the verification script in the Orchestrator Signal Contract
- Replace step 10 with explicit call to verification script
- Make completion checking automatic and harder to skip

**Validation Status**: Needs testing in next workflow run

**Impact (before fix)**: Every implementation phase required manual intervention to proceed to BlindQA.  
**Impact (after fix)**: Signal emission is now automatic when agent completes the phase.

---

## High Priority Issues

### 2. Signal Validation Script Expansion Error ✅ FIXED

**Severity**: High (causes retry delays)  
**Phase**: All (affects workflow initialization)  
**File**: `src/commands/collab.run.md`  
**Status**: ✅ **RESOLVED** (2026-02-17, commit 9350789)

**Problem**:
During signal validation, the script attempted to expand `$SCRIPTS` variable but failed with exit code 127. The validation would retry and eventually succeed, but this added ~5-10 seconds of delay to workflow startup.

**Error Output (before fix)**:
```
/bin/sh: Scripts: command not found
[exit code 127]
```

**Root Cause**:
Shell variable expansion inconsistency. The `$SCRIPTS` variable wasn't reliably set before commands that used it, causing partial or failed expansions.

**Solution Implemented**:
Replaced all 32 occurrences of `$SCRIPTS/...` with explicit relative paths `.collab/scripts/orchestrator/...`. This eliminates dependency on shell variable expansion and makes all script paths explicit and reliable.

**Validation Status**: Needs testing in next workflow run

**Impact (before fix)**: Added 5-10 second startup delay and console noise on every workflow initialization.  
**Impact (after fix)**: Script paths resolve immediately without expansion errors or retries.

---

### 3. Analyze Phase - No Orchestrator-Agent Fix Cycle ✅ FIXED

**Severity**: Medium-High  
**Phase**: Analyze  
**File**: `src/commands/collab.analyze.md`, `src/commands/collab.run.md`  
**Status**: ✅ **RESOLVED** (2026-02-17, commit f550c73)

**Problem**:
The analyze phase detected issues but had no mechanism to enforce fixes. CRITICAL issues would be reported but the workflow would proceed anyway, potentially causing problems in later phases.

**Root Cause**:
The Analyze Review Gate in the orchestrator was minimal ("Must explicitly approve") and didn't enforce resolution of CRITICAL findings.

**Solution Implemented**:
Added orchestrator-driven fix cycle matching the "NO EXCUSES" pattern from implement phase:

1. **Orchestrator captures and parses analysis report** for severity counts
2. **If CRITICAL > 0**: Rejects completion and sends issues back to agent
3. **Agent fixes issues** in spec.md/plan.md/tasks.md
4. **Re-runs analysis** and re-emits signal
5. **Cycle repeats** until CRITICAL = 0 or max attempts (3) reached
6. **HIGH/MEDIUM/LOW findings** are acceptable and don't block progression

Updated `collab.analyze.md` to use `verify-and-complete.sh` and document the fix cycle.

**Validation Status**: Needs testing in next workflow run

**Impact (before fix)**: CRITICAL issues would be reported but not enforced, potentially causing downstream failures.  
**Impact (after fix)**: CRITICAL issues must be resolved before proceeding to implementation.

---

## Medium Priority Issues

### 4. BlindQA Fix Loop Implementation Gap

**Severity**: Medium  
**Phase**: BlindQA  
**File**: `src/commands/collab.blindqa.md`

**Problem**:
BlindQA phase specification calls for orchestrator-driven fix loop with specific rules:
- Max 10 fix attempts
- High-severity findings block completion
- Medium/low findings are acceptable

However, the implementation of this loop needs refinement based on validation results.

**Expected Behavior**:
Orchestrator should automatically:
1. Review BlindQA findings
2. Determine severity
3. Send high-severity issues to agent
4. Wait for fixes
5. Re-run BlindQA
6. Repeat until resolved or max attempts reached

**Current Status**:
Specification exists but validation did not reach BlindQA phase due to Issue #1.

**Proposed Fix**:
After resolving Issue #1, validate BlindQA fix loop behavior and refine as needed.

**Impact**: Cannot assess until BlindQA phase is validated.

---

### 5. Clarify Phase - Question Quality Issues

**Severity**: Medium  
**Phase**: Clarify  
**File**: `src/commands/collab.clarify.md`

**Problem**:
Some clarify phase questions are inconsistent or poorly formatted:
- Multiple choice options sometimes lack clear structure
- Question phrasing can be ambiguous
- Recommended options not always provided

**Expected Behavior**:
All clarify questions should:
- Have clear, concise phrasing
- Provide well-structured multiple choice options when applicable
- Include recommended/sensible defaults to keep workflow moving

**Examples from BRE-202**:
- Pattern detection question: Clear, good options
- Interface question: Clear, good recommendation
- Tie-breaking question: Could use improvement in option structure

**Proposed Fix**:
Review and refine clarify question generation logic to ensure consistency.

**Impact**: Minor friction during clarify phase, but does not block workflow.

---

## Low Priority Issues

### 6. UI - Truck Animation in Status Bar

**Severity**: Low (cosmetic)  
**Phase**: All  
**File**: `src/Claude/statusBar.ts` (presumed)

**Problem**:
The status bar includes a truck animation (🚛) that may be unnecessary or distracting.

**Action Items**:
- Evaluate whether animation adds value
- Consider removal or replacement with simpler indicator
- Gather user feedback during broader validation

**Impact**: Cosmetic only.

---

## Performance Optimization Opportunities

### 7. Model Selection for Monitoring Tasks

**Severity**: Low (cost optimization)  
**Phase**: All (affects monitoring overhead)

**Observation**:
First validation run used Sonnet for all monitoring/orchestration tasks. This works well but may be more expensive than necessary.

**Proposed Evaluation**:
Test Haiku for:
- Status monitoring
- Registry checks
- Simple orchestrator decisions

Sonnet may still be needed for:
- Complex spec generation
- Ambiguity resolution
- Quality assessments

**Impact**: Potential cost savings without sacrificing quality.

---

## Validation Completion Status

- [x] Specify phase
- [x] Clarify phase
- [x] Plan phase
- [x] Tasks phase
- [x] Analyze phase
- [x] Implement phase
- [ ] **BlindQA phase** - blocked by Issue #1
- [ ] **Done phase** - not reached

**Next Steps**:
1. Fix Issue #1 (signal emission)
2. Re-run validation to complete BlindQA and Done phases
3. Update this document with findings
4. Address remaining issues in priority order
