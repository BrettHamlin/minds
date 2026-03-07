# BlindQA Principles & Philosophy

## Why BlindQA Exists

Builders are biased toward their own work. Self-verification is necessary but never sufficient. BlindQA enforces independent, adversarial verification by a separate agent that has zero knowledge of what was changed, which files were modified, or what approach was taken.

The QA agent receives ONLY:
1. **What** the expected behavior is (the spec)
2. **Where** to look (URLs, pages, local servers)
3. **How** to test (Playwright, DOM inspection, screenshots)
4. **What** the pass criteria are for each check

Everything else is stripped. The agent comes in clean.

---

## Core Principles

### 1. Context Isolation
The QA agent must NOT receive:
- Which files were changed
- What the implementation approach was
- What the implementing agent said or reported
- Git diffs, commit messages, or branch names
- Any "here's what I did" summary

### 2. Adversarial Mindset
The QA agent's job is to **find failures**, not confirm success. It should:
- Actively try to break the implementation
- Look for edge cases the implementer missed
- Test boundary conditions (dark mode, mobile viewport, empty states)
- Question anything that "looks fine" at first glance

### 3. Evidence Over Claims
Every verification verdict must include:
- **What was tested** — the specific check
- **What was expected** — the pass criteria
- **What was actually observed** — concrete finding
- **Proof** — screenshot, DOM extract, or data dump
- "It looks fine" is NEVER a valid result

### 4. Skepticism Protocol
After believing something passes:
- Ask: "What if I'm wrong? What would prove me wrong?"
- Don't trust rendered output at face value — inspect the DOM
- Don't assume build tools rebuilt correctly — hard-refresh
- Cross-reference multiple sources (visual + DOM + data)

### 5. All-or-Nothing
- If ANY check fails, ALL checks must be re-run after the fix
- No partial re-checks, no skipping previously passing tests
- A single failure invalidates the entire verification run

---

## Dual-Mode Philosophy

BlindQA operates in two modes, both using identical adversarial QA logic but differing in how results are presented:

### Default Mode (Batch Text Report)

**Characteristics**:
- All issues reported at once as structured text
- User reads full report, then manually fixes each issue
- Best for batch processing and documentation
- No interruption during verification run

**When to use**:
- Large issue counts (5+ issues) where overview is helpful
- Batch processing workflows or CI/CD automation contexts
- When you want to review all issues before deciding fix order
- Documentation purposes (save report for later review)

### Interactive Mode (Guided Resolution)

**Characteristics**:
- Issues presented one at a time via AskUserQuestion
- Immediate fix application after each user selection
- Guided resolution with contextual options
- Progress tracking (Issue X of N)

**When to use**:
- Small to medium issue counts (1-5 issues) where immediate fixes make sense
- Exploratory fix workflows where you want to resolve as you go
- Learning from QA findings interactively
- When you prefer guided resolution over batch review

### Important: Same QA, Different Presentation

**Both modes execute identical verification logic**:
- Same QATester agent with zero implementation context
- Same adversarial mindset (try to BREAK the implementation)
- Same evidence requirements (screenshots, DOM extracts)
- Same pass criteria and confidence levels
- Same context isolation principles

**The ONLY difference is output presentation**:
- Default mode: Dump all issues as text → user fixes manually
- Interactive mode: Present issues one-by-one → apply fixes immediately

The quality and thoroughness of QA verification is identical in both modes. Choose based on your workflow preference, not verification rigor.

---

## Integration with Constitution

This skill implements the **Two-Phase Verification** constitutional principle:
- Phase 1: Self-verification by implementing agent (their responsibility)
- Phase 2: BlindQA verification (this skill)

The constitution mandates that Phase 2 runs for all UI/visual implementation tickets. See the project constitution for the full verification principles.
