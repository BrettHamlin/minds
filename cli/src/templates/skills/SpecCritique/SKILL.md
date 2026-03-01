---
name: SpecCritique
description: Adversarial specification analysis skill. Analyzes Linear ticket specifications to find gaps, ambiguities, and missing details BEFORE implementation. USE WHEN spec critique, analyze spec, harden spec, validate spec, review spec, OR checking spec quality before coding.
---

# SpecCritique

Adversarial specification analysis for hardening specs before implementation.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Critique** | "spec critique", "analyze spec", "harden spec" | `Workflows/Critique.md` |

## Core Principles

**Based on BlindQA adversarial approach, but for spec text:**

- **No code testing** - Analyzes spec text only, not running implementations
- **No browser automation** - Uses AskUserQuestion for clarification, not screenshots
- **Finds gaps** - Missing requirements, ambiguities, edge cases, unclear terminology
- **Severity ranking** - HIGH (blockers), MEDIUM (important), LOW (nice to have)
- **Iterative loop** - Re-analyzes after fixes until zero HIGH severity issues
- **Quality gate** - Must resolve all HIGH issues before proceeding

## Analysis Categories

Specs are analyzed across these dimensions:

- **Functional Scope** - Out-of-scope items, user roles, permissions
- **Data Model** - Primary keys, relationships, scale expectations
- **UX Flow** - Error states, loading states, edge case handling
- **Non-Functional** - Performance targets, observability, monitoring
- **Integration** - API contracts, failure modes, retry logic
- **Edge Cases** - Concurrency, validation, boundary conditions
- **Terminology** - Enum values, canonical terms, ambiguous words

## Examples

**Example 1: Validate preliminary spec (SpecCreator Step 5)**
```
SpecCreator: "Spec created, now running SpecCritique validation"
→ Invokes Critique workflow
→ Reads preliminary spec text
→ Identifies 8 issues: 3 HIGH, 3 MEDIUM, 2 LOW
→ Asks clarifying questions via AskUserQuestion for HIGH issues
→ Updates spec with answers
→ Re-analyzes: 0 HIGH, 2 MEDIUM, 1 LOW
→ Returns: "Spec hardened - zero blocking issues"
```

**Example 2: Standalone spec review**
```
User: "Run spec critique on BRE-191"
→ Invokes Critique workflow
→ Fetches Linear ticket
→ Analyzes spec for gaps
→ Finds: "User role permissions undefined (HIGH)"
→ Asks: "Which user roles can access this feature?"
→ Updates spec with clarification
→ Returns hardened spec
```

**Example 3: Post-edit validation**
```
User: "I updated the spec - validate it again"
→ Invokes Critique workflow
→ Reads updated spec
→ Checks for introduced ambiguities
→ Confirms: "No HIGH issues - spec is solid"
```

## Quality Gate

**SpecCritique enforces a quality gate:**

- Specs with HIGH severity issues CANNOT proceed to implementation
- Loop continues until all HIGH issues are resolved
- MEDIUM/LOW issues are flagged but don't block progression
- Iteration limit: 5 passes (safety valve)

## Use Cases

- **SpecCreator Step 5** - Validate preliminary spec before testing/dependencies steps
- **Pre-planning** - Harden spec before creating implementation plan
- **Post-edit** - Validate spec after manual changes
- **Standalone** - Review any Linear ticket spec for quality

