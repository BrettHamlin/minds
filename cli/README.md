# SpecFactory CLI

CLI plugin for SpecFactory -- test the full specification workflow without Slack.

## Installation

```bash
cd cli
bun install
```

## Quickstart

```bash
# 1. Start the backend server (from project root)
PLUGIN_TYPE=cli bun run dev

# 2. Run the CLI interactively
bun run cli/src/index.ts

# 3. Follow the prompts: describe a feature, select a channel, answer QA questions
```

## Usage

### Interactive Mode (default)

```bash
bun run cli/src/index.ts
```

Guides you through the full workflow with interactive prompts:
1. Health check against backend
2. Feature description input (10-word minimum)
3. Analysis results display
4. Channel name selection from suggestions
5. Blind QA question loop
6. Completion summary with spec ID and URL

### JSON Mode (automation)

```bash
echo "Build a user auth system with email login and password reset and OAuth support" \
  | bun run cli/src/index.ts --json --auto-answer
```

Outputs structured JSON envelopes to stdout. All interactive prompts are suppressed.

### Verbose Mode (debugging)

```bash
bun run cli/src/index.ts --verbose
```

Logs HTTP request/response details to stderr for debugging.

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--backend-url <url>` | Backend server URL | `SPECFACTORY_BACKEND_URL` env or `http://localhost:3000` |
| `--no-slack` | Skip Slack operations | Enabled by default |
| `--json` | Output JSON envelopes to stdout | `false` |
| `--auto-answer` | Auto-select first option at every choice | `false` |
| `--verbose` | Log HTTP traffic to stderr | `false` |
| `-V, --version` | Display version | - |
| `-h, --help` | Display help | - |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SPECFACTORY_BACKEND_URL` | Backend server URL | `http://localhost:3000` |

**Precedence**: `--backend-url` flag > `SPECFACTORY_BACKEND_URL` env > `http://localhost:3000`

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Workflow completed successfully |
| `1` | User error (validation, missing input) |
| `2` | Backend error (API error, LLM failure) |
| `3` | Network error (connection refused, timeout) |

## JSON Output Schema

Success envelope:
```json
{
  "status": "success",
  "data": {
    "specId": "uuid",
    "specUrl": "http://...",
    "title": "Feature Title",
    "totalAnswered": 12,
    "channelName": "spec-feature-name"
  },
  "meta": {
    "timestamp": "2026-02-14T10:00:00.000Z",
    "duration_ms": 45000,
    "backend_url": "http://localhost:3000"
  }
}
```

Error envelope:
```json
{
  "status": "error",
  "error": {
    "code": "LLM_ERROR",
    "message": "Human-readable description",
    "retryable": true
  },
  "meta": {
    "timestamp": "2026-02-14T10:00:00.000Z",
    "duration_ms": 60001,
    "backend_url": "http://localhost:3000"
  }
}
```

## Running Tests

```bash
# All tests
bun run test

# By category
bun run test:unit
bun run test:contract
bun run test:integration
```

## Project Structure

```
cli/
  src/
    index.ts      # CLI entrypoint and workflow orchestration
    client.ts     # HTTP client with retry and timeout handling
    prompts.ts    # Interactive terminal prompts (@clack/prompts)
    output.ts     # JSON envelope formatter
    session.ts    # Session ID generation
    retry.ts      # Exponential backoff retry logic
  tests/
    contract/     # API contract tests (request/response schema validation)
    integration/  # End-to-end integration tests
    unit/         # Unit tests for pure functions
```

## Architecture

The CLI is a thin HTTP client. All business logic, LLM calls, and data persistence happen on the backend. The CLI handles:

- **User interaction**: Terminal prompts and display via @clack/prompts
- **HTTP orchestration**: Request construction, retry, timeout, error mapping
- **Output formatting**: Interactive (prompts) or structured (JSON envelopes)
