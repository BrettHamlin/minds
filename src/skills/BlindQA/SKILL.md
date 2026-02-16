---
name: BlindQA
description: Adversarial blind verification skill. Spins up a clean QA agent with ZERO implementation context — only what to test, how to test it, and pass criteria. The agent's job is to try to BREAK the implementation, not confirm it. USE WHEN blind qa, verify blind, skeptical qa, skeptical verify, independent verification, qa gate, blind test.
---

# BlindQA — Adversarial Blind Verification

**The final gate before any implementation is declared complete.**

## Voice Notification

**When executing a workflow, do BOTH:**

1. **Send voice notification**:
   ```bash
   curl -s -X POST http://localhost:8888/notify \
     -H "Content-Type: application/json" \
     -d '{"message": "Running the BlindVerify workflow in the BlindQA skill to perform adversarial verification"}' \
     > /dev/null 2>&1 &
   ```

2. **Output text notification**:
   ```
   Running the **BlindVerify** workflow in the **BlindQA** skill to perform adversarial verification...
   ```

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **BlindVerify** | "blind qa", "verify blind", "independent verification" | `Workflows/BlindVerify.md` |

**Flag Support**:
- `--interactive`: Enables interactive resolution mode (presents issues one-by-one with guided fixes)
- Default (no flag): Batch text report mode (all issues listed at once)

## Examples

**Example 1: Verify a Linear ticket implementation (default mode)**
```
User: "/blind-qa BRE-134"
-> Invokes BlindVerify workflow
-> Reads ticket, extracts ONLY verification table + expected behavior
-> Strips all implementation context (files changed, approach, git info)
-> Spawns QATester agent with clean test spec
-> Returns pass/fail verdict with screenshot evidence for each check
-> Output: Text report listing all issues
```

**Example 2: Verify with interactive resolution**
```
User: "/blind-qa BRE-134 --interactive"
-> Invokes BlindVerify workflow with interactive mode enabled
-> Performs same adversarial verification as default mode
-> QATester finds issues and returns them to orchestrator
-> Instead of dumping all issues as text:
   - Presents Issue 1 of N via AskUserQuestion
   - User selects resolution option
   - Fix applied immediately via Edit/Write/Bash
   - Moves to Issue 2 of N automatically
   - Continues until all issues resolved or skipped
-> Output: "✅ 2 issues fixed, 1 skipped, 3 total"
```

**Example 3: Verify with a manual spec**
```
User: "Run blind QA on the pagination changes — check that page 2 loads, dark mode works, and empty state is correct on localhost:1313"
-> Invokes BlindVerify workflow
-> Composes verification spec from user description
-> Spawns QATester with adversarial mindset
-> Returns evidence-backed verdicts
```

**Example 4: Post-implementation gate**
```
Orchestrating agent: "Implementation complete. Run BlindQA as Phase 2 verification."
-> Invokes BlindVerify workflow
-> Extracts test spec from ticket
-> QATester actively tries to BREAK the implementation
-> Any failure = implementation goes back for fixes + full re-verification
```

**Interactive Mode Output Example**:
```
❌ BLIND QA: FAILED (3 issues found)
Starting interactive resolution...

━━━ Issue 1 of 3 ━━━
ID: V1-dark-mode
Severity: High
Finding: Dark mode toggle button not visible in header
Evidence: /tmp/screenshot-123.png

How would you like to resolve this?
[User selects: "Add toggle button to header component"]
✓ Fixed: Added dark mode toggle to header component
Moving to next issue...

━━━ Interactive resolution complete ━━━
✅ 2 issues fixed, 1 skipped, 3 total
Skipped: V3-mobile-viewport (manual review needed)
```

## Quick Reference

- **Agent type**: QATester (subagent_type=QATester)
- **Input**: Linear ticket ID or manual verification spec
- **Output**: Pass/fail verdict with evidence (screenshots, DOM extracts) for each check
- **Constitution**: Implements Two-Phase Verification (Phase 2 — the final gate)
- **All-or-Nothing**: Any single failure invalidates the entire run

**Full Documentation:**
- Principles & philosophy: `BlindQAPrinciples.md`
- BlindVerify workflow: `Workflows/BlindVerify.md`
