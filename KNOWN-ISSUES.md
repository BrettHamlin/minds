# Known Issues - Collab Autonomous Orchestration System

**Last Updated**: 2026-02-16
**Validation Run**: BRE-202 (Codebase Pattern Analyzer CLI Tool)

This document tracks issues discovered during end-to-end validation of the autonomous orchestration workflow. Issues are prioritized by severity and impact on workflow completion.

---

## Critical Issues

### 1. Signal Emission Not Automatic After Implementation Phase

**Severity**: Critical (blocks workflow progression)  
**Phase**: Implement  
**File**: `src/commands/collab.implement.md`

**Problem**:
After the agent completes all implementation tasks and all tests pass, the workflow does not automatically emit the `IMPLEMENT_COMPLETE` signal. The controller remains stuck at "Waiting for signal..." indefinitely.

**Expected Behavior**:
When the agent reaches the end of the implementation phase and all verification passes, it should automatically run:
```bash
bun .collab/handlers/emit-question-signal.ts complete "Implementation phase finished"
```

**Current Workaround**:
Manually emit the signal from the controller pane:
```bash
cd ~/Code/projects/collab
bun .collab/handlers/emit-question-signal.ts complete "Implementation phase finished"
```

**Root Cause**:
The implementation phase instructions in `collab.implement.md` include a "When you're done" section, but it appears the agent treats this as informational rather than as an actionable step to execute.

**Proposed Fix**:
Add explicit signal emission step to the end of the implementation phase workflow, possibly as part of the orchestrator's automatic progression after detecting completion criteria (all tasks done + all tests pass).

**Impact**: Without this fix, every implementation phase requires manual intervention to proceed to BlindQA.

---

## High Priority Issues

### 2. Signal Validation Script Expansion Error

**Severity**: High (causes retry delays)  
**Phase**: All (affects workflow initialization)  
**File**: `src/commands/collab.run.md`

**Problem**:
During signal validation, the script attempts to expand `$SCRIPTS` variable but fails with exit code 127. The validation retries and eventually succeeds, but this adds ~5-10 seconds of delay to workflow startup.

**Error Output**:
```
/bin/sh: Scripts: command not found
[exit code 127]
```

**Expected Behavior**:
Variable expansion should work on first attempt without errors.

**Current Workaround**:
None needed - the retry succeeds. But the error is noisy and delays startup.

**Root Cause**:
Likely a shell expansion issue where `$SCRIPTS` is not properly set or exported in the environment before the validation script runs.

**Proposed Fix**:
1. Ensure `SCRIPTS` variable is properly set before validation
2. Or use absolute path instead of variable expansion
3. Or improve error handling to fail fast on expansion errors rather than retry

**Impact**: Adds startup delay and console noise, but does not block workflow.

---

### 3. Analyze Phase - No Orchestrator-Agent Fix Cycle

**Severity**: Medium-High  
**Phase**: Analyze  
**File**: `src/commands/collab.analyze.md`

**Problem**:
The analyze phase detects issues in the codebase/design but does not provide a mechanism for the orchestrator to send fixes back to the agent. If critical issues are found, the workflow must manually intervene or proceed anyway.

**Expected Behavior**:
Similar to BlindQA, the orchestrator should be able to send high-severity issues back to the agent for fixes before allowing progression to the next phase.

**Current Behavior**:
Analyze phase completes and reports issues, but no automated fix loop exists.

**Proposed Fix**:
Add orchestrator-driven fix cycle to analyze phase:
- If high-severity issues found, orchestrator sends them to agent
- Agent addresses issues and re-runs analysis
- Cycle repeats until high-severity issues are resolved or max attempts reached

**Impact**: High-severity issues found in analyze phase currently go unfixed, potentially causing problems in later phases.

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
