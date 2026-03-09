# Contract Data Directory

Stores ContractPattern JSON files for cross-Mind handoff patterns.

## Format

Each file is a JSON-serialized ContractPattern with the following fields:

- `sourcePhase` — originating Mind/phase name (e.g. "clarify")
- `targetPhase` — receiving Mind/phase name (e.g. "plan")
- `artifactShape` — human-readable description of the artifact's shape
- `sections` — ordered list of expected sections (name, required, description)
- `metadata` — key-value tags for categorization
- `timestamp` — ISO 8601 recording time

## Naming

Files are named `{sourcePhase}-{targetPhase}-{timestamp}.json`.

## Indexing

An FTS5 SQLite index (`.index.db`) is maintained alongside these files.
It is rebuilt by `syncContractIndex()` and queried via `searchMemory({ scope: "contracts" })`.

## Cold Start

This directory starts empty. Patterns accumulate from successful Mind-to-Mind handoffs.
The first search returns no results — drones proceed without context until patterns exist.
