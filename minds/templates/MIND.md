# @templates Mind Profile

## Domain

Pure data: distributable config, schemas, pipeline variants, and default values for the Minds architecture. No logic lives here — only files that get copied into target repos during installation.

## Conventions

- **No logic in this Mind** — template files contain data, config, and schemas. Functions and classes do not belong here.
- Pipeline variant files (`pipeline-variants/*.json`) must validate against `pipeline.v3.1.schema.json`.
- Schema files (`*.schema.json`) are JSON Schema draft-07 — validate new schemas with `ajv-cli` before committing.

## Key Files

- `minds/templates/pipeline-variants/` — pipeline variant JSON files
- `minds/templates/pipeline.v3.1.schema.json` — pipeline config schema
- `minds/templates/coordination.schema.json` — coordination schema
- `minds/templates/defaults/` — default configuration values
- `minds/templates/displays/` — display templates
- `minds/templates/memory/` — memory templates
- `minds/templates/skills/` — skill templates
- `minds/templates/orchestrator-contexts/` — orchestrator context templates
- `minds/templates/verify-config.json` — default verify configuration
- `minds/templates/verify-patterns.json` — default verify patterns

## Anti-Patterns

- Adding logic (conditionals, state management) to template files — data only.
- Creating a pipeline variant that doesn't validate against the schema.
