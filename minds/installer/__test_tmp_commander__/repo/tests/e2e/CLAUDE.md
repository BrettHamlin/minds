# E2E Tests

This directory contains end-to-end tests for the application.
Tests use Playwright and run via the `/minds.test` command.

## Server Startup

The test command starts the server at `http://localhost:3099`.
Update `.claude/commands/minds.test.md` with your actual server startup command:

```bash
PORT=3099 bun run <your-server-entrypoint>
```

## Mind Labels

Tests are organized by mind label. Register each test in `registry.json`.

| Mind | Label | Test File |
|------|-------|-----------|
| transport | @transport | tests/e2e/transport.test.ts |
| memory | @memory | tests/e2e/memory.test.ts |
| signals | @signals | tests/e2e/signals.test.ts |
| observability | @observability | tests/e2e/observability.test.ts |
| dashboard | @dashboard | tests/e2e/dashboard.test.ts |
| integrations | @integrations | tests/e2e/integrations.test.ts |
| instantiate | @instantiate | tests/e2e/instantiate.test.ts |
| fission | @fission | tests/e2e/fission.test.ts |

## Running Tests

```bash
# All tests
/minds.test

# Tests for a specific mind
/minds.test --mind @your-mind

# Tests with visual screenshot comparison
/minds.test --visual
```

## Visual Design Comparison

```bash
/minds.compare-design http://localhost:3099/page tests/e2e/fixtures/design.html
```

## Adding a New Test

1. Create `tests/e2e/<feature>.test.ts`:

```typescript
import { test, expect } from "@playwright/test";

test("scenario: <describe the user scenario>", async ({ page }) => {
  await page.goto("http://localhost:3099/<path>");
  await expect(page.locator("<selector>")).toBeVisible();
});
```

2. Register it in `registry.json`:

```json
{
  "tests": [
    { "mind": "@your-mind", "file": "tests/e2e/<feature>.test.ts" }
  ]
}
```

## Baseline Tag

Visual comparisons use the `v1.0.0` git tag as the design baseline.
Create it once your initial design is stable:

```bash
git tag v1.0.0
git push origin v1.0.0
```
