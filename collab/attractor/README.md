# Attractor Go Bridge

Signal-routing bridge for the Collab pipeline (BRE-216).

## Module

`github.com/bretthamlin/collab/attractor`

## Build

```bash
cd collab/attractor
go build ./...
go build -o attractor ./...
```

## Test

```bash
cd collab/attractor

# Unit tests (no environment dependencies)
go test ./...

# With verbose output
go test -v ./...

# With race detector
go test -race ./...

# Integration tests (requires live registry)
go test -tags=integration ./...
```

## Static Analysis

```bash
cd collab/attractor
go build ./...   # zero errors required
go vet ./...     # zero warnings required
```

Cross-cutting FR-013 check: for each handler error condition defined in
contracts/handler-interface.md, verify the corresponding unit test confirms
stderr output is produced (no silent failure paths).

## No-API-Call Verification

```bash
grep -r "anthropic\|openai\|generativeai\|claude-sdk" collab/attractor/
# Must return empty
```

## Run

```bash
# From repo root -- stdin mode
./collab/attractor/attractor --input=stdin

# Named pipe mode
mkfifo .collab/state/signal.pipe
./collab/attractor/attractor --input=pipe &

# Generate pipeline graph
./collab/attractor/attractor --graph | dot -Tpng -o pipeline.png
```
