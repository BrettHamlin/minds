<!--
SYNC IMPACT REPORT
==================
Version Change: INITIAL → 1.0.0
Rationale: First formal constitution with foundational principles

Added Principles:
- I. Source Directory Authority (new)

Template Status:
- .specify/templates/plan-template.md: ⚠ pending review
- .specify/templates/spec-template.md: ⚠ pending review
- .specify/templates/tasks-template.md: ⚠ pending review
- .specify/templates/commands/*.md: ⚠ pending review

Follow-up TODOs:
- Review dependent templates for alignment with source-first principle
- Consider adding additional principles as project matures
-->

# Collab Project Constitution

## Core Principles

### I. Source Directory Authority

**All project modifications MUST be made within the local source directory (`src/`) of the repository, not in external or global directories.**

This principle ensures:

- **Version Control**: All changes are tracked in the repository's git history
- **Portability**: Project functionality remains self-contained and transferable across environments
- **Reproducibility**: Other developers can clone and run without external dependencies on global state
- **Isolation**: Project configuration does not pollute or depend on global directories (e.g., `~/.claude/skills/`)

**Rationale**: When AI agents or developers modify shared functionality (skills, configurations, utilities), those modifications must live in the project's `src/` directory structure. This prevents the anti-pattern of updating global/external directories that are neither versioned with the project nor portable across development environments.

**Examples**:
- ✅ **Correct**: Modify `src/skills/SpecCritique/Workflows/Critique.md`
- ❌ **Incorrect**: Modify `~/.claude/skills/SpecCritique/Workflows/Critique.md`

**Exception**: Reading from global directories for reference is acceptable; writing/modifying is not.

## Governance

### Amendment Process

1. **Proposal**: New principles or amendments must be documented with clear rationale
2. **Version Bump**: Follow semantic versioning (MAJOR.MINOR.PATCH)
   - MAJOR: Principle removal or incompatible redefinition
   - MINOR: New principle added
   - PATCH: Clarification or wording improvement
3. **Template Sync**: Update dependent templates (`.specify/templates/*.md`) for consistency
4. **Review**: Validate no principles conflict or create ambiguity

### Compliance

- All development work must align with constitutional principles
- Pull requests should reference relevant principles when applicable
- Violations should be caught in code review or automated checks

### Living Document

This constitution will evolve as the project matures. Principles should be:
- **Declarative**: State what MUST be done, not suggestions
- **Testable**: Verifiable through inspection or automated checks
- **Justified**: Include rationale explaining why the principle matters

**Version**: 1.0.0 | **Ratified**: 2026-02-16 | **Last Amended**: 2026-02-16
