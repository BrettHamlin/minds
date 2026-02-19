# 001-specfactory-cli Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-14

## Active Technologies
- Go 1.22+ + Standard library only (`regexp`, `os/exec`, `sync`, `encoding/json`, `flag`, `bufio`, `os`, `context`, `fmt`) — zero external Go modules (001-attractor-ai-gates)
- JSON files at `.collab/state/pipeline-registry/{TICKET_ID}.json` (read-only for most fields; atomic write for `analysis_remediation_done` and `retry_count`); `.collab/config/verify-config.json`, `.collab/config/pipeline.json`, `.collab/config/verify-patterns.json` read at handler ini (001-attractor-ai-gates)
- Bash (bash 3.2+ compatible), JSON + `jq` 1.6+ (already required by existing scripts), `git` (for repo root detection) (001-pipeline-json)
- `.collab/config/pipeline.json` (config file read at script invocation time) (001-pipeline-json)

- Node.js v18+, TypeScript 5.x (001-specfactory-cli)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test && npm run lint

## Code Style

Node.js v18+, TypeScript 5.x: Follow standard conventions

## Recent Changes
- 001-pipeline-json: Added Bash (bash 3.2+ compatible), JSON + `jq` 1.6+ (already required by existing scripts), `git` (for repo root detection)
- 001-attractor-ai-gates: Added Go 1.22+ + Standard library only (`regexp`, `os/exec`, `sync`, `encoding/json`, `flag`, `bufio`, `os`, `context`, `fmt`) — zero external Go modules

- 001-specfactory-cli: Added Node.js v18+, TypeScript 5.x

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
