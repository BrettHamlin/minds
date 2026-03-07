# @observability Mind Profile

## Domain

Pipeline metrics and analysis: recording gate decisions, run outcomes, autonomy rates, gate accuracy tracking, dashboard display, draft PR creation, and run classification. Data is stored in a SQLite database at `.collab/state/metrics.db`.

## Conventions

- **Always open and close the DB per operation**: `const db = openMetricsDb(dbPath); /* work */; db.close()` — never leave a connection open.
- DB path is always `${repoRoot}/.collab/state/metrics.db` — never hardcode a path.
- `openMetricsDb()` in `metrics.ts` is the single DB factory — do not use `bun:sqlite` directly.
- Lib modules (`classify-run-lib.ts`, `dashboard-lib.ts`, `gate-accuracy-lib.ts`, `autonomy-rate.ts`) are pure functions over the DB — no HTTP, no filesystem beyond the DB.
- CLI scripts (`record-gate`, `create-draft-pr`, `complete-run`, etc.) are thin wrappers: validate args → open DB → call lib function → close DB → exit.

## Key Files

- `minds/observability/metrics.ts` — DB schema, `openMetricsDb()`, `insertGate()`, `completeRun()`
- `minds/observability/classify-run-lib.ts` — run classification logic
- `minds/observability/gate-accuracy-lib.ts` — gate accuracy computation
- `minds/observability/autonomy-rate.ts` — autonomy rate aggregation
- `minds/observability/dashboard-lib.ts` — dashboard data queries
- `minds/observability/draft-pr-lib.ts` — draft PR creation via GitHub API

## Anti-Patterns

- Leaving a DB connection open after a function returns.
- Constructing the DB path without `repoRoot` (never hardcode `.collab/state/metrics.db`).
- Adding new metrics columns without updating the schema in `metrics.ts`.
- Mixing DB logic into CLI scripts (keep CLIs thin — business logic belongs in lib files).

## Review Focus

- Every DB open has a matching close (including error paths).
- Lib functions accept a `db` parameter — they do not open their own connection.
- New CLI scripts follow the validate → open → call lib → close → exit pattern.
