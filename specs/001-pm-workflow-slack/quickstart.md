# Quickstart: PM Workflow in Slack

**Branch**: `001-pm-workflow-slack` | **Date**: 2026-02-14

This guide walks through setting up the SpecFactory development environment from scratch. By the end you will have a running Express server connected to PostgreSQL, a Slack bot installed in your workspace, and the ability to invoke `/specfactory` to create feature specifications.

---

## Prerequisites

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| PostgreSQL | 14+ | `psql --version` |
| Slack workspace | -- | Admin permissions required |
| OpenRouter account | -- | https://openrouter.ai |

**Optional**: Docker and Docker Compose (for running PostgreSQL in a container instead of a local install).

---

## 1. Clone and Install

```bash
git clone <repo-url> relay
cd relay
git checkout 001-pm-workflow-slack

npm install
```

### Install New Dependencies

The following dependencies are required for Phase 1 and are not yet in `package.json`:

```bash
# Production dependencies
npm install drizzle-orm openai

# Development dependencies
npm install -D drizzle-kit @vitest/coverage-v8
```

- `drizzle-orm` -- TypeScript-native ORM for PostgreSQL schema and queries.
- `openai` -- OpenAI-compatible SDK used as the OpenRouter client (same API format).
- `drizzle-kit` -- CLI tooling for schema migrations.
- `@vitest/coverage-v8` -- Code coverage reporting for Vitest.

---

## 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Server
PORT=3000

# Database (PostgreSQL)
DATABASE_URL=postgresql://relay:relay@localhost:5432/relay

# LLM Provider (OpenRouter with Claude Sonnet 4.5)
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Slack Bot
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# Spec Viewing (web frontend)
SPEC_BASE_URL=http://localhost:3000
```

If you do not have an `.env.example` file yet, create one from the block above with placeholder values.

---

## 3. Set Up PostgreSQL

### Option A: Docker (recommended for development)

```bash
docker run -d \
  --name relay-postgres \
  -e POSTGRES_USER=relay \
  -e POSTGRES_PASSWORD=relay \
  -e POSTGRES_DB=relay \
  -p 5432:5432 \
  postgres:16-alpine
```

Verify the connection:

```bash
psql postgresql://relay:relay@localhost:5432/relay -c "SELECT 1;"
```

### Option B: Local PostgreSQL

```bash
createdb relay
# Or with a specific user:
createuser relay --pwprompt
createdb relay --owner=relay
```

---

## 4. Initialize Database Schema

Generate and run migrations using Drizzle Kit:

```bash
# Generate SQL migration files from the Drizzle schema
npx drizzle-kit generate

# Apply migrations to the database
npx drizzle-kit migrate
```

For rapid iteration during development, you can push schema changes directly without generating migration files:

```bash
npx drizzle-kit push
```

Verify tables were created:

```bash
psql $DATABASE_URL -c "\dt"
```

Expected output should list: `specs`, `channels`, `spec_roles`, `role_members`, `questions`, `answers`, `sessions`.

---

## 5. Create the Slack App

### Step 1: Create the App

1. Go to https://api.slack.com/apps
2. Click **Create New App** > **From an app manifest**
3. Select your workspace
4. Paste the manifest below (YAML format):

```yaml
display_information:
  name: SpecFactory
  description: AI-powered feature spec creation
  background_color: "#2C2D30"
features:
  bot_user:
    display_name: SpecFactory
    always_online: true
  slash_commands:
    - command: /specfactory
      url: https://your-domain.ngrok.io/slack/events
      description: Create a new feature specification
      usage_hint: "[optional: feature description]"
      should_escape: false
oauth_config:
  scopes:
    bot:
      - channels:manage
      - channels:read
      - channels:join
      - chat:write
      - commands
      - groups:write
      - im:write
      - users:read
settings:
  interactivity:
    is_enabled: true
    request_url: https://your-domain.ngrok.io/slack/events
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

### Step 2: Install to Workspace

1. Navigate to **Install App** in the sidebar
2. Click **Install to Workspace**
3. Authorize the requested permissions

### Step 3: Collect Credentials

Copy these values to your `.env` file:

| Setting | Location in Slack Dashboard | Env Variable |
|---------|----------------------------|--------------|
| Bot User OAuth Token | **OAuth & Permissions** | `SLACK_BOT_TOKEN` |
| Signing Secret | **Basic Information** > App Credentials | `SLACK_SIGNING_SECRET` |
| App-Level Token | **Basic Information** > App-Level Tokens (generate one with `connections:write` scope) | `SLACK_APP_TOKEN` |

---

## 6. Run the Development Server

```bash
npm run dev
```

Expected output:

```
Relay server running on port 3000
Health check: http://localhost:3000/health
```

