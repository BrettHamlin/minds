# Research: PM Workflow in Slack (MVP Core)

**Branch**: `001-pm-workflow-slack` | **Date**: 2026-02-14 | **Spec**: [spec.md](./spec.md)

**Purpose**: Resolve NEEDS CLARIFICATION items from [plan.md](./plan.md) Technical Context section. Four technology decisions required before Phase 1 design can proceed.

---

## 1. LLM Provider

**Decision**: Anthropic Claude API (claude-sonnet-4-5) via OpenRouter

**Rationale**: The core LLM use cases in this project are Blind QA question generation, feature complexity analysis, and role determination from feature descriptions (FR-003, FR-011). These are reasoning-heavy, structured-output tasks that benefit from strong instruction following and long-context capability. Claude Sonnet 4.5 excels at multi-step reasoning and structured output generation at a competitive price point ($3/$15 per million input/output tokens). Routing through OpenRouter provides automatic provider failover and unified billing without markup, which gives production resilience appropriate for an MVP that cannot afford downtime during PM-facing workflows.

**Alternatives Considered**:
- **OpenAI (GPT-4o/GPT-4 Turbo)**: Strong structured output with strict JSON schema enforcement. However, higher cost for comparable reasoning quality. GPT-4 Turbo at $10/$30 per million tokens is significantly more expensive. GPT-4o is cheaper but reasoning depth for complex feature analysis is a step below Claude Sonnet 4.5 in benchmarks.
- **Google Gemini (2.0 Flash/Pro)**: Competitive pricing and large context windows. However, the API ecosystem for TypeScript is less mature than Anthropic/OpenAI, structured output reliability has historically been inconsistent, and the developer tooling (SDK quality, documentation) lags behind.
- **Direct Anthropic API (without OpenRouter)**: Lower latency by removing the gateway hop. However, no automatic failover, no unified billing across potential future multi-model usage, and the pricing is identical since OpenRouter passes through provider pricing without markup. The resilience tradeoff favors OpenRouter for an MVP.

**Implementation Notes**:
- Use the OpenRouter API endpoint (`https://openrouter.ai/api/v1`) with OpenAI-compatible SDK format for ease of integration.
- Model identifier: `anthropic/claude-sonnet-4-5` via OpenRouter.
- Abstract the LLM client behind an interface (`LLMService`) so the provider can be swapped without touching business logic.
- Implement prompt caching for repeated system prompts (Blind QA instructions, role analysis templates) to reduce costs by up to 90%.
- Budget estimate for MVP testing: ~$5-15 total (each spec creation generates roughly 5K-20K tokens of output across question generation, complexity analysis, and role determination).
- Set `max_tokens` conservatively per call type: role analysis (~500), question generation (~1000), complexity scoring (~200).

---

## 2. Database Technology

**Decision**: PostgreSQL

**Rationale**: PostgreSQL is already selected in the project. The `pg` driver (v8.11.3) and `@types/pg` are present in `package.json`. PostgreSQL is the correct choice for this use case: the data model involves structured entities with clear relationships (Spec -> Questions -> Answers, Spec -> Channel, Spec -> Roles -> Members), requires ACID compliance for spec state persistence (SC-008 demands 100% answer accuracy with no data loss), and supports concurrent sessions without data mixing (SC-009). PostgreSQL handles all of this natively.

**Alternatives Considered**:
- **MongoDB**: Document model could work for flexible spec schemas, but the relational nature of the data (specs have many questions, questions have answers, specs belong to channels with members) maps naturally to relational tables. Adds unnecessary complexity for structured, well-defined entities. No benefit for MVP scope.
- **SQLite**: Viable for local-only MVP development but cannot handle concurrent write access from multiple simultaneous spec sessions (SC-009). No connection pooling. Would require migration to PostgreSQL before any production deployment, creating throwaway work.
- **Redis**: Appropriate as a caching or session layer but not as a primary data store. No relational integrity, no ACID transactions, data loss risk on restart without persistence configuration. Does not meet SC-008 requirements.

**Implementation Notes**:
- The `pg` driver is already installed. Connection pooling via `pg.Pool` is built-in.
- Use environment variable `DATABASE_URL` for connection string (already compatible with dotenv setup in `src/index.ts`).
- For MVP, a single PostgreSQL instance is sufficient. Connection pool size of 10-20 handles concurrent spec sessions.
- Consider adding `pg-listen` for real-time spec state change notifications if needed later.

---

## 3. Testing Framework

**Decision**: Vitest

**Rationale**: Vitest is already selected in the project. The `vitest` package (v1.2.1) is in `devDependencies` and the `test` script in `package.json` runs `vitest`. Vitest is the optimal choice for this TypeScript/ESM project: it provides native TypeScript support without transpilation configuration, ESM-first design matching the project's `"type": "module"` setting, Jest-compatible API (familiar assertions, mocking, describe/it blocks), fast execution through Vite's transform pipeline, and first-class async/await support for testing Slack API interactions and LLM calls.

