---
description: Visual comparison between two URLs or a URL and a local mock HTML file. Reports structural and visual differences.
---

> **IMPORTANT:** Execute these steps directly and sequentially. Do NOT wrap this workflow in PAI Algorithm phases, ISC criteria, capability selection, or any other meta-framework. Follow the numbered steps exactly as written.

## Arguments

```text
$ARGUMENTS
```

Expected: `<source-a> <source-b>`

Each source is one of:
- A URL (`http://` or `https://`) — fetched live and screenshotted
- A path to a local HTML file — read directly from disk

Examples:
```
http://localhost:3099/blueprint/spec/my-spec tests/e2e/fixtures/prototype-v4b.html
http://localhost:3099/blueprint/spec/my-spec http://localhost:3100/blueprint/spec/my-spec
```

## Step 1: Parse Arguments

Extract `SOURCE_A` and `SOURCE_B` from `$ARGUMENTS` (first and second whitespace-delimited tokens).

If fewer than 2 arguments are provided, stop and print:

```
Usage: /minds.compare-design <source-a> <source-b>

Each source is a URL (http/https) or a path to a local HTML file.
```

## Step 2: Fetch HTML Content

For each source:

- **If URL** (`starts with http://` or `https://`):
  ```bash
  curl -sf <URL> -o /tmp/compare-a.html   # or compare-b.html
  ```
  If curl fails (non-2xx or network error), stop and report the error.

- **If file path**:
  Read the file directly with the Read tool.
  If the file does not exist, stop and report: `File not found: <path>`

Write the content to `/tmp/compare-a.html` and `/tmp/compare-b.html` for structural analysis.

## Step 3: Take Screenshots (URL sources only)

For each source that is a URL, take a full-page screenshot:

```bash
bunx playwright screenshot "<URL>" /tmp/compare-screenshot-a.png --full-page
bunx playwright screenshot "<URL>" /tmp/compare-screenshot-b.png --full-page
```

If Playwright is not installed, skip this step and note it in the report.

Read the screenshot(s) with the image read tool for visual inspection.

## Step 4: Structural Comparison

Extract and diff the structural elements from both HTML files:

```bash
# IDs
grep -oE 'id="[^"]+"' /tmp/compare-a.html | sort -u > /tmp/compare-ids-a.txt
grep -oE 'id="[^"]+"' /tmp/compare-b.html | sort -u > /tmp/compare-ids-b.txt

# CSS classes (unique)
grep -oE 'class="[^"]+"' /tmp/compare-a.html | tr ' ' '\n' | grep -v '^$' | sort -u > /tmp/compare-classes-a.txt
grep -oE 'class="[^"]+"' /tmp/compare-b.html | tr ' ' '\n' | grep -v '^$' | sort -u > /tmp/compare-classes-b.txt

# Diffs
diff /tmp/compare-ids-a.txt /tmp/compare-ids-b.txt > /tmp/compare-ids-diff.txt || true
diff /tmp/compare-classes-a.txt /tmp/compare-classes-b.txt > /tmp/compare-classes-diff.txt || true
```

Read the diff files and identify:
- IDs present in A but missing from B
- IDs present in B but missing from A
- Significant class differences (ignore utility/state classes like `hidden`, `active`)

## Step 5: Cleanup

```bash
rm -f /tmp/compare-a.html /tmp/compare-b.html \
      /tmp/compare-ids-a.txt /tmp/compare-ids-b.txt \
      /tmp/compare-ids-diff.txt \
      /tmp/compare-classes-a.txt /tmp/compare-classes-b.txt \
      /tmp/compare-classes-diff.txt \
      /tmp/compare-screenshot-a.png /tmp/compare-screenshot-b.png
```

## Step 6: Report

Output a structured comparison report:

```
Design Comparison Report
═══════════════════════════════════════════
Source A:  <SOURCE_A>
Source B:  <SOURCE_B>

STRUCTURAL DIFF
  IDs in A not in B:   <list or "none">
  IDs in B not in A:   <list or "none">
  Matching IDs:        <count>
  Class differences:   <summary or "none">

VISUAL OBSERVATIONS  (from screenshots, if taken)
  <analysis — are key sections present, layout intact, content readable?>

VERDICT:  MATCH | MINOR_DIFFERENCES | SIGNIFICANT_DIFFERENCES
  <one-sentence explanation>
═══════════════════════════════════════════
```

**Verdict rules:**
- `MATCH` — no structural differences, visuals look equivalent
- `MINOR_DIFFERENCES` — a few extra/missing classes or minor layout shifts, no missing sections
- `SIGNIFICANT_DIFFERENCES` — missing key IDs, broken layout, or sections absent from one source
