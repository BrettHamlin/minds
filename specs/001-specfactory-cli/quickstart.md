# Quickstart: SpecFactory CLI Plugin

**Feature Branch**: `001-specfactory-cli`
**Date**: 2026-02-14
**Time to first run**: ~5 minutes (SC-005)

---

## Prerequisites

Before starting, ensure you have the following installed and available:

| Requirement | Version | Check Command | Notes |
|------------|---------|---------------|-------|
| Node.js | v18.0.0+ | `node --version` | Required for both backend and CLI |
| npm | v9+ | `npm --version` | Comes with Node.js |
| PostgreSQL | v14+ | `psql --version` | Local install or Docker |
| Git | Any recent | `git --version` | For cloning the repository |

### External Service Dependencies

| Service | Required By | How to Get |
|---------|------------|------------|
| OpenRouter API key | Backend (LLM calls) | Sign up at [openrouter.ai](https://openrouter.ai), create API key |
| Slack workspace | NOT required | The CLI replaces Slack entirely for local testing |

---

## Environment Variables

### Backend Server (.env)

Create a `.env` file in the project root with the following variables:

```bash
# Required
OPENROUTER_API_KEY=sk-or-v1-your-key-here   # OpenRouter API key for LLM calls
DATABASE_URL=postgresql://user:password@localhost:5432/relay   # PostgreSQL connection

# Required for CLI mode
PLUGIN_TYPE=cli                              # Options: cli | slack | both

# Optional
PORT=3000                                    # Server port (default: 3000)
SPEC_BASE_URL=http://localhost:3000          # Base URL for spec view links
```

### CLI Client (shell environment)

```bash
# Optional - only needed if backend is not on localhost:3000
export SPECFACTORY_BACKEND_URL=http://localhost:3000

# The CLI can also accept --backend-url flag which takes highest priority
```

**Configuration precedence** (highest to lowest):
1. `--backend-url` CLI flag
2. `SPECFACTORY_BACKEND_URL` environment variable
3. Default: `http://localhost:3000`

---

## Installation

### Step 1: Clone and Install Backend Dependencies

```bash
# Clone the repository (if not already done)
git clone <repository-url>
cd relay

# Install backend dependencies
npm install
```

### Step 2: Set Up the Database

```bash
# Option A: Local PostgreSQL
createdb relay
npm run db:push   # Apply schema via Drizzle

# Option B: Docker PostgreSQL
docker run -d \
  --name relay-postgres \
  -e POSTGRES_USER=relay \
  -e POSTGRES_PASSWORD=relay \
  -e POSTGRES_DB=relay \
  -p 5432:5432 \
  postgres:16

# Then update DATABASE_URL in .env:
# DATABASE_URL=postgresql://relay:relay@localhost:5432/relay

npm run db:push
```

### Step 3: Configure Environment

```bash
# Copy the example env file (or create .env manually)
cp .env.example .env

# Edit .env and set:
#   OPENROUTER_API_KEY=sk-or-v1-your-key-here
#   DATABASE_URL=postgresql://...
#   PLUGIN_TYPE=cli
```

### Step 4: Start the Backend Server

```bash
# Development mode (auto-restart on changes)
npm run dev

# Verify the server is running
curl http://localhost:3000/health
# Expected: {"status":"ok","service":"relay","version":"0.1.0"}
```

### Step 5: Install and Build the CLI

```bash
# Navigate to CLI directory
cd cli

# Install CLI dependencies
npm install

# Build the CLI
npm run build

# Link for global access (optional)
npm link
```

---

## First Run Example

This example walks through a complete SpecFactory workflow from feature description to completed spec.

### Interactive Mode (Default)

```bash
# Start the CLI (from cli/ directory)
npx specfactory

# Or if globally linked:
specfactory
```

The CLI will guide you through each step:

```
  SpecFactory CLI v0.1.0
  Connected to http://localhost:3000

  Step 1/4: Feature Description
  Describe the feature you want to specify (minimum 10 words):
  > Build a user authentication system that supports email and password
    login, OAuth integration with Google and GitHub, session management
    with JWT tokens, and password reset via email verification links.

  Analyzing description...

  Step 2/4: Analysis Results
  Title: User Authentication System
  Complexity: 7/10
  Estimated Questions: 12
  Roles identified:
    1. Backend Engineer - API implementation and JWT token management
    2. Security Engineer - OAuth integration and credential handling
    3. Frontend Engineer - Login UI and password reset flow

  Step 3/4: Channel Name Selection
  Select a channel name for this spec:
    1. feature-user-auth
    2. spec-auth-system
    3. auth-implementation
    4. user-login-feature
    5. auth-design-spec
    6. Enter custom name
  > 1

  Channel name recorded: feature-user-auth (--no-slack mode)
  Starting Blind QA...

  Step 4/4: Blind QA Questions (1/12)
  What authentication methods should be supported?
    1. Email/password only
    2. OAuth + email/password
    3. SSO enterprise
    4. Other (enter custom answer)
  > 2

  Question 2/12:
  How should JWT tokens be managed?
    1. Short-lived access + refresh tokens
    2. Long-lived tokens only
    3. Session-based with JWT backup
    4. Other (enter custom answer)
  > 1

  ... (remaining questions) ...

  Spec Complete!
  Spec ID: 550e8400-e29b-41d4-a716-446655440000
  View: http://localhost:3000/api/spec/550e8400-...?format=html
```

### JSON Mode (for Automation)

```bash
# Run with JSON output for scripting
specfactory --json --auto-answer --no-slack <<< "Build a user authentication system that supports email and password login, OAuth integration with Google and GitHub, session management with JWT tokens, and password reset via email verification links."

# Output (each phase produces JSON to stdout):
# {"status":"success","data":{"specId":"550e8400-...","sessionId":"a1b2c3d4-...","phase":"start","result":{"step":"awaiting_description"}},"meta":{"timestamp":"2026-02-14T10:00:00Z","duration_ms":245,"backend_url":"http://localhost:3000"}}
# {"status":"success","data":{"specId":"550e8400-...","phase":"complete","result":{"status":"completed","totalQuestions":12,"specUrl":"http://localhost:3000/api/spec/550e8400-...?format=html"}},"meta":{"timestamp":"2026-02-14T10:03:30Z","duration_ms":210000,"backend_url":"http://localhost:3000"}}
```

### Verbose Mode (for Debugging)

```bash
# Show full request/response details
specfactory --verbose

# Output includes HTTP details:
# --> POST http://localhost:3000/api/specfactory/start
#     Body: {"pmUserId":"cli-atlas-1739520000","slackChannelId":"cli-local"}
# <-- 201 Created (245ms)
#     Body: {"specId":"550e8400-...","sessionId":"a1b2c3d4-...","step":"awaiting_description"}
```

---

## CLI Flags Reference

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--json` | `-j` | Output structured JSON instead of interactive prompts | `false` |
| `--auto-answer` | `-a` | Automatically select first option for all choices | `false` |
| `--no-slack` | `-n` | Skip Slack operations (channel creation, member invite) | `true` (always on for CLI) |
| `--backend-url <url>` | `-b` | Backend server URL | `http://localhost:3000` |
| `--session-id <id>` | `-s` | Override auto-generated session ID (for reproducible tests) | `cli-{user}-{epoch}` |
| `--verbose` | `-v` | Show HTTP request/response details | `false` |
| `--help` | `-h` | Show help information | - |
| `--version` | `-V` | Show version information | - |

---

## Exit Codes

| Code | Meaning | Scripting Use |
|------|---------|---------------|
| `0` | Workflow completed successfully | `specfactory && echo "Success"` |
| `1` | General error (validation, unexpected) | Catch-all for failures |
| `2` | Backend not reachable (ECONNREFUSED) | Check if server is running |
| `3` | Authentication/authorization error | Reserved for future use |
| `4` | LLM operation failed after retries | OpenRouter issues |
| `5` | User cancelled (Ctrl+C) | Intentional interruption |

---

## Troubleshooting

### Backend Not Reachable

**Symptom**: `Error: Backend server not reachable at http://localhost:3000. Is it running?`

**Cause**: The backend Express server is not running or is on a different port.

**Fix**:
```bash
# Check if the server is running
curl http://localhost:3000/health

# If not running, start it:
npm run dev

# If on a different port, specify it:
specfactory --backend-url http://localhost:4000
```

### LLM Errors (500 / Timeout)

**Symptom**: `Error: LLM_ERROR - Failed to analyze description` or request timeout after 60 seconds.

**Cause**: OpenRouter API key is missing, invalid, or the LLM service is temporarily unavailable.

**Fix**:
```bash
# Verify the API key is set in backend .env
grep OPENROUTER_API_KEY .env

# Test the key directly
curl https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"

# If rate limited, wait and retry (the CLI retries 3 times automatically)
```

### Active Session Conflict (409)

**Symptom**: `Error: ACTIVE_SESSION_EXISTS - An active spec creation session already exists for this user`

**Cause**: A previous CLI run created a session that has not expired (24-hour window).

**Fix**:
```bash
# Option 1: Use a different session ID
specfactory --session-id cli-atlas-$(date +%s)

# Option 2: Wait for session expiry (24 hours)

# Option 3: Clear sessions in the database (development only)
psql -d relay -c "UPDATE sessions SET is_active = false WHERE pm_user_id LIKE 'cli-%';"
```

### Database Connection Errors

**Symptom**: `Error: connect ECONNREFUSED 127.0.0.1:5432` in backend logs.

**Cause**: PostgreSQL is not running or DATABASE_URL is incorrect.

**Fix**:
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# If using Docker, check container status
docker ps | grep relay-postgres

# If not running, start it
docker start relay-postgres
# or
brew services start postgresql@16  # macOS with Homebrew
```

### Description Too Short

**Symptom**: `Error: DESCRIPTION_TOO_SHORT - Feature description must be at least 10 words`

**Cause**: The feature description has fewer than 10 words.

**Fix**: Provide a more detailed description. The minimum is 10 words to ensure the LLM has enough context for meaningful analysis.

```bash
# Too short (will fail):
# "Build login system"

# Sufficient (will work):
# "Build a user authentication system with email login, OAuth support,
#  session management, and password reset functionality"
```

### Invalid Channel Name

**Symptom**: `Error: INVALID_CHANNEL_NAME - Channel name must be 1-80 characters...`

**Cause**: Custom channel name contains uppercase letters, spaces, or special characters.

**Fix**: Use only lowercase letters, numbers, and hyphens. Must start with a letter or number.

```bash
# Invalid: "My Feature Channel"
# Invalid: "feature_auth"
# Valid:   "feature-user-auth"
# Valid:   "spec-auth-2026"
```

### Ctrl+C Interruption

**Symptom**: CLI exits with code 5 after pressing Ctrl+C.

**Behavior**: The CLI handles SIGINT gracefully (FR-020). The backend session remains active but will auto-expire after 24 hours. No database corruption occurs. You can restart the workflow with a new session ID.

---

## Running Tests

```bash
# From the cli/ directory

# Unit tests
npm test

# Unit tests with coverage
npm run test:coverage

# Contract tests (validate CLI matches Slack plugin API usage)
npm run test:contract

# Integration tests (requires backend running)
npm run test:integration
```

### Contract Test Example

Contract tests verify the CLI sends the same request shapes as the Slack plugin:

```bash
# Run contract tests specifically
npx vitest run tests/contract/

# These tests compare CLI HTTP requests against recorded Slack plugin
# requests to ensure API compatibility (FR-012)
```

---

## Architecture Quick Reference

```
Developer Terminal
      |
      v
+-------------+     HTTP REST      +----------------+
|   CLI       | -----------------> |   Backend      |
| (cli/src/)  |  POST /start      | (src/routes/   |
|             |  POST /analyze    |  specfactory.ts)|
| - prompts   |  POST /channel-   |                |
| - client    |    names          | - session.ts   |
| - output    |  POST /channel    | - spec.ts      |
| - retry     |  POST /questions/ | - llm.ts       |
| - session   |    next           | - blind-qa.ts  |
+-------------+  POST /questions/ | - channel.ts   |
                   answer         +----------------+
                                        |
                                        v
                                  +----------+     +-----------+
                                  | PostgreSQL|     | OpenRouter|
                                  | (Drizzle) |     | (LLM API) |
                                  +----------+     +-----------+
```

The CLI is a thin HTTP client. All business logic, LLM calls, and data persistence happen on the backend. The CLI handles user interaction (prompts, display) and HTTP orchestration (request construction, retry, error mapping).
