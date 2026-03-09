# @templates Mind Profile

## Domain

Pure data: distributable config, orchestrator scripts, schemas, gate prompts, pipeline variants, and default values. No logic lives here — only files that get copied into target repos during installation.

## Conventions

- **No logic in this Mind** — template files contain data, config, and TypeScript scripts that run in target repos. Functions and classes do not belong here.
- **Three locations must stay in sync**: `minds/execution/` (source of truth), `minds/templates/` (installed to target repos via `gravitas install`), and `cli/src/templates/` (alternate install path). Changes to orchestrator scripts must be made in all three.
- Pipeline variant files (`pipeline-variants/*.json`) must validate against `pipeline.v3.1.schema.json`.
- Gate prompt files (`gates/*.md`) are Markdown — keep them LLM-readable with clear criteria.
- Schema files (`*.schema.json`) are JSON Schema draft-07 — validate new schemas with `ajv-cli` before committing.

## Key Files

- `minds/templates/orchestrator/` — orchestrator scripts installed to target repos
- `minds/templates/lib-pipeline/` — pipeline utility lib installed to target repos
- `minds/templates/config/pipeline.json` — default pipeline config
- `minds/templates/config/pipeline.v3.1.schema.json` — pipeline config schema
- `minds/templates/gates/` — gate prompt Markdown files
- `minds/templates/pipeline-variants/` — pipeline variant JSON files

## Anti-Patterns

- Adding logic (conditionals, state management) to template files — data only.
- Editing `minds/templates/` without also updating `minds/execution/` and `cli/src/templates/`.
- Creating a pipeline variant that doesn't validate against the schema.
- Modifying gate prompts in only one of the three template locations.

## Review Focus

- All three template locations updated consistently for any script change.
- New pipeline variants validate against `pipeline.v3.1.schema.json`.
- No logic added to template files (they are distributable data, not source code for this repo).
