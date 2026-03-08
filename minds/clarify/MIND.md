# Clarify Mind — Domain Profile

## Domain

The Clarify Mind owns the **pipeline clarify stage**: the process of detecting and
resolving ambiguity in a feature specification before implementation begins.

The clarify stage is the first active pipeline phase. It produces a structured
set of questions (findings), routes them through the orchestrator, receives answers
(resolutions), and updates the spec with clarifications.

---

## Key Files

| File | Role |
|------|------|
| `src/commands/collab.clarify.md` | Pipeline clarify command — the agent's execution instructions |
| `minds/clarify/server.ts` | Clarify Mind server — MCP capabilities for the clarify domain |
| `minds/clarify/group-questions.ts` | Finding grouping utility (`groupFindings()`) |
| `minds/pipeline_core/questions.ts` | Shared Q&A protocol: `Finding`, `FindingsBatch`, `QuestionCollector`, `resolveMode()` |
| `minds/pipeline_core/paths.ts` | `findingsPath()`, `resolutionsPath()` — deterministic file paths |
| `minds/signals/emit-question-signal.ts` | Emits `CLARIFY_QUESTION` / `CLARIFY_COMPLETE` signals |
| `minds/signals/emit-findings.ts` | Writes FindingsBatch + emits batch signal |

---

## Q&A Protocol

The clarify phase uses a **push-based, non-polling** question/answer flow:

### Batch (Non-Interactive) Mode — Default for Orchestrated Pipelines

1. Agent collects findings via `QuestionCollector`
2. Agent writes `findings/clarify-round-N.json` via `emit-findings.ts` CLI
3. Agent emits `CLARIFY_QUESTIONS` signal and **ends its response** (no polling)
4. Orchestrator receives signal → gathers context → writes `resolutions/clarify-round-N.json`
5. Orchestrator re-dispatches `/collab.clarify` to the agent pane
6. On re-entry, agent detects resolutions file → applies answers → emits `CLARIFY_COMPLETE`

### Interactive Mode — Manual Runs

1. Agent collects findings via `QuestionCollector`
2. For each finding, agent calls `AskUserQuestion` with structured options
3. User selects answer → agent wraps into `Resolution` object
4. Agent applies all resolutions → emits `CLARIFY_COMPLETE`

**Mode detection** is deterministic: `resolve-execution-mode.ts` reads `pipeline.json`.
Absence of `interactive` field in `pipeline.json` → non-interactive (batch) mode.

---

## Interactive vs Batch Decision Tree

```
AUTONOMOUS_MODE=true AND INTERACTIVE_MODE=false  → 8a (batch, orchestrator resolves)
AUTONOMOUS_MODE=false AND INTERACTIVE_MODE=true  → 8b (interactive, human resolves)
AUTONOMOUS_MODE=true AND INTERACTIVE_MODE=true   → 8c (auto-resolve recommended option)
```

The common orchestrated case is **8a**. Interactive mode requires `interactive.enabled: true`
in `pipeline.json` or manual invocation.

---

## Findings/Resolutions File Format

**Findings** (`findings/clarify-round-N.json`):
```json
{
  "phase": "clarify",
  "round": 1,
  "ticketId": "BRE-XXX",
  "findings": [
    {
      "id": "f1",
      "question": "Open-ended question for orchestrator",
      "context": {
        "why": "Why this matters",
        "specReferences": ["Section 3.2 mentions Y"],
        "codePatterns": ["src/foo.ts uses pattern Z"],
        "constraints": ["Must not break existing API"],
        "implications": ["Determines migration strategy"]
      }
    }
  ],
  "specExcerpt": "Relevant spec content"
}
```

**Resolutions** (`resolutions/clarify-round-N.json`):
```json
{
  "phase": "clarify",
  "round": 1,
  "resolutions": [
    {
      "findingId": "f1",
      "answer": "Use approach X",
      "reasoning": "Because existing pattern in src/bar.ts uses X",
      "sources": ["src/bar.ts"]
    }
  ]
}
```

---

## Signal Constants

From `minds/signals/pipeline-signal.ts` and `minds/pipeline_core/types.ts`:

| Constant | Value | When |
|----------|-------|------|
| `CLARIFY_COMPLETE` | `"CLARIFY_COMPLETE"` | Phase finished, all questions resolved |
| `CLARIFY_QUESTION` | `"CLARIFY_QUESTION"` | Interactive mode: question asked |
| `CLARIFY_ERROR` | `"CLARIFY_ERROR"` | Phase encountered an error |
| `CLARIFY_QUESTIONS` | `"CLARIFY_QUESTIONS"` | Batch mode: findings file written |

---

## Anti-Patterns

| Anti-Pattern | Why Wrong | Correct Approach |
|---|---|---|
| Inline path construction (`featureDir + "/findings/clarify-round-1.json"`) | Drift-prone, not DRY | Use `findingsPath(featureDir, "clarify", round)` from `paths.ts` |
| Hardcoded signal names (`"CLARIFY_COMPLETE"`) | Breaks if signal changes | Import constants from `pipeline-signal.ts` |
| Polling for resolutions | Blocks agent response, causes timeout | End response after emitting batch; orchestrator re-dispatches |
| Calling `AskUserQuestion` in batch mode | Wrong mode; orchestrator can't interact | Check mode via `resolve-execution-mode.ts` first |
| Emitting `CLARIFY_COMPLETE` before writing spec | Premature completion | Write spec atomically, then emit signal |
| More than 3 questions in orchestrated mode | Slows pipeline | Max 3 questions per round; synthesize where possible |

---

## Review Focus

When reviewing clarify-domain code changes, check:

1. **Schema compliance** — `FindingsBatch` and `ResolutionBatch` match schema in `questions.ts`
2. **Round numbering** — rounds increment correctly; re-entry reads correct round N resolutions
3. **Signal emission** — `CLARIFY_COMPLETE` always emitted (never skipped) at end of successful phase
4. **Batch vs interactive branching** — correct path taken based on `resolveMode()` output
5. **No inline path construction** — all paths built via `findingsPath()` / `resolutionsPath()`
6. **No hardcoded signal strings** — use constants from `pipeline-signal.ts`
7. **Re-entry detection** — agent checks for existing resolutions before re-collecting questions
8. **Atomic spec writes** — spec file written atomically before emitting completion signal

---

## Conventions

- Phase name string: `"clarify"` (lowercase, matches pipeline.json phase key)
- Finding IDs: `"f1"`, `"f2"`, ... (sequential, from `QuestionCollector.add()`)
- Round numbers: start at `1`, increment for dependent follow-up rounds
- Spec update: `## Clarifications` section, `### Session YYYY-MM-DD`, `- Q: ... → A: ...` format