**Alternatives Considered**:
- **Jest**: Industry standard with massive ecosystem. However, ESM support in Jest remains cumbersome (requires experimental flags or `ts-jest` transformer configuration). Since this project uses `"type": "module"`, Vitest avoids the ESM compatibility friction that Jest still carries.
- **Mocha**: Flexible but requires assembling a testing toolkit (separate assertion library like Chai, separate mocking library like Sinon, separate coverage tool). Higher configuration overhead for equivalent functionality that Vitest provides out of the box.
- **Ava**: Concurrent test execution by default is appealing, but smaller ecosystem, fewer TypeScript examples, and less community support for mocking patterns needed for Slack/LLM integration testing.

**Implementation Notes**:
- Configure `vitest.config.ts` at project root with TypeScript path aliases matching `tsconfig.json`.
- Use `vi.mock()` for mocking Slack Bolt client, LLM service, and database calls in unit tests.
- Use `vi.fn()` for spy/stub patterns on Express route handlers.
- Integration tests should use a test database (separate PostgreSQL database or schema) with setup/teardown hooks.
- Coverage reporting: add `--coverage` flag with `@vitest/coverage-v8` for Istanbul-compatible coverage output.
- Test file convention: `*.test.ts` co-located with source or in `tests/` directory matching the project structure from plan.md.

---

## 4. Database ORM / Client

**Decision**: Drizzle ORM

**Rationale**: Drizzle provides a code-first, TypeScript-native approach to database access that aligns with this project's needs. The schema is defined directly in TypeScript (no separate schema language or code generation step), which means the type system catches schema-query mismatches at compile time. Drizzle's SQL-like query builder produces predictable, inspectable queries -- critical when debugging spec state persistence issues (SC-008). At ~7KB minified, it adds negligible overhead. Its migration tooling (`drizzle-kit generate` + `drizzle-kit migrate`) provides production-grade schema evolution without the weight of Prisma's binary engine.

**Alternatives Considered**:
- **Prisma**: Excellent developer experience with Prisma Studio and intuitive schema language. However, it requires a separate `.prisma` schema file and a code generation step (`prisma generate`) that adds build complexity. The generated client binary (~10-15MB) is heavyweight for an MVP. Schema-first workflow means TypeScript types are derived rather than authored, which inverts the control that a code-first approach provides.
- **TypeORM**: Decorator-based approach with class entities. However, its TypeScript type inference is weaker than Drizzle's (relies on runtime reflection rather than compile-time types), and the project's active maintenance has historically been inconsistent. Configuration complexity is higher for a new project.
- **Sequelize**: Mature but designed for JavaScript-first workflows. TypeScript support is bolted on rather than native. Model definitions are verbose and type safety requires manual effort. Not the right fit for a TypeScript-first project.
- **Native `pg` driver (no ORM)**: Already installed and functional. However, raw SQL strings provide zero type safety, require manual parameter sanitization, and make schema migrations a manual process. Acceptable for prototyping but creates technical debt that Drizzle eliminates at minimal cost.

**Implementation Notes**:
- Install: `npm i drizzle-orm` (already have `pg` driver). Dev dependency: `npm i -D drizzle-kit`.
- Drizzle uses the existing `pg` driver as its PostgreSQL adapter -- no additional database driver needed.
- Define schema in `src/db/schema.ts` using `pgTable` from `drizzle-orm/pg-core`.
- Configure `drizzle.config.ts` at project root pointing to schema path and `DATABASE_URL`.
- Migration workflow: `drizzle-kit generate` creates SQL migration files, `drizzle-kit migrate` applies them.
- For MVP rapid iteration, `drizzle-kit push` can sync schema directly to database without generating migration files.
- Key tables to define: `specs`, `channels`, `roles`, `role_members`, `questions`, `answers`, `sessions`.
- Use Drizzle's relational query API for joins (e.g., fetching a spec with all its questions and answers in one query).

---

## Summary of Decisions

| Item | Decision | Already in Project? |
|------|----------|-------------------|
| LLM Provider | Anthropic Claude via OpenRouter | No -- new dependency |
| Database | PostgreSQL | Yes -- `pg` in package.json |
| Testing Framework | Vitest | Yes -- `vitest` in package.json |
| ORM / Client | Drizzle ORM | No -- new dependency |

### New Dependencies Required

```bash
# Production
npm i drizzle-orm openai
# openai package used as OpenRouter-compatible client (OpenAI SDK format)

# Development
npm i -D drizzle-kit
```

### Environment Variables Required

```bash
# .env additions
DATABASE_URL=postgresql://user:password@localhost:5432/relay
OPENROUTER_API_KEY=sk-or-...
```