Verify the health endpoint:

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"relay","version":"0.1.0"}
```

---

## 7. Expose Local Server to Slack (Development)

Slack needs a public URL to send events to your local server. Use ngrok or a similar tunneling tool:

```bash
ngrok http 3000
```

Copy the HTTPS forwarding URL (e.g., `https://abc123.ngrok.io`) and update:
- Slack app manifest: replace `your-domain.ngrok.io` with the ngrok URL
- Or update the URLs in **Interactivity & Shortcuts** and **Slash Commands** settings

**Note**: If using Socket Mode (recommended for development), ngrok is not required. The `SLACK_APP_TOKEN` enables direct WebSocket connection to Slack.

---

## 8. Test the Workflow

### Smoke Test

1. Open your Slack workspace
2. In any channel, type `/specfactory`
3. The bot should respond with a prompt for a feature description

### Manual End-to-End Test

1. `/specfactory` -- bot prompts for description
2. Enter a feature description (at least 10 words)
3. Bot analyzes and suggests 5 channel names
4. Select a channel name or enter a custom one
5. Bot prompts for team members for each role (sequentially)
6. Assign members and confirm
7. Coordination channel is created with all members
8. Blind QA questions begin appearing in the channel
9. Answer each question using radio buttons or "Other"
10. After all questions, a completion summary is posted
11. Click the spec link to view formatted spec in browser

### API Smoke Tests

```bash
# Health check
curl http://localhost:3000/health

# Start a spec (replace with valid Slack user ID)
curl -X POST http://localhost:3000/api/specfactory/start \
  -H "Content-Type: application/json" \
  -d '{"pmUserId":"U024BE7LH","slackChannelId":"C061EG9T2"}'

# Retrieve a spec (replace with valid spec ID)
curl http://localhost:3000/api/spec/550e8400-e29b-41d4-a716-446655440000
```

---

## 9. Run Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npx vitest run --coverage

# Run specific test file
npx vitest run src/services/llm.test.ts

# Watch mode (re-runs on file changes)
npx vitest
```

### Test Database Setup

Tests requiring database access should use a separate database:

```bash
# Create test database
createdb relay_test

# Set test database URL
DATABASE_URL=postgresql://relay:relay@localhost:5432/relay_test npx vitest run
```

---

## Project Structure

```
relay/
├── src/
│   ├── index.ts              # Express app entry point
│   ├── db/
│   │   ├── schema.ts         # Drizzle table definitions
│   │   └── index.ts          # Database client setup
│   ├── routes/
│   │   ├── specfactory.ts    # /api/specfactory/* endpoints
│   │   └── spec.ts           # /api/spec/* endpoints
│   ├── services/
│   │   ├── llm.ts            # LLM client (OpenRouter/Claude)
│   │   ├── slack.ts          # Slack Bolt app integration
│   │   ├── spec.ts           # Spec business logic
│   │   └── session.ts        # Session management
│   └── lib/
│       ├── errors.ts         # Error types and handlers
│       └── validation.ts     # Input validation helpers
├── tests/
│   ├── unit/                 # Unit tests (mocked dependencies)
│   ├── integration/          # Integration tests (real database)
│   └── contract/             # API contract tests
├── drizzle/                  # Generated migration files
├── drizzle.config.ts         # Drizzle Kit configuration
├── specs/                    # Feature specifications
│   └── 001-pm-workflow-slack/
│       ├── spec.md
│       ├── plan.md
│       ├── research.md
│       ├── data-model.md
│       ├── quickstart.md
│       └── contracts/
│           └── specfactory-api.yaml
├── package.json
├── tsconfig.json
├── vitest.config.ts          # Vitest configuration (to be created)
└── .env                      # Environment variables (not committed)
```

---

## Common Issues

| Problem | Solution |
|---------|----------|
| `ECONNREFUSED` on database | Ensure PostgreSQL is running: `docker ps` or `pg_isready` |
| Slack command not responding | Check ngrok is running, or Socket Mode is enabled with valid `SLACK_APP_TOKEN` |
| `OPENROUTER_API_KEY` errors | Verify key at https://openrouter.ai/keys and check account balance |
| Migration errors | Run `npx drizzle-kit push` to force-sync schema during development |
| Port 3000 already in use | Change `PORT` in `.env` or kill the existing process: `lsof -ti:3000 \| xargs kill` |
| Slack "dispatch_failed" | Ensure the request URL matches your ngrok/public URL exactly |

---

## Next Steps

After completing setup:

1. **Implement the database schema** -- Copy Drizzle definitions from `data-model.md` into `src/db/schema.ts`
2. **Implement API routes** -- Build endpoints defined in `contracts/specfactory-api.yaml`
3. **Integrate Slack Bolt** -- Wire `/specfactory` command to the start endpoint
4. **Build LLM service** -- Connect to OpenRouter for description analysis and question generation
5. **Write tests** -- Start with contract tests validating API schemas, then unit tests for services
