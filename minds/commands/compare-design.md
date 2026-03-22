---
description: Visual comparison between two URLs or a URL and a local mock HTML file. Uses Playwright screenshots for pixel-level comparison.
---

> **IMPORTANT:** Execute these steps directly and sequentially. Do NOT wrap this workflow in PAI Algorithm phases, ISC criteria, capability selection, or any other meta-framework. Follow the numbered steps exactly as written.

## Arguments

```text
$ARGUMENTS
```

Expected: `<source-a> <source-b>`

Each source is one of:
- A URL (`http://` or `https://`) — loaded in Playwright and screenshotted
- A path to a local HTML file — opened in Playwright via `file://` and screenshotted

Examples:
```
http://localhost:3099/config tests/e2e/fixtures/prototype-v4b.html
http://localhost:3099/config ~/Documents/blueprint/configv1.html
```

## Step 1: Parse Arguments

Extract `SOURCE_A` and `SOURCE_B` from `$ARGUMENTS` (first and second whitespace-delimited tokens).

If fewer than 2 arguments are provided, stop and print:

```
Usage: /minds.compare-design <source-a> <source-b>

Each source is a URL (http/https) or a path to a local HTML file.
```

## Step 2: Take Screenshots with Playwright

For each source, take a full-page screenshot using Playwright:

```bash
# For URLs:
npx playwright screenshot "<URL>" /tmp/compare-screenshot-a.png --full-page

# For local files (expand ~ to $HOME):
npx playwright screenshot "file://<absolute-path>" /tmp/compare-screenshot-b.png --full-page
```

If a URL returns a non-2xx status (404, 500, connection refused), that IS a finding:
```
- VF001: Page unreachable
  HAVE: Server responds with 404 / connection refused / error
  WANT: Full page renders
  FIX: Ensure the module is loaded and the route is registered
```

Read BOTH screenshots with the image Read tool. You are a multimodal LLM — visually inspect and compare them.

**Do NOT use curl to fetch HTML.** Playwright screenshots are the only comparison method. You are comparing what the pages LOOK like, not their HTML source.

## Step 3: Visual Comparison

Look at both screenshots and identify ALL visual differences:

1. **Layout** — missing sections, wrong panel order, different grid/flex structure
2. **Colors** — background colors, text colors, border colors, accent colors
3. **Typography** — wrong font family, font size, font weight, line height
4. **Spacing** — padding, margins, gaps between elements
5. **Components** — missing buttons, icons, inputs, cards, toggles
6. **Content** — missing labels, wrong text, missing headings
7. **Visual indicators** — status dots, badges, change markers, hover states

Be specific — reference exact CSS properties, hex colors, pixel values where visible.

## Step 4: Cleanup

```bash
rm -f /tmp/compare-screenshot-a.png /tmp/compare-screenshot-b.png
```

## Step 5: Report

If the pages match (no meaningful differences), output exactly:

```
NO_DIFFERENCES
```

If there ARE differences, output a summary line followed by numbered findings. Each finding has three fields:

- **HAVE** — what the live page currently shows (exact CSS values, visual state)
- **WANT** — what the mockup shows (exact CSS values, visual state)
- **FIX** — exactly what code change to make, including the file path

Start with a one-line summary: `SUMMARY: N layout differences, N color differences, N missing elements`

Then list each finding:

```
SUMMARY: 2 CSS differences, 0 layout differences, 0 missing elements

- VF001: CSS mismatch on .hsub
  HAVE: font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #6b7688;
  WANT: font-size: 13px; color: #6b7688;
  FIX: Remove font-family from .hsub in packages/modules/config/templates/settings.ts

- VF002: CSS mismatch on .module-card-body
  HAVE: padding: 0 18px 18px;
  WANT: padding: 0 18px 18px; margin-top: 0;
  FIX: Add margin-top: 0 to .module-card-body in packages/modules/config/templates/settings.ts

- VF003: Page returns 404
  HAVE: Server responds with 404 Not Found
  WANT: Full settings page renders
  FIX: Add "config" to the modules array in din.config.ts
```

Do NOT output verdicts, report headers, or any other formatting. Just `NO_DIFFERENCES` or the summary + numbered findings with HAVE/WANT/FIX.
