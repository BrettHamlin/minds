# Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| U1 | Underspecification | HIGH | spec.md:L45 | "User can submit form" has no error handling requirement | Add: specify what happens on validation failure |
| A1 | Ambiguity | MEDIUM | spec.md:L23 | "fast response" has no measurable threshold | Replace with "response within 500ms under normal load" |
| C1 | Coverage | HIGH | tasks.md | Requirement `user-can-reset` has zero associated tasks | Add task: implement password reset endpoint |

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| user-can-submit | Yes | T-01 | Covered |
| user-can-reset | No | — | MISSING COVERAGE |

**Metrics:**
- Total Requirements: 2
- Total Tasks: 1
- Coverage %: 50%
- Ambiguity Count: 1
- Duplication Count: 0
- Critical Issues Count: 0

**Next Actions:**
3 findings require remediation before proceeding with `/collab.implement`.
